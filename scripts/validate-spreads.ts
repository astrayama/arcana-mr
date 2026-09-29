/**
 * Validates every built-in spread under src/spreads/ and checks that each one
 * fits on the mat without overlaps.
 *
 *   npm run validate:spreads
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from '../src/config.ts';
import { validateSpread, type SpreadDef } from '../src/spreads/spread.schema.ts';
import { layoutRules } from '../src/visuals/layout.ts';
import { findOverlaps, fitSpread } from '../src/visuals/spreadLayout.ts';

const dir = join(import.meta.dirname, '..', 'src/spreads');
// The 1909 deck's proportions; other decks are checked in the headset.
const rules = layoutRules(config.card.widthM / 0.5801, 2);
let failed = false;
for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
  const id = file.replace(/\.json$/, '');
  const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  const errors = validateSpread(data, id).errors;
  if (errors.length === 0) {
    const layout = fitSpread({ ...(data as SpreadDef), origin: 'builtin' }, rules);
    errors.push(...findOverlaps(layout).map((p) => `${id}: ${p}`));
    if (layout.clipped) errors.push(`${id}: too big for the largest mat, even with the smallest cards`);
  }
  if (errors.length) {
    failed = true;
    for (const e of errors) console.error(`✗ ${e}`);
  } else {
    console.log(`✓ spread ${id}`);
  }
}
process.exit(failed ? 1 : 0);
