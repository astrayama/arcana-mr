/**
 * Generates the dark-gold theme's cloth texture: a tileable, tone-on-tone
 * velvet with a faint diamond lattice and small four-point stars. The image is
 * light grey so the theme's mat color tints it; bright parts read as a sheen.
 *
 *   npx tsx scripts/make-dark-gold-assets.ts
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';

const SIZE = 512;
const CELL = 128; // lattice period; divides SIZE so the tile repeats seamlessly
const out = join(import.meta.dirname, '..', 'src/themes/dark-gold/assets');
mkdirSync(out, { recursive: true });

const star = (cx: number, cy: number, r: number) => {
  const w = r * 0.22;
  return `<path d="M${cx},${cy - r} L${cx + w},${cy - w} L${cx + r},${cy} L${cx + w},${cy + w} L${cx},${cy + r} L${cx - w},${cy + w} L${cx - r},${cy} L${cx - w},${cy - w} Z"/>`;
};

const stars: string[] = [];
const lines: string[] = [];
for (let y = 0; y <= SIZE; y += CELL) {
  for (let x = 0; x <= SIZE; x += CELL) {
    stars.push(star(x, y, 9));
    stars.push(star(x + CELL / 2, y + CELL / 2, 5));
  }
}
// Diagonal lattice through the star centers, drawn past the edges so it tiles.
for (let k = -SIZE; k <= SIZE * 2; k += CELL) {
  lines.push(`<line x1="${k}" y1="0" x2="${k + SIZE}" y2="${SIZE}"/>`);
  lines.push(`<line x1="${k}" y1="${SIZE}" x2="${k + SIZE}" y2="0"/>`);
}

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}">
  <defs>
    <filter id="grain" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" seed="7" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.10"/></feComponentTransfer>
    </filter>
    <filter id="nap" x="0" y="0" width="100%" height="100%">
      <feTurbulence type="fractalNoise" baseFrequency="0.012" numOctaves="3" seed="3" stitchTiles="stitch"/>
      <feColorMatrix type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.18"/></feComponentTransfer>
    </filter>
  </defs>
  <rect width="${SIZE}" height="${SIZE}" fill="#b4b4b4"/>
  <rect width="${SIZE}" height="${SIZE}" filter="url(#nap)"/>
  <g stroke="#e8e8e8" stroke-width="1.3" opacity="0.6">${lines.join('')}</g>
  <g fill="#ffffff" opacity="0.85">${stars.join('')}</g>
  <rect width="${SIZE}" height="${SIZE}" filter="url(#grain)"/>
</svg>`;

await sharp(Buffer.from(svg))
  .webp({ quality: 88 })
  .toFile(join(out, 'cloth.webp'));
console.log('Wrote src/themes/dark-gold/assets/cloth.webp');
