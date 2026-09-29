/**
 * Draws Arcana's card back designs as SVG and renders them with sharp.
 *
 * Every design is drawn as one half plus the same half turned 180 degrees
 * around the card's center, so each back is rotationally symmetric by
 * construction: a reversed card can't be told apart from its back.
 *
 *   npx tsx scripts/make-backs.ts          (writes src/backs/<id>/)
 *   npx tsx scripts/make-backs.ts --sheet  (also writes .tmp/backs-sheet.png)
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { seeded } from '../src/lib/random.ts';

const W = 600;
const H = 1034;
const CX = W / 2;
const CY = H / 2;
const root = join(import.meta.dirname, '..');

/** The half plus its 180-degree turn. */
const sym = (half: string) => `<g>${half}</g><g transform="rotate(180 ${CX} ${CY})">${half}</g>`;
const f = (n: number) => n.toFixed(2);

function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

/** A star with `points` tips between radii `r` and `inner`. */
function star(cx: number, cy: number, r: number, inner: number, points = 4, turn = 0): string {
  const pts: string[] = [];
  for (let i = 0; i < points * 2; i++) {
    const [x, y] = polar(cx, cy, i % 2 === 0 ? r : inner, turn + (i * 180) / points);
    pts.push(`${f(x)},${f(y)}`);
  }
  return `<polygon points="${pts.join(' ')}"/>`;
}

function frame(inset: number, radius: number, attrs: string): string {
  return `<rect x="${inset}" y="${inset}" width="${W - inset * 2}" height="${H - inset * 2}" rx="${radius}" ${attrs}/>`;
}

/** Stars scattered over the top half, clear of the given keep-out circles. */
function scatter(seed: number, count: number, keepOut: [number, number, number][], draw: (x: number, y: number, s: number, r: () => number) => string): string {
  const rand = seeded(seed);
  const out: string[] = [];
  let tries = 0;
  while (out.length < count && tries++ < count * 40) {
    const x = 50 + rand() * (W - 100);
    const y = 55 + rand() * (CY - 90);
    if (keepOut.some(([kx, ky, kr]) => Math.hypot(x - kx, y - ky) < kr)) continue;
    out.push(draw(x, y, rand(), rand));
  }
  return out.join('');
}

