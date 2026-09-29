/**
 * Validates every card back under src/backs/: the manifest, the image, and
 * that the design looks the same turned upside down (so a reversed card
 * can't be spotted from its back).
 *
 *   npm run validate:backs
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { validateBackManifest } from '../src/backs/back.schema.ts';

const backsDir = join(import.meta.dirname, '..', 'src/backs');
/** Average difference per channel (0-255) allowed between a back and its 180-degree turn. */
const MAX_ASYMMETRY = 3;
let failed = false;

const ids = readdirSync(backsDir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => e.name);

for (const id of ids) {
  const dir = join(backsDir, id);
  const manifestPath = join(dir, 'back.json');
  if (!existsSync(manifestPath)) {
    console.error(`✗ backs/${id}: back.json is missing`);
    failed = true;
    continue;
  }
  const errors = validateBackManifest(JSON.parse(readFileSync(manifestPath, 'utf8')), id, (p) => existsSync(join(dir, p)));
  if (errors.length === 0) {
    const image = sharp(join(dir, 'back.webp')).removeAlpha().resize(150, 258, { fit: 'fill' }).raw();
    const a = await image.clone().toBuffer();
    const b = await image.clone().rotate(180).toBuffer();
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff += Math.abs(a[i] - b[i]);
    const mean = diff / a.length;
    if (mean > MAX_ASYMMETRY) errors.push(`backs/${id}: not symmetric when turned upside down (difference ${mean.toFixed(2)})`);
  }
  if (errors.length) {
    failed = true;
    for (const e of errors) console.error(`✗ ${e}`);
  } else {
    console.log(`✓ back ${id}`);
  }
}
process.exit(failed ? 1 : 0);
