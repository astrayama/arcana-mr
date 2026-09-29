/**
 * Every spread the reader can choose: the built-in ones in this folder, then
 * the ones they've built in the headset. The built-ins are found
 * automatically, so adding a spread is adding a JSON file here.
 */

import { signal } from '@iwsdk/core';
import { validateSpread, type SpreadDef } from './spread.schema.js';

const files = import.meta.glob<Omit<SpreadDef, 'origin'>>('./*.json', { eager: true, import: 'default' });

function loadBuiltins(): SpreadDef[] {
  const spreads: SpreadDef[] = [];
  for (const [path, data] of Object.entries(files)) {
    const fileId = path.replace(/^\.\//, '').replace(/\.json$/, '');
    const result = validateSpread(data, fileId);
    if (!result.ok) {
      console.error(`[arcana] spread "${fileId}" is invalid and was skipped:\n${result.errors.join('\n')}`);
      continue;
    }
    spreads.push({ ...data, origin: 'builtin' });
  }
  return spreads.sort((a, b) => (a.order ?? 99) - (b.order ?? 99) || a.name.localeCompare(b.name));
}

export const builtinSpreads: readonly SpreadDef[] = loadBuiltins();

/** Spreads made in the headset, kept in step with what's saved on the device. */
export const customSpreads = signal<readonly SpreadDef[]>([]);

export function getSpread(id: string): SpreadDef | undefined {
  return builtinSpreads.find((s) => s.id === id) ?? customSpreads.peek().find((s) => s.id === id);
}
