/**
 * Validates every VR environment under src/environments/<id>/environment.json.
 *
 *   npm run validate:environments
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, normalize } from 'node:path';
import { validateEnvironment } from '../src/environments/environment.schema.ts';

const dir = join(import.meta.dirname, '..', 'src/environments');
let failed = false;
const ids = readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, 'environment.json')))
  .map((e) => e.name);
for (const id of ids) {
  const folder = join(dir, id);
  const data = JSON.parse(readFileSync(join(folder, 'environment.json'), 'utf8'));
  // Texture paths are relative to the environment's folder and may reach into ../shared/.
  const result = validateEnvironment(data, id, (p) => {
    const full = normalize(join(folder, p));
    return full.startsWith(dir) && existsSync(full);
  });
  if (result.ok) {
    console.log(`✓ environment ${id}`);
  } else {
    failed = true;
    for (const e of result.errors) console.error(`✗ ${e}`);
  }
}
process.exit(failed ? 1 : 0);