// Celestial: sun at the heart, a crescent moon above and below, a sky of stars.
function celestial(): string {
  const gold = '#d6b35c';
  const rays: string[] = [];
  for (let i = 0; i < 32; i++) {
    const long = i % 2 === 0;
    const [x1, y1] = polar(CX, CY, 78, i * 11.25 - 3);
    const [x2, y2] = polar(CX, CY, long ? 132 : 108, i * 11.25);
    const [x3, y3] = polar(CX, CY, 78, i * 11.25 + 3);
    rays.push(`<polygon points="${f(x1)},${f(y1)} ${f(x2)},${f(y2)} ${f(x3)},${f(y3)}"/>`);
  }
  // A crescent: a full disc with an offset disc masked out of it.
  const moon = (cx: number, cy: number, r: number) =>
    `<mask id="crescent"><rect width="${W}" height="${H}" fill="black"/><circle cx="${cx}" cy="${cy}" r="${r}" fill="white"/><circle cx="${cx + r * 0.42}" cy="${cy - r * 0.18}" r="${r * 0.86}" fill="black"/></mask><circle cx="${cx}" cy="${cy}" r="${r}" mask="url(#crescent)"/>`;
  const stars = scatter(17, 42, [[CX, 250, 90], [CX, CY, 175]], (x, y, s) =>
    s > 0.86 ? `<g fill="${gold}">${star(x, y, 9, 2.2)}</g>` : `<circle cx="${f(x)}" cy="${f(y)}" r="${f(1 + s * 2.4)}" fill="#f3e6c4" opacity="${f(0.45 + s * 0.5)}"/>`,
  );
  const constellation = [[120, 150], [170, 118], [215, 160], [196, 214], [140, 232]];
  const half = `
    ${stars}
    <g fill="${gold}">${moon(CX - 10, 250, 58)}</g>
    <g stroke="${gold}" stroke-width="1.2" opacity="0.55" fill="none">
      <polyline points="${constellation.map((p) => p.join(',')).join(' ')}"/>
    </g>
    <g fill="${gold}">${constellation.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="3"/>`).join('')}</g>
    <g fill="${gold}">${star(66, 66, 14, 3.5)}${star(W - 66, 66, 14, 3.5)}</g>
    <path d="M ${CX - 120} 360 Q ${CX} 330 ${CX + 120} 360" stroke="${gold}" stroke-width="1.5" fill="none" opacity="0.7"/>`;
  return `
    <defs>
      <radialGradient id="sky" cx="50%" cy="50%" r="70%">
        <stop offset="0" stop-color="#1c2a5a"/><stop offset="0.55" stop-color="#101838"/><stop offset="1" stop-color="#080c1e"/>
      </radialGradient>
      <radialGradient id="sun" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#fff2c4"/><stop offset="0.6" stop-color="#e6c064"/><stop offset="1" stop-color="#b8892e"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#sky)"/>
    ${sym(half)}
    <circle cx="${CX}" cy="${CY}" r="160" fill="none" stroke="${gold}" stroke-width="1.5"/>
    <circle cx="${CX}" cy="${CY}" r="170" fill="none" stroke="${gold}" stroke-width="1" stroke-dasharray="2 7"/>
    <g fill="${gold}">${rays.join('')}</g>
    <circle cx="${CX}" cy="${CY}" r="72" fill="url(#sun)"/>
    <circle cx="${CX}" cy="${CY}" r="72" fill="none" stroke="#fff3cf" stroke-width="2" opacity="0.7"/>
    ${frame(18, 22, `fill="none" stroke="${gold}" stroke-width="4"`)}
    ${frame(32, 14, `fill="none" stroke="${gold}" stroke-width="1.5" opacity="0.8"`)}`;
}

// Botanical: roses and lilies, the flowers that run through the 1909 deck.
function rose(cx: number, cy: number, r: number): string {
  const petals: string[] = [];
  for (let ring = 0; ring < 3; ring++) {
    const n = 5;
    const rr = r * (0.62 - ring * 0.17);
    const pr = r * (0.42 - ring * 0.1);
    for (let i = 0; i < n; i++) {
      const [x, y] = polar(cx, cy, rr, i * (360 / n) + ring * 36);
      petals.push(`<circle cx="${f(x)}" cy="${f(y)}" r="${f(pr)}"/>`);
    }
  }
  const spiral = `<path d="M ${cx} ${cy} m -${r * 0.12} 0 a ${r * 0.12} ${r * 0.12} 0 1 1 ${r * 0.24} 0 a ${r * 0.18} ${r * 0.18} 0 1 1 -${r * 0.3} 0" fill="none" stroke="#e8c877" stroke-width="2"/>`;
  return `<g fill="#8e2236" stroke="#e8c877" stroke-width="1.6">${petals.join('')}</g>${spiral}`;
}

function lily(cx: number, cy: number, r: number): string {
  const petals: string[] = [];
  for (let i = 0; i < 6; i++) {
    const [tx, ty] = polar(cx, cy, r, i * 60);
    const [lx, ly] = polar(cx, cy, r * 0.42, i * 60 - 24);
    const [rx, ry] = polar(cx, cy, r * 0.42, i * 60 + 24);
    petals.push(`<path d="M ${cx} ${cy} Q ${f(lx)} ${f(ly)} ${f(tx)} ${f(ty)} Q ${f(rx)} ${f(ry)} ${cx} ${cy} Z"/>`);
  }
  const stamens: string[] = [];
  for (let i = 0; i < 6; i++) {
    const [sx, sy] = polar(cx, cy, r * 0.5, i * 60 + 30);
    stamens.push(`<line x1="${cx}" y1="${cy}" x2="${f(sx)}" y2="${f(sy)}"/><circle cx="${f(sx)}" cy="${f(sy)}" r="3" fill="#e8c877" stroke="none"/>`);
  }
  return `<g fill="#f1e7d0" stroke="#e8c877" stroke-width="1.4">${petals.join('')}</g><g stroke="#e8c877" stroke-width="1.2">${stamens.join('')}</g>`;
}

function leaf(x: number, y: number, len: number, deg: number): string {
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(deg)})"><path d="M 0 0 Q ${f(len * 0.5)} ${f(-len * 0.32)} ${f(len)} 0 Q ${f(len * 0.5)} ${f(len * 0.32)} 0 0 Z"/><line x1="0" y1="0" x2="${f(len * 0.9)}" y2="0" stroke="#e8c877" stroke-width="0.8" opacity="0.7"/></g>`;
}

