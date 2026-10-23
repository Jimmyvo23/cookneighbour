// T-121: draws the placeholder pictures the demo seed uploads (scripts/seed-images/*.png).
// Original flat food icons (bowl, pot, pan, plate) made only from circles, rectangles and half
// circles. No people, no photos, no third-party art. Plain Node, no dependencies:
//   node scripts/make-seed-images.mjs
// Output is deterministic, so running it again gives byte-identical files.
import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SIZE = 160;
const SS = 3; // 3x3 samples per pixel for smooth edges
const out = resolve(dirname(fileURLToPath(import.meta.url)), "seed-images");

const hex = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const disc = (cx, cy, r) => (x, y) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const rect = (x0, y0, x1, y1) => (x, y) =>
  x >= x0 && x <= x1 && y >= y0 && y <= y1;
const lowerHalfDisc = (cx, cy, r) => (x, y) =>
  y >= cy && (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
const ring = (cx, cy, r0, r1) => (x, y) => {
  const d = (x - cx) ** 2 + (y - cy) ** 2;
  return d <= r1 * r1 && d >= r0 * r0;
};

// Each icon: a background colour and layers drawn in order (later layers paint over earlier ones).
const icons = {
  bowl: {
    bg: "#fde7c8",
    layers: [
      ["#e8b86a", rect(52, 38, 56, 58)], // steam
      ["#e8b86a", rect(78, 30, 82, 54)],
      ["#e8b86a", rect(104, 38, 108, 58)],
      ["#c0392b", lowerHalfDisc(80, 78, 56)], // bowl
      ["#e9a23b", rect(24, 74, 136, 84)], // rim
      ["#f5d9a1", rect(60, 104, 100, 114)], // foot
    ],
  },
  pot: {
    bg: "#d9ecd3",
    layers: [
      ["#5b8a4a", rect(24, 76, 40, 84)], // handles
      ["#5b8a4a", rect(120, 76, 136, 84)],
      ["#3d6b34", rect(40, 62, 120, 124)], // body
      ["#2f5528", rect(34, 52, 126, 64)], // lid
      ["#2f5528", disc(80, 46, 9)], // knob
      ["#a9cf9b", rect(52, 84, 68, 112)], // shine
    ],
  },
  pan: {
    bg: "#d6e4f2",
    layers: [
      ["#4a6785", rect(100, 74, 148, 86)], // handle
      ["#2e3f52", disc(70, 80, 52)], // pan
      ["#4a6785", disc(70, 80, 42)],
      ["#f3c94d", disc(70, 80, 18)], // egg yolk
      ["#fbf6e6", ring(70, 80, 18, 30)], // egg white
    ],
  },
  plate: {
    bg: "#f3d9e0",
    layers: [
      ["#ffffff", disc(80, 82, 56)], // plate
      ["#e4c9d1", ring(80, 82, 38, 42)],
      ["#7aa95c", disc(66, 76, 16)], // greens
      ["#e07a3f", disc(98, 70, 14)], // carrot
      ["#f0d08a", disc(92, 98, 14)], // rice
    ],
  },
};

function crc32(buf) {
  let c;
  let crc = 0xffffffff;
  for (const b of buf) {
    c = (crc ^ b) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

function render({ bg, layers }) {
  const raw = Buffer.alloc((SIZE * 3 + 1) * SIZE);
  const bgRgb = hex(bg);
  const rgbLayers = layers.map(([c, f]) => [hex(c), f]);
  for (let py = 0; py < SIZE; py++) {
    raw[py * (SIZE * 3 + 1)] = 0; // filter: none
    for (let px = 0; px < SIZE; px++) {
      const sum = [0, 0, 0];
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const x = px + (sx + 0.5) / SS;
          const y = py + (sy + 0.5) / SS;
          let rgb = bgRgb;
          for (const [c, f] of rgbLayers) if (f(x, y)) rgb = c;
          for (let i = 0; i < 3; i++) sum[i] += rgb[i];
        }
      for (let i = 0; i < 3; i++)
        raw[py * (SIZE * 3 + 1) + 1 + px * 3 + i] = Math.round(
          sum[i] / (SS * SS),
        );
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(SIZE, 0);
  ihdr.writeUInt32BE(SIZE, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // truecolour RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync(out, { recursive: true });
for (const [name, icon] of Object.entries(icons)) {
  const png = render(icon);
  writeFileSync(resolve(out, `${name}.png`), png);
  console.log(`${name}.png ${png.length} bytes`);
}
