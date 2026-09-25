/**
 * Builds the `rws-1909` deck from the public-domain 1909 "Roses & Lilies"
 * Waite-Smith scans on Wikimedia Commons. Reproducible and self-checking:
 *
 *   1. lists the Commons category and maps every file to a card id,
 *      confirming the file's own description names that card
 *   2. requires a public-domain license template and a 1909 date on each file
 *   3. downloads originals (cached in .tmp/) and verifies their SHA-1
 *   4. writes uniform WebP faces + back, deck.json, and the CREDITS.md table
 *
 * Run once when (re)building the deck:  npx tsx scripts/fetch-rws-1909.ts
 * The app itself never contacts Wikimedia; it only serves the output files.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import type { CardData } from '../src/data/cards.schema.ts';
import type { DeckManifest } from '../src/decks/deck.schema.ts';

const ROOT = join(import.meta.dirname, '..');
const DECK_DIR = join(ROOT, 'src/decks/rws-1909');
const CACHE_DIR = join(ROOT, '.tmp/rws-1909-src');
const CATEGORY = 'Category:Rider-Waite tarot deck (Roses & Lilies)';
const BACK_FILE = 'File:Waite–Smith Tarot Roses and Lilies cropped.jpg';
const API = 'https://commons.wikimedia.org/w/api.php';
const USER_AGENT = 'arcana-mr-deck-builder/1.0 (https://github.com/astrayama/arcana-mr)';

/** Output size. Uniform so every card renders identically; 0.58 matches the scans' average shape. */
const WIDTH = 594;
const HEIGHT = 1024;
const WEBP_QUALITY = 82;

interface CommonsFile {
  title: string;
  url: string;
  pageUrl: string;
  sha1: string;
  description: string;
  wikitext: string;
}

async function api(params: Record<string, string>): Promise<any> {
  const url = `${API}?${new URLSearchParams({ ...params, format: 'json' })}`;
  const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) throw new Error(`Commons API ${response.status} for ${url}`);
  return response.json();
}

async function listCategory(): Promise<string[]> {
  const titles: string[] = [];
  let cont: Record<string, string> = {};
  for (;;) {
    const data = await api({
      action: 'query',
      list: 'categorymembers',
      cmtitle: CATEGORY,
      cmlimit: '500',
      cmtype: 'file',
      ...cont,
    });
    titles.push(...data.query.categorymembers.map((m: { title: string }) => m.title));
    if (!data.continue) return titles;
    cont = data.continue;
  }
}

async function describe(titles: string[]): Promise<Map<string, CommonsFile>> {
  const files = new Map<string, CommonsFile>();
  for (let i = 0; i < titles.length; i += 20) {
    const batch = titles.slice(i, i + 20).join('|');
    const data = await api({
      action: 'query',
      titles: batch,
      prop: 'imageinfo|revisions',
      iiprop: 'url|sha1|extmetadata',
      rvprop: 'content',
      rvslots: 'main',
    });
    for (const page of Object.values<any>(data.query.pages)) {
      const info = page.imageinfo[0];
      files.set(page.title, {
        title: page.title,
        url: info.url,
        pageUrl: info.descriptionurl,
        sha1: info.sha1,
        description: String(info.extmetadata?.ImageDescription?.value ?? '').replace(/<[^>]+>/g, ''),
        wikitext: page.revisions[0].slots.main['*'],
      });
    }
  }
  return files;
}

const SUIT_NAMES: Record<string, CardData['suit']> = {
  Cups: 'cups',
  Pentacles: 'pentacles',
  Swords: 'swords',
  Wands: 'wands',
};

/** "File:RWS1909 - 17 Star.jpeg" or "File:RWS1909 - Cups 13.jpeg" to the matching card. */
function cardForFile(title: string, cards: CardData[]): CardData | undefined {
  const major = title.match(/^File:RWS1909 - (\d{2}) .+\.jpe?g$/);
  if (major) {
    return cards.find((c) => c.arcana === 'major' && c.number === Number(major[1]));
  }
  const minor = title.match(/^File:RWS1909 - (Cups|Pentacles|Swords|Wands) (\d{2})\.jpe?g$/);
  if (minor) {
    const suit = SUIT_NAMES[minor[1]];
    return cards.find((c) => c.suit === suit && c.number === Number(minor[2]));
  }
  return undefined;
}

function licenseTemplates(wikitext: string): string[] {
  return [...wikitext.matchAll(/\{\{\s*(PD-[^}|\s]+)/g)].map((m) => m[1]);
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Wikimedia rate-limits bulk downloads: pace requests and back off on 429. */
async function fetchPolitely(url: string): Promise<Buffer> {
  for (let attempt = 0; attempt < 6; attempt++) {
    await sleep(1500);
    const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT } });
    if (response.ok) return Buffer.from(await response.arrayBuffer());
    if (response.status !== 429 && response.status < 500) {
      throw new Error(`download ${response.status}: ${url}`);
    }
    const retryAfter = Number(response.headers.get('retry-after')) || 10 * (attempt + 1);
    console.warn(`\n${response.status} from Commons, waiting ${retryAfter}s`);
    await sleep(retryAfter * 1000);
  }
  throw new Error(`gave up downloading ${url}`);
}

async function download(file: CommonsFile): Promise<Buffer> {
  const cached = join(CACHE_DIR, `${file.sha1}.jpg`);
  let bytes: Buffer;
  if (existsSync(cached)) {
    bytes = readFileSync(cached);
  } else {
    bytes = await fetchPolitely(file.url);
    writeFileSync(cached, bytes);
  }
  const sha1 = createHash('sha1').update(bytes).digest('hex');
  if (sha1 !== file.sha1) throw new Error(`SHA-1 mismatch for ${file.title}`);
  return bytes;
}