function botanical(): string {
  const vine = (side: 1 | -1) => {
    const x = side === 1 ? 70 : W - 70;
    const pts: string[] = [];
    const leaves: string[] = [];
    for (let i = 0; i <= 10; i++) {
      const y = 70 + i * 44;
      const wobble = Math.sin(i * 1.3) * 16 * side;
      pts.push(`${f(x + wobble)},${y}`);
      if (i > 0 && i < 10) leaves.push(leaf(x + wobble, y, 26, side === 1 ? (i % 2 ? -30 : 30) : i % 2 ? 210 : 150));
    }
    return `<polyline points="${pts.join(' ')}" fill="none" stroke="#e8c877" stroke-width="1.6"/><g fill="#5f7a3c" stroke="#e8c877" stroke-width="0.8">${leaves.join('')}</g>`;
  };
  const half = `
    ${vine(1)}${vine(-1)}
    ${lily(CX, 250, 70)}
    <g fill="#5f7a3c" stroke="#e8c877" stroke-width="0.8">${leaf(CX - 20, 340, 60, 145)}${leaf(CX + 20, 340, 60, 35)}</g>
    ${rose(150, 360, 44)}${rose(W - 150, 360, 44)}
    ${rose(150, 150, 30)}${rose(W - 150, 150, 30)}`;
  return `
    <defs>
      <radialGradient id="wine" cx="50%" cy="50%" r="72%">
        <stop offset="0" stop-color="#4a1729"/><stop offset="0.6" stop-color="#2f0e1a"/><stop offset="1" stop-color="#1c0810"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#wine)"/>
    ${sym(half)}
    <circle cx="${CX}" cy="${CY}" r="112" fill="#260b15" stroke="#e8c877" stroke-width="2.5"/>
    <circle cx="${CX}" cy="${CY}" r="100" fill="none" stroke="#e8c877" stroke-width="1" stroke-dasharray="3 5"/>
    ${rose(CX, CY, 88)}
    ${frame(18, 20, 'fill="none" stroke="#e8c877" stroke-width="3.5"')}
    ${frame(30, 12, 'fill="none" stroke="#e8c877" stroke-width="1.2" opacity="0.8"')}`;
}

