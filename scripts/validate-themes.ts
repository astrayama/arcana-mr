/**
 * Validates every theme under src/themes/.
 *
 *   npm run validate:themes
 */

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.ts';
import { validateTheme } from '../src/themes/theme.schema.ts';

const themesDir = join(import.meta.dirname, '..', 'src/themes');
let failed = false;
const ids = readdirSync(themesDir, { withFileTypes: true })
  .filter((e) => e.isDirectory() && existsSync(join(themesDir, e.name, 'theme.json')))
  .map((e) => e.name);

if (!ids.includes(config.defaults.theme)) {
  console.error(`✗ default theme "${config.defaults.theme}" not found in src/themes/`);
  failed = true;
}
for (const id of ids) {
  const dir = join(themesDir, id);
  const theme = JSON.parse(readFileSync(join(dir, 'theme.json'), 'utf8'));
  const result = validateTheme(theme, id, (p) => existsSync(join(dir, p)));
  if (result.ok) {
    console.log(`✓ theme ${id}`);
  } else {
    failed = true;
    for (const e of result.errors) console.error(`✗ ${e}`);
  }
}
process.exit(failed ? 1 : 0);