async function toWebp(bytes: Buffer, outPath: string): Promise<void> {
  const image = sharp(bytes).rotate();
  const { width = 0, height = 0 } = await image.metadata();
  // Trim a hair off every edge to drop scanner fringe, then normalize the shape.
  const inset = Math.round(Math.min(width, height) * 0.006);
  await image
    .extract({ left: inset, top: inset, width: width - 2 * inset, height: height - 2 * inset })
    .resize(WIDTH, HEIGHT, { fit: 'fill', kernel: 'lanczos3' })
    .webp({ quality: WEBP_QUALITY, effort: 6 })
    .toFile(outPath);
}

const escapeCell = (text: string) => text.replace(/\|/g, '\\|');

async function main(): Promise<void> {
  const cards = JSON.parse(readFileSync(join(ROOT, 'src/data/cards.json'), 'utf8')) as CardData[];
  mkdirSync(CACHE_DIR, { recursive: true });
  mkdirSync(join(DECK_DIR, 'faces'), { recursive: true });

  const titles = await listCategory();
  const files = await describe([...titles.filter((t) => t.startsWith('File:RWS1909 - ')), BACK_FILE]);
  const problems: string[] = [];

  // 1. Map and verify every face.
  const faces = new Map<string, CommonsFile>();
  for (const file of files.values()) {
    if (file.title === BACK_FILE) continue;
    const card = cardForFile(file.title, cards);
    if (!card) {
      problems.push(`no card matches ${file.title}`);
      continue;
    }
    const expectedName = card.name.replace(/^The /, '');
    if (!file.description.toLowerCase().includes(expectedName.toLowerCase())) {
      problems.push(`${file.title}: description does not name "${card.name}"`);
    }
    if (faces.has(card.id)) problems.push(`two files map to ${card.id}`);
    faces.set(card.id, file);
  }
  for (const card of cards) {
    if (!faces.has(card.id)) problems.push(`no scan found for ${card.id}`);
  }

  // 2. Every file needs a public-domain template and a 1909 date.
  const back = files.get(BACK_FILE);
  if (!back) problems.push(`card back ${BACK_FILE} not found`);
  for (const file of [...faces.values(), ...(back ? [back] : [])]) {
    if (licenseTemplates(file.wikitext).length === 0) {
      problems.push(`${file.title}: no public-domain license template`);
    }
    if (!/\|\s*date\s*=\s*1909/.test(file.wikitext)) {
      problems.push(`${file.title}: not dated 1909`);
    }
  }

  if (problems.length > 0) {
    console.error('Stopping: the source set is not clean.\n' + problems.map((p) => `  - ${p}`).join('\n'));
    process.exit(1);
  }

  // 3 + 4. Download, verify, convert.
  const manifest: DeckManifest = {
    id: 'rws-1909',
    name: 'Rider-Waite-Smith (1909)',
    license: 'Public domain',
    source:
      'Original 1909 "Roses & Lilies" printing, illustrated by Pamela Colman Smith. ' +
      'Scans via Wikimedia Commons; per-card sources in CREDITS.md.',
    aspectRatio: Number((WIDTH / HEIGHT).toFixed(4)),
    back: 'back.webp',
    faces: {},
  };

  await toWebp(await download(back!), join(DECK_DIR, 'back.webp'));
  const rows: string[] = [];
  for (const card of cards) {
    const file = faces.get(card.id)!;
    const relative = `faces/${card.id}.webp`;
    await toWebp(await download(file), join(DECK_DIR, relative));
    manifest.faces[card.id] = relative;
    rows.push(
      `| ${card.name} | \`${relative}\` | [${escapeCell(file.title.slice(5))}](${file.pageUrl}) | ${licenseTemplates(file.wikitext).join(', ')} |`,
    );
    process.stdout.write('.');
  }
  console.log();

  writeFileSync(join(DECK_DIR, 'deck.json'), JSON.stringify(manifest, null, 2) + '\n');

  const credits = `# Credits

## Card art: \`src/decks/rws-1909\`

The \`rws-1909\` deck uses scans of an original 1909 printing of the
Waite-Smith tarot (often called Rider-Waite-Smith), the "Roses & Lilies"
edition published by William Rider & Son, London. The cards were illustrated
by Pamela Colman Smith (1878-1951) to designs by Arthur Edward Waite.

**License:** public domain. The art was published in 1909 and its illustrator
died in 1951, so it is in the public domain in the United States and in
countries with copyright terms of life plus 70 years or less. The scans are
faithful reproductions of two-dimensional artwork. Each file's Wikimedia
Commons page, linked below, records its license template.

The scans come from Wikimedia Commons (category
[Rider-Waite tarot deck (Roses & Lilies)](https://commons.wikimedia.org/wiki/${encodeURIComponent(CATEGORY.replace(/ /g, '_'))})),
where the uploader notes they were made from an original 1909 deck in a
private collection. Only these original 1909 scans are used. No modern
recolored or redrawn edition is included.

Processing: \`scripts/fetch-rws-1909.ts\` trims about 0.6% from each edge,
resizes every card to ${WIDTH} x ${HEIGHT}, and encodes WebP at quality
${WEBP_QUALITY}. The 3D cards have rounded corners, like the physical deck.

### Card back

| File | Source | License |
| --- | --- | --- |
| \`back.webp\` | [${escapeCell(back!.title.slice(5))}](${back!.pageUrl}) | ${licenseTemplates(back!.wikitext).join(', ')} |

### Card faces

| Card | File | Source | License |
| --- | --- | --- | --- |
${rows.join('\n')}
`;
  writeFileSync(join(ROOT, 'CREDITS.md'), credits);
  console.log(`Wrote ${cards.length} faces, back, deck.json, and CREDITS.md`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