// Sacred geometry: the flower of life, a hexagram, and vesica circles.
function sacredGeometry(): string {
  const gold = '#d4b060';
  const r = 44;
  const centers: [number, number][] = [[CX, CY]];
  for (let ring = 1; ring <= 2; ring++) {
    for (let i = 0; i < 6; i++) {
      const [ax, ay] = polar(CX, CY, r * ring, i * 60);
      if (ring === 1) centers.push([ax, ay]);
      else {
        centers.push([ax, ay]);
        const [bx, by] = polar(CX, CY, r * Math.sqrt(3), i * 60 + 30);
        centers.push([bx, by]);
      }
    }
  }
  const flower = centers.map(([x, y]) => `<circle cx="${f(x)}" cy="${f(y)}" r="${r}"/>`).join('');
  const tri = (deg: number) => {
    const pts = [0, 120, 240].map((a) => polar(CX, CY, 190, a + deg).map(f).join(',')).join(' ');
    return `<polygon points="${pts}"/>`;
  };
  const vesica = (cy: number) =>
    `<circle cx="${CX - 32}" cy="${cy}" r="56"/><circle cx="${CX + 32}" cy="${cy}" r="56"/><circle cx="${CX}" cy="${cy}" r="14"/><line x1="${CX}" y1="${cy - 48}" x2="${CX}" y2="${cy + 48}"/>`;
  const corner = (x: number, y: number) =>
    `<rect x="${x - 18}" y="${y - 18}" width="36" height="36" transform="rotate(45 ${x} ${y})"/><rect x="${x - 10}" y="${y - 10}" width="20" height="20"/><circle cx="${x}" cy="${y}" r="4" fill="${gold}"/>`;
  const dots = Array.from({ length: 9 }, (_, i) => `<circle cx="${120 + i * 45}" cy="100" r="${i % 4 === 0 ? 4 : 2.2}" fill="${gold}"/>`).join('');
  const half = `
    <g fill="none" stroke="${gold}" stroke-width="1.6">${vesica(215)}${corner(72, 72)}${corner(W - 72, 72)}</g>
    ${dots}
    <line x1="${CX}" y1="290" x2="${CX}" y2="${CY - 200}" stroke="${gold}" stroke-width="1.2"/>
    <circle cx="${CX}" cy="${CY - 250}" r="5" fill="${gold}"/>`;
  return `
    <defs>
      <radialGradient id="void" cx="50%" cy="50%" r="72%">
        <stop offset="0" stop-color="#1d1a26"/><stop offset="1" stop-color="#0a090e"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#void)"/>
    ${sym(half)}
    <g fill="none" stroke="${gold}">
      <g stroke-width="1.6">${flower}</g>
      <circle cx="${CX}" cy="${CY}" r="${f(r * 3)}" stroke-width="2.2"/>
      <circle cx="${CX}" cy="${CY}" r="190" stroke-width="1.4"/>
      <circle cx="${CX}" cy="${CY}" r="198" stroke-width="0.8" opacity="0.6"/>
      <g stroke-width="1.3" opacity="0.8">${tri(0)}${tri(180)}</g>
    </g>
    ${frame(20, 6, `fill="none" stroke="${gold}" stroke-width="3"`)}
    ${frame(34, 4, `fill="none" stroke="${gold}" stroke-width="1" opacity="0.7"`)}`;
}

// Minimal: one fine frame and a small emblem on a dark field.
function minimal(): string {
  const gold = '#c9a85e';
  const half = `
    <circle cx="${CX}" cy="${CY - 118}" r="3.5" fill="${gold}"/>
    <circle cx="${CX}" cy="${CY - 138}" r="2" fill="${gold}" opacity="0.7"/>
    <g fill="${gold}">${star(64, 64, 9, 2.2)}${star(W - 64, 64, 9, 2.2)}</g>`;
  return `
    <defs>
      <radialGradient id="field" cx="50%" cy="50%" r="75%">
        <stop offset="0" stop-color="#231f1b"/><stop offset="1" stop-color="#110f0d"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#field)"/>
    ${sym(half)}
    <circle cx="${CX}" cy="${CY}" r="74" fill="none" stroke="${gold}" stroke-width="2"/>
    <circle cx="${CX}" cy="${CY}" r="84" fill="none" stroke="${gold}" stroke-width="0.8" opacity="0.6"/>
    <g fill="${gold}">${star(CX, CY, 52, 15, 8, 0)}</g>
    <circle cx="${CX}" cy="${CY}" r="7" fill="#110f0d"/>
    ${frame(40, 18, `fill="none" stroke="${gold}" stroke-width="2"`)}
    ${frame(52, 12, `fill="none" stroke="${gold}" stroke-width="0.8" opacity="0.55"`)}`;
}

