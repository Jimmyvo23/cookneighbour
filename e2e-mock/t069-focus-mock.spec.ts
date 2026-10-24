import { expect, test, type Page } from "@playwright/test";

// T-069 fix round 2 (R1), MOCK mode: the keyboard focus ring on the dark-red hero must have at least
// 3:1 contrast (WCAG 1.4.11) in light and dark mode. Everything is made up.
function lum(rgb: number[]) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function ratio(a: number[], b: number[]) {
  const [hi, lo] = [lum(a), lum(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}
const parse = (s: string) => (s.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);

async function focusRingColours(page: Page) {
  await page.goto("/");
  const button = page.getByRole("link", { name: "Find a home cook" });
  await expect(button).toBeVisible();
  // Tab until the button has focus (the skip link and header links come first).
  for (let i = 0; i < 20; i++) {
    await page.keyboard.press("Tab");
    if (await button.evaluate((el) => el === document.activeElement)) break;
  }
  await expect(button).toBeFocused();
  return button.evaluate((el) => {
    const hero = el.closest(".hero") as HTMLElement;
    return {
      outline: getComputedStyle(el).outlineColor,
      outlineWidth: getComputedStyle(el).outlineWidth,
      hero: getComputedStyle(hero).backgroundColor,
    };
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`home hero focus ring has 3:1 contrast, ${scheme} mode`, async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: scheme });
    const c = await focusRingColours(page);
    expect(parseFloat(c.outlineWidth)).toBeGreaterThanOrEqual(2);
    expect(ratio(parse(c.outline), parse(c.hero))).toBeGreaterThanOrEqual(3);
  });
}
