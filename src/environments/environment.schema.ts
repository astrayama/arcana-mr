/**
 * VR surroundings: each one is a folder in src/environments/<id>/ with an
 * environment.json and its textures. Separate from themes, so surroundings
 * can be added (or, later, uploaded) on their own. Pure, for scripts and tests.
 */

/** The generators that can build VR surroundings. */
export const ENVIRONMENT_KINDS = ['night-sanctum', 'cloud-sea'] as const;

/** Settings every environment shares. */
interface EnvironmentBase {
  /** Kebab-case, matching the folder name, not "room". Used in `?view=<id>`. */
  id: string;
  /** Label in Settings, e.g. "Night sky". */
  label: string;
  /** Sort order in Settings. */
  order?: number;
  fog: { color: string; density: number };
}

/** A round stone platform under a starry sky, ringed by standing stones. */
export interface NightSanctumEnvironment extends EnvironmentBase {
  kind: 'night-sanctum';
  sky: { top: string; horizon: string; bottom: string };
  stars: { count: number; color: string };
  moon: { color: string } | null;
  floor: { texture: string; normal: string | null; color: string; radiusM: number };
  stones: { texture: string; normal: string | null; color: string; count: number; ringRadiusM: number };
  flameColor: string;
  fireflies: { count: number; color: string } | null;
}

/** A small terrace floating above a sea of clouds at sunset. */
export interface CloudSeaEnvironment extends EnvironmentBase {
  kind: 'cloud-sea';
  /** Sky gradient from overhead down to below the horizon. */
  sky: { zenith: string; upper: string; horizon: string; below: string };
  sun: { color: string; elevationDeg: number; azimuthDeg: number };
  clouds: { lit: string; shade: string; speed: number };
  /** `texture` is optional: a pale stone often reads best as color plus the normal map's relief. */
  terrace: { texture: string | null; normal: string | null; color: string; radiusM: number; railColor: string };
  birds: { count: number; color: string } | null;
}

/**
 * VR surroundings shown instead of passthrough when the reader chooses them.
 * `kind` picks a generator in src/environments; the rest tunes its look.
 */
export type EnvironmentDef = NightSanctumEnvironment | CloudSeaEnvironment;

const HEX = /^#[0-9a-fA-F]{6}$/;

/**
 * Check one environment.json. `fileExists` resolves texture paths relative
 * to the environment's folder (they may point into ../shared/).
 */
export function validateEnvironment(
  data: unknown,
  folderId: string,
  fileExists: (path: string) => boolean,
): { ok: boolean; errors: string[] } {
  const errors: string[] = [];
  const at = `environments/${folderId}/environment.json`;
  if (typeof data !== 'object' || data === null) return { ok: false, errors: [`${at}: not an object`] };
  const e = data as EnvironmentDef;
  const hex = (label: string, value: unknown) => {
    if (typeof value !== 'string' || !HEX.test(value)) errors.push(`${at}: ${label} must be a #rrggbb color`);
  };
  const num = (label: string, value: unknown, min: number, max: number) => {
    if (typeof value !== 'number' || value < min || value > max) {
      errors.push(`${at}: ${label} must be a number from ${min} to ${max}`);
    }
  };
  const file = (label: string, path: unknown) => {
    if (typeof path !== 'string' || !fileExists(path)) errors.push(`${at}: ${label} "${String(path)}" not found`);
  };

  // Kebab-case; surroundings added on the headset carry a "device:" prefix.
  if (typeof e.id !== 'string' || !/^(device:)?[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id) || e.id === 'room') {
    errors.push(`${at}: id must be kebab-case and not "room"`);
  } else if (e.id !== folderId) {
    errors.push(`${at}: id "${e.id}" must match the folder name`);
  }
  if (e.order !== undefined && typeof e.order !== 'number') errors.push(`${at}: order must be a number`);
  if (typeof e.label !== 'string' || !e.label) errors.push(`${at}: label missing`);
  hex(`fog.color`, e.fog?.color);
  num(`fog.density`, e.fog?.density, 0, 1);
  if (e.kind === 'night-sanctum') {
    for (const key of ['top', 'horizon', 'bottom'] as const) hex(`sky.${key}`, e.sky?.[key]);
    num(`stars.count`, e.stars?.count, 0, 5000);
    hex(`stars.color`, e.stars?.color);
    if (e.moon) hex(`moon.color`, e.moon.color);
    file(`floor.texture`, e.floor?.texture);
    if (e.floor?.normal) file(`floor.normal`, e.floor.normal);
    hex(`floor.color`, e.floor?.color);
    num(`floor.radiusM`, e.floor?.radiusM, 1, 20);
    file(`stones.texture`, e.stones?.texture);
    if (e.stones?.normal) file(`stones.normal`, e.stones.normal);
    hex(`stones.color`, e.stones?.color);
    num(`stones.count`, e.stones?.count, 0, 24);
    num(`stones.ringRadiusM`, e.stones?.ringRadiusM, 1, 20);
    hex(`flameColor`, e.flameColor);
    if (e.fireflies) {
      num(`fireflies.count`, e.fireflies.count, 0, 500);
      hex(`fireflies.color`, e.fireflies.color);
    }
  } else if (e.kind === 'cloud-sea') {
    for (const key of ['zenith', 'upper', 'horizon', 'below'] as const) hex(`sky.${key}`, e.sky?.[key]);
    hex(`sun.color`, e.sun?.color);
    num(`sun.elevationDeg`, e.sun?.elevationDeg, -5, 60);
    num(`sun.azimuthDeg`, e.sun?.azimuthDeg, -180, 180);
    hex(`clouds.lit`, e.clouds?.lit);
    hex(`clouds.shade`, e.clouds?.shade);
    num(`clouds.speed`, e.clouds?.speed, 0, 1);
    if (e.terrace?.texture) file(`terrace.texture`, e.terrace.texture);
    if (e.terrace?.normal) file(`terrace.normal`, e.terrace.normal);
    hex(`terrace.color`, e.terrace?.color);
    num(`terrace.radiusM`, e.terrace?.radiusM, 1.5, 10);
    hex(`terrace.railColor`, e.terrace?.railColor);
    if (e.birds) {
      num(`birds.count`, e.birds.count, 0, 30);
      hex(`birds.color`, e.birds.color);
    }
  } else {
    errors.push(`${at}: kind must be one of ${ENVIRONMENT_KINDS.join(', ')}`);
  }
  return { ok: errors.length === 0, errors };
}