// Neo-futuristic: neon circuitry around a glowing hexagonal core.
function neoFuturistic(): string {
  const cyan = '#29e6ff';
  const magenta = '#ff3fd2';
  // A mirrored bus of traces running from the frame down toward the core.
  const traces: string[] = [];
  const nodes: string[] = [];
  for (let k = 0; k < 5; k++) {
    for (const side of [1, -1] as const) {
      const X = (x: number) => (side === 1 ? x : W - x);
      const x0 = 78 + k * 34;
      const y1 = 104 + k * 22;
      const x2 = CX - 34 - (4 - k) * 16;
      const y2 = y1 + (x2 - x0) * 0.55;
      const y3 = CY - 176 + k * 5;
      const color = k % 2 === 0 ? cyan : magenta;
      traces.push(`<polyline points="${f(X(x0))},52 ${f(X(x0))},${f(y1)} ${f(X(x2))},${f(y2)} ${f(X(x2))},${f(y3)}" stroke="${color}"/>`);
      nodes.push(`<circle cx="${f(X(x2))}" cy="${f(y3)}" r="4.5" fill="#05060c" stroke="${color}" stroke-width="2"/>`);
      nodes.push(`<circle cx="${f(X(x0))}" cy="${f(y1)}" r="2.5" fill="${color}"/>`);
    }
  }
  const hex = (r: number, deg = 0) =>
    `<polygon points="${[0, 60, 120, 180, 240, 300].map((a) => polar(CX, CY, r, a + deg).map(f).join(',')).join(' ')}"/>`;
  const chamfer = (inset: number, c: number) =>
    `<polygon points="${inset + c},${inset} ${W - inset - c},${inset} ${W - inset},${inset + c} ${W - inset},${H - inset - c} ${W - inset - c},${H - inset} ${inset + c},${H - inset} ${inset},${H - inset - c} ${inset},${inset + c}"/>`;
  const grid: string[] = [];
  for (let x = 0; x <= W; x += 30) grid.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}"/>`);
  for (let y = 7; y <= H; y += 30) grid.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}"/>`);
  const half = `
    <g fill="none" stroke-width="2" filter="url(#glow)">${traces.join('')}</g>
    ${nodes.join('')}
    <g fill="${cyan}" opacity="0.8">${[0, 1, 2].map((i) => `<rect x="${CX - 44 + i * 32}" y="86" width="24" height="4"/>`).join('')}</g>
    <g fill="none" stroke="${cyan}" stroke-width="1.2" opacity="0.7">
      <rect x="${CX - 26}" y="${CY - 214}" width="52" height="26" rx="3"/>
      ${[0, 1, 2, 3].map((i) => `<line x1="${CX - 18 + i * 12}" y1="${CY - 188}" x2="${CX - 18 + i * 12}" y2="${CY - 150}"/>`).join('')}
    </g>`;
  return `
    <defs>
      <filter id="glow" x="-20%" y="-20%" width="140%" height="140%">
        <feGaussianBlur stdDeviation="3.5" result="blur"/>
        <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
      </filter>
      <radialGradient id="core" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#ff9ff0"/><stop offset="0.5" stop-color="${magenta}"/><stop offset="1" stop-color="#3a0b40"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="#05060c"/>
    <g stroke="#15204a" stroke-width="1" opacity="0.8">${grid.join('')}</g>
    ${sym(half)}
    <g fill="none" filter="url(#glow)">
      <g stroke="${cyan}" stroke-width="2.5">${hex(128)}</g>
      <g stroke="${magenta}" stroke-width="2">${hex(104, 30)}</g>
      <g stroke="${cyan}" stroke-width="1.5">${hex(80)}</g>
    </g>
    <circle cx="${CX}" cy="${CY}" r="38" fill="url(#core)" filter="url(#glow)"/>
    <circle cx="${CX}" cy="${CY}" r="12" fill="#05060c"/>
    <g fill="none" filter="url(#glow)">
      <g stroke="${cyan}" stroke-width="3">${chamfer(20, 36)}</g>
      <g stroke="${magenta}" stroke-width="1.2" opacity="0.8">${chamfer(34, 30)}</g>
    </g>`;
}

