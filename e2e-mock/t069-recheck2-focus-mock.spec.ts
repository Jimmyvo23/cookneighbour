import { expect, test, type Page } from "@playwright/test";
import { blockStorage, hideDevOverlay, PNG } from "./helpers";

// T-069 recheck 2 (Tester), MOCK mode: Tab through EVERY focusable element inside .hero and .band on
// every page that has them (home, search, chef detail), light and dark, 375 and 1280 px, and measure
// the real outline pixels against the real pixels behind them (the red cloth and the gingham squares).
// WCAG 1.4.11 needs 3:1. Everything is made up.
const MAI = "00000000-0000-4000-8000-000000001001";
const PAGES = ["/", "/search", `/chefs/${MAI}`];

function lum([r, g, b]: number[]) {
  const [R, G, B] = [r, g, b].map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
}
function ratio(a: number[], b: number[]) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

test.beforeEach(async ({ page }) => {
  await hideDevOverlay(page);
  await blockStorage(page);
  await page.route("https://tile.openstreetmap.org/**", (route) =>
    route.fulfill({ contentType: "image/png", body: PNG.buffer }),
  );
});

/** Pixel [r,g,b] at page coordinates from one screenshot of the viewport. The picture is decoded on a
 * blank page of its own, because the app's CSP forbids data: fetches. */
async function sampler(page: Page) {
  const b64 = (await page.screenshot({ animations: "disabled" })).toString(
    "base64",
  );
  const helper = await page.context().newPage();
  await helper.goto("about:blank");
  await helper.evaluate(async (data) => {
    const img = new Image();
    img.src = `data:image/png;base64,${data}`;
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.width;
    c.height = img.height;
    const ctx = c.getContext("2d")!;
    ctx.drawImage(img, 0, 0);
    (window as unknown as { __px: CanvasRenderingContext2D }).__px = ctx;
  }, b64);
  const read = async (x: number, y: number) =>
    helper.evaluate(
      ([px, py]) =>
        Array.from(
          (window as unknown as { __px: CanvasRenderingContext2D }).__px
            .getImageData(px, py, 1, 1)
            .data.slice(0, 3),
        ),
      [Math.round(x), Math.round(y)],
    );
  return { read, close: () => helper.close() };
}

for (const scheme of ["light", "dark"] as const) {
  for (const width of [375, 1280]) {
    for (const path of PAGES) {
      test(`every focusable in .hero/.band has a 3:1 ring: ${path} ${scheme} ${width}px`, async ({
        page,
      }) => {
        await page.setViewportSize({ width, height: 900 });
        await page.emulateMedia({ colorScheme: scheme });
        await page.goto(path);
        await expect(page.locator("h1").first()).toBeVisible();
        // Lists every focusable (tabbable) element inside the cloth, in DOM terms.
        const expected = await page.evaluate(
          () =>
            Array.from(
              document.querySelectorAll<HTMLElement>(
                ".hero a[href], .hero button, .hero input, .hero select, .hero textarea, .hero [tabindex]:not([tabindex='-1']), .band a[href], .band button, .band input, .band select, .band textarea, .band [tabindex]:not([tabindex='-1'])",
              ),
            ).length,
        );
        const seen: string[] = [];
        for (let i = 0; i < 80; i++) {
          await page.keyboard.press("Tab");
          const info = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || !el.closest(".hero, .band")) return null;
            el.scrollIntoView({ block: "center" });
            const r = el.getBoundingClientRect();
            const cs = getComputedStyle(el);
            return {
              name: el.tagName + (el.textContent ?? "").slice(0, 20),
              x: r.left,
              y: r.top,
              w: r.width,
              h: r.height,
              color: cs.outlineColor,
              width: parseFloat(cs.outlineWidth),
              offset: parseFloat(cs.outlineOffset),
            };
          });
          if (!info) continue;
          if (seen.includes(info.name)) break; // focus wrapped round
          seen.push(info.name);
          const sm = await sampler(page);
          const px = sm.read;
          const rgb = (info.color.match(/[\d.]+/g) ?? [])
            .slice(0, 3)
            .map(Number);
          const mid = info.width / 2;
          const { x, y, w, h, offset: o } = info;
          // Ring pixel, the pixel just outside it, and the gap pixel just inside it, per side.
          const sides: [number, number, number, number, number, number][] = [
            [
              x + w / 2,
              y - o - mid,
              x + w / 2,
              y - o - info.width - 2,
              x + w / 2,
              y - 1,
            ],
            [
              x + w / 2,
              y + h + o + mid,
              x + w / 2,
              y + h + o + info.width + 2,
              x + w / 2,
              y + h + 1,
            ],
            [
              x - o - mid,
              y + h / 2,
              x - o - info.width - 2,
              y + h / 2,
              x - 1,
              y + h / 2,
            ],
            [
              x + w + o + mid,
              y + h / 2,
              x + w + o + info.width + 2,
              y + h / 2,
              x + w + 1,
              y + h / 2,
            ],
          ];
          let min = Infinity;
          for (const s of sides) {
            const ring = await px(s[0], s[1]);
            const behind = await px(s[2], s[3]);
            // The measured ring pixel must really be the outline colour.
            expect(ratio(ring, rgb)).toBeLessThan(1.1);
            min = Math.min(min, ratio(ring, behind));
          }
          await sm.close();
          console.log(
            `RING ${path} ${scheme} ${width} ${info.name} outline=${info.color} min=${min.toFixed(2)}`,
          );
          expect(info.width).toBeGreaterThanOrEqual(2);
          expect(min).toBeGreaterThanOrEqual(3);
        }
        expect(seen.length).toBeGreaterThanOrEqual(expected);
      });
    }
  }
}
