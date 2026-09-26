/**
 * Environment generators by the `kind` a theme names. Adding a new kind means
 * a new builder here; themes then pick it and tune it in theme.json.
 */

import type { ThemeEnvironment } from '../themes/theme.schema.js';
import { buildNightSanctum } from './nightSanctum.js';
import type { EnvironmentBuilder } from './types.js';

export const environmentBuilders: Record<ThemeEnvironment['kind'], EnvironmentBuilder> = {
  'night-sanctum': buildNightSanctum,
};