// Winter holiday: snowflakes and holly on deep evergreen.
function snowflake(cx: number, cy: number, r: number, width: number): string {
  const arms: string[] = [];
  for (let i = 0; i < 6; i++) {
    const deg = i * 60;
    const [ex, ey] = polar(cx, cy, r, deg);
    arms.push(`<line x1="${cx}" y1="${cy}" x2="${f(ex)}" y2="${f(ey)}"/>`);
    for (const t of [0.45, 0.7]) {
      const [bx, by] = polar(cx, cy, r * t, deg);
      for (const side of [-1, 1]) {
        const [tx, ty] = polar(bx, by, r * 0.28 * (1.1 - t), deg + side * 45);
        arms.push(`<line x1="${f(bx)}" y1="${f(by)}" x2="${f(tx)}" y2="${f(ty)}"/>`);
      }
    }
  }
  return `<g stroke-width="${width}" stroke-linecap="round">${arms.join('')}</g>`;
}

function hollyLeaf(x: number, y: number, len: number, deg: number): string {
  const spikes = 3;
  const top: string[] = [];
  const bottom: string[] = [];
  for (let i = 1; i <= spikes; i++) {
    const t = i / (spikes + 1);
    const w = Math.sin(Math.PI * t) * len * 0.3;
    top.push(`Q ${f(len * (t - 0.12))} ${f(-w * 0.55)} ${f(len * t)} ${f(-w)}`);
    bottom.unshift(`Q ${f(len * (t + 0.12))} ${f(w * 0.55)} ${f(len * t)} ${f(w)}`);
  }
  const d = `M 0 0 ${top.join(' ')} L ${len} 0 ${bottom.map((q) => q).join(' ')} L 0 0 Z`;
  return `<g transform="translate(${f(x)} ${f(y)}) rotate(${f(deg)})"><path d="${d}"/><line x1="0" y1="0" x2="${f(len * 0.92)}" y2="0" stroke="#d9b75f" stroke-width="1"/></g>`;
}

function winterHoliday(): string {
  const gold = '#d9b75f';
  const flakes = scatter(7, 18, [[CX, 200, 95], [CX, CY, 190]], (x, y, s) =>
    `<g stroke="#e9f4ff" opacity="${f(0.5 + s * 0.45)}">${snowflake(x, y, 8 + s * 14, 1.4)}</g>`,
  );
  const snow = scatter(11, 60, [], (x, y, s) => `<circle cx="${f(x)}" cy="${f(y)}" r="${f(0.8 + s * 1.6)}" fill="#ffffff" opacity="${f(0.35 + s * 0.4)}"/>`);
  const holly = (cx: number, cy: number) => `
    <g fill="#2f6b43" stroke="${gold}" stroke-width="1.2">${hollyLeaf(cx, cy, 70, 200)}${hollyLeaf(cx, cy, 70, -20)}</g>
    <g fill="#c8102e" stroke="#7a0a1c" stroke-width="1">
      <circle cx="${cx - 9}" cy="${cy + 4}" r="9"/><circle cx="${cx + 9}" cy="${cy + 4}" r="9"/><circle cx="${cx}" cy="${cy - 10}" r="9"/>
    </g>
    <g fill="#ffffff" opacity="0.6"><circle cx="${cx - 12}" cy="${cy + 1}" r="2.5"/><circle cx="${cx + 6}" cy="${cy + 1}" r="2.5"/><circle cx="${cx - 3}" cy="${cy - 13}" r="2.5"/></g>`;
  const half = `
    ${snow}
    ${flakes}
    ${holly(CX, 200)}
    <g fill="#c8102e">${[70, W - 70].map((x) => `<circle cx="${x}" cy="70" r="7"/>`).join('')}</g>
    <g fill="#2f6b43" stroke="${gold}" stroke-width="1">${hollyLeaf(70, 70, 34, 30)}${hollyLeaf(W - 70, 70, 34, 150)}</g>`;
  return `
    <defs>
      <radialGradient id="pine" cx="50%" cy="50%" r="72%">
        <stop offset="0" stop-color="#1a4a36"/><stop offset="0.6" stop-color="#11342a"/><stop offset="1" stop-color="#0a2019"/>
      </radialGradient>
      <radialGradient id="ice" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.35"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#pine)"/>
    ${sym(half)}
    <circle cx="${CX}" cy="${CY}" r="150" fill="url(#ice)"/>
    <g stroke="#eef7ff">${snowflake(CX, CY, 118, 5)}</g>
    <circle cx="${CX}" cy="${CY}" r="16" fill="${gold}"/>
    <circle cx="${CX}" cy="${CY}" r="150" fill="none" stroke="${gold}" stroke-width="1.5" stroke-dasharray="1 9" stroke-linecap="round"/>
    ${frame(18, 20, `fill="none" stroke="${gold}" stroke-width="3.5"`)}
    ${frame(30, 12, 'fill="none" stroke="#c8102e" stroke-width="1.5" opacity="0.8"')}`;
}

interface Design {
  id: string;
  name: string;
  description: string;
  draw: () => string;
}

const designs: Design[] = [
  { id: 'celestial', name: 'Celestial', description: 'Sun, moon, and stars in gold on a night sky.', draw: celestial },
  { id: 'botanical', name: 'Botanical', description: 'Roses and lilies, the flowers of the 1909 deck.', draw: botanical },
  { id: 'sacred-geometry', name: 'Sacred geometry', description: 'The flower of life within a hexagram.', draw: sacredGeometry },
  { id: 'minimal', name: 'Minimal', description: 'One fine frame and a small star.', draw: minimal },
  { id: 'neo-futuristic', name: 'Neon circuit', description: 'Glowing circuitry around a hexagonal core.', draw: neoFuturistic },
  { id: 'winter', name: 'Winter', description: 'Snowflakes and holly on deep evergreen.', draw: winterHoliday },
];

const svg = (body: string) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">${body}</svg>`;

for (const [i, design] of designs.entries()) {
  const dir = join(root, 'src/backs', design.id);
  mkdirSync(dir, { recursive: true });
  await sharp(Buffer.from(svg(design.draw()))).webp({ quality: 88 }).toFile(join(dir, 'back.webp'));
  const manifest = {
    id: design.id,
    name: design.name,
    description: design.description,
    license: 'Original artwork for Arcana, covered by the code license (MIT)',
    source: 'Generated by scripts/make-backs.ts',
    aspectRatio: Number((W / H).toFixed(4)),
    order: i + 1,
  };
  writeFileSync(join(dir, 'back.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(`✓ ${design.id}`);
}

if (process.argv.includes('--sheet')) {
  // A contact sheet of every back, the deck's own first, for review.
  const files = [join(root, 'src/decks/rws-1909/back.webp'), ...designs.map((d) => join(root, 'src/backs', d.id, 'back.webp'))];
  const tw = 240;
  const th = Math.round((tw * H) / W);
  const gap = 16;
  const tiles = await Promise.all(files.map((file) => sharp(file).resize(tw, th, { fit: 'fill' }).toBuffer()));
  const sheetW = files.length * (tw + gap) + gap;
  mkdirSync(join(root, '.tmp'), { recursive: true });
  await sharp({ create: { width: sheetW, height: th + gap * 2, channels: 3, background: '#2a2622' } })
    .composite(tiles.map((input, i) => ({ input, left: gap + i * (tw + gap), top: gap })))
    .png()
    .toFile(join(root, '.tmp/backs-sheet.png'));
  console.log('✓ .tmp/backs-sheet.png');
}
