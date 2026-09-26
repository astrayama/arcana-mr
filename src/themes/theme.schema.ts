/**
 * Theme format. A theme is a folder under `src/themes/<id>/` holding a
 * `theme.json` plus optional assets. Themes change the look only: they never
 * touch reading logic or layout sizes.
 */

/** Fonts that ship with the UI kit as ready-made MSDF atlases. No files needed. */
export const BUNDLED_FONT_FAMILIES = [
  'crimson-text',
  'fira-code',
  'inconsolata',
  'inter',
  'lato',
  'libre-baskerville',
  'merriweather',
  'montserrat',
  'nunito',
  'open-sans',
  'playfair-display',
  'poppins',
  'raleway',
  'roboto',
  'source-code-pro',
  'space-mono',
  'work-sans',
] as const;

export interface ThemeFont {
  /** A bundled family name, or any name when `files` supplies TTFs. */
  family: string;
  /** Optional TTFs by weight (e.g. "400", "700"), relative to the theme folder. */
  files?: Record<string, string>;
}

export interface ThemeColors {
  /** Panel fill. */
  panelBackground: string;
  /** Panel outline and dividers. */
  panelBorder: string;
  /** Main panel text. */
  panelText: string;
  /** Secondary panel text (labels, hints). */
  panelMuted: string;
  /** Buttons, keywords, and other accents. */
  accent: string;
  /** Text drawn on top of `accent`. */
  accentText: string;
  /** Hover and selection highlight on cards and buttons. */
  highlight: string;
  /** Upright badge color. */
  upright: string;
  /** Reversed badge color. */
  reversed: string;
}

/** Built-in environment generators a theme can use for its VR surroundings. */
export const ENVIRONMENT_KINDS = ['night-sanctum', 'cloud-sea'] as const;
export const MAX_ENVIRONMENTS = 3;

/** Settings every environment shares. */
interface EnvironmentBase {
  /** Kebab-case, unique within the theme, not "room". Used in `?view=<id>`. */
  id: string;
  /** Label on the menu toggle, e.g. "Night sky". */
  label: string;
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
export type ThemeEnvironment = NightSanctumEnvironment | CloudSeaEnvironment;

export interface Theme {
  /** Must match the folder name. */
  id: string;
  name: string;
  description: string;
  colors: ThemeColors;
  /** Null means the UI kit's default font. */
  fonts: { heading: ThemeFont | null; body: ThemeFont | null };
  /** Panel corner radius in UIKit units (centimeters). */
  panelRadius: number;
  /** The cloth under the cards. */
  mat: {
    color: string;
    edgeColor: string;
    /** Optional tiling cloth texture, relative to the theme folder. */
    texture: string | null;
    /** How many times the texture repeats across the mat's width. */
    textureRepeat: number;
    roughness: number;
    /** A thin line in `edgeColor` set in from the mat's edge, like a reading cloth border. */
    inlay: boolean;
  };
  /** Card feedback when a hand or ray is on it. */
  cardHighlight: {
    color: string;
    /** Glow strength, 0 to 1. */
    intensity: number;
    /** How far a hovered card lifts off the mat, in meters. */
    hoverLiftM: number;
  };
  /** Optional atmosphere. Each effect is off when null. */
  ambient: {
    candles: { count: number; color: string; intensity: number } | null;
    particles: { count: number; color: string; size: number } | null;
  };
  /** VR surroundings offered instead of passthrough (up to 3); empty means passthrough only. */
  environments: ThemeEnvironment[];
  /** Image-based light gradient for card and mat materials (RGBA, 0-1). */
  lighting: {
    sky: [number, number, number, number];
    equator: [number, number, number, number];
    ground: [number, number, number, number];
    intensity: number;
  };
}

const HEX = /^#[0-9a-f]{6}$/i;
const COLOR_KEYS: (keyof ThemeColors)[] = [
  'panelBackground',
  'panelBorder',
  'panelText',
  'panelMuted',
  'accent',
  'accentText',
  'highlight',
  'upright',
  'reversed',
];

export interface ThemeValidationResult {
  ok: boolean;
  errors: string[];
}

/** Validate a parsed `theme.json`. `fileExists` checks a theme-relative path. */
export function validateTheme(
  data: unknown,
  folderId: string,
  fileExists: (relativePath: string) => boolean,
): ThemeValidationResult {
  const errors: string[] = [];
  const at = `themes/${folderId}/theme.json`;
  if (typeof data !== 'object' || data === null) {
    return { ok: false, errors: [`${at}: not an object`] };
  }
  const t = data as Partial<Theme>;
  const hex = (label: string, value: unknown) => {
    if (typeof value !== 'string' || !HEX.test(value)) {
      errors.push(`${at}: ${label} must be a #rrggbb color`);
    }
  };
  const num = (label: string, value: unknown, min: number, max: number) => {
    if (typeof value !== 'number' || value < min || value > max) {
      errors.push(`${at}: ${label} must be a number from ${min} to ${max}`);
    }
  };
  const file = (label: string, path: unknown) => {
    if (typeof path !== 'string' || !fileExists(path)) {
      errors.push(`${at}: ${label} "${String(path)}" not found`);
    }
  };

  if (t.id !== folderId) errors.push(`${at}: "id" must match the folder name "${folderId}"`);
  if (typeof t.name !== 'string' || !t.name) errors.push(`${at}: "name" missing`);
  if (typeof t.description !== 'string') errors.push(`${at}: "description" missing`);

  if (typeof t.colors !== 'object' || t.colors === null) {
    errors.push(`${at}: "colors" missing`);
  } else {
    for (const key of COLOR_KEYS) hex(`colors.${key}`, t.colors[key]);
  }

  for (const slot of ['heading', 'body'] as const) {
    const font = t.fonts?.[slot];
    if (t.fonts === undefined || font === undefined) {
      errors.push(`${at}: fonts.${slot} missing (use null for the default font)`);
    } else if (font !== null) {
      const files = Object.entries(font.files ?? {});
      if (typeof font.family !== 'string' || !font.family) {
        errors.push(`${at}: fonts.${slot}.family missing`);
      } else if (
        files.length === 0 &&
        !(BUNDLED_FONT_FAMILIES as readonly string[]).includes(font.family)
      ) {
        errors.push(
          `${at}: fonts.${slot}.family "${font.family}" is not bundled; add "files" with TTFs or use one of ${BUNDLED_FONT_FAMILIES.join(', ')}`,
        );
      }
      for (const [weight, path] of files) {
        file(`fonts.${slot}.files.${weight}`, path);
      }
    }
  }

  num('panelRadius', t.panelRadius, 0, 10);

  if (!t.mat) {
    errors.push(`${at}: "mat" missing`);
  } else {
    hex('mat.color', t.mat.color);
    hex('mat.edgeColor', t.mat.edgeColor);
    if (t.mat.texture !== null) file('mat.texture', t.mat.texture);
    num('mat.textureRepeat', t.mat.textureRepeat, 0.1, 50);
    num('mat.roughness', t.mat.roughness, 0, 1);
    if (typeof t.mat.inlay !== 'boolean') errors.push(`${at}: mat.inlay must be true or false`);
  }

  if (!t.cardHighlight) {
    errors.push(`${at}: "cardHighlight" missing`);
  } else {
    hex('cardHighlight.color', t.cardHighlight.color);
    num('cardHighlight.intensity', t.cardHighlight.intensity, 0, 1);
    num('cardHighlight.hoverLiftM', t.cardHighlight.hoverLiftM, 0, 0.05);
  }

  if (!t.ambient) {
    errors.push(`${at}: "ambient" missing (use null for each effect you don't want)`);
  } else {
    if (t.ambient.candles) {
      num('ambient.candles.count', t.ambient.candles.count, 0, 12);
      hex('ambient.candles.color', t.ambient.candles.color);
      num('ambient.candles.intensity', t.ambient.candles.intensity, 0, 5);
    }
    if (t.ambient.particles) {
      num('ambient.particles.count', t.ambient.particles.count, 0, 500);
      hex('ambient.particles.color', t.ambient.particles.color);
      num('ambient.particles.size', t.ambient.particles.size, 0, 0.05);
    }
  }

  if ('environment' in t) {
    errors.push(`${at}: "environment" is now "environments", a list; wrap it in [ ] and give it an "id"`);
  }
  if (!Array.isArray(t.environments)) {
    errors.push(`${at}: "environments" must be a list (use [] for passthrough only)`);
  } else {
    if (t.environments.length > MAX_ENVIRONMENTS) {
      errors.push(`${at}: at most ${MAX_ENVIRONMENTS} environments`);
    }
    const ids = new Set<string>();
    t.environments.forEach((e, i) => {
      const where = `environments[${i}]`;
      if (typeof e.id !== 'string' || !/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.id) || e.id === 'room') {
        errors.push(`${at}: ${where}.id must be kebab-case and not "room"`);
      } else if (ids.has(e.id)) {
        errors.push(`${at}: ${where}.id "${e.id}" is used twice`);
      } else {
        ids.add(e.id);
      }
      if (typeof e.label !== 'string' || !e.label) errors.push(`${at}: ${where}.label missing`);
      hex(`${where}.fog.color`, e.fog?.color);
      num(`${where}.fog.density`, e.fog?.density, 0, 1);
      if (e.kind === 'night-sanctum') {
        for (const key of ['top', 'horizon', 'bottom'] as const) hex(`${where}.sky.${key}`, e.sky?.[key]);
        num(`${where}.stars.count`, e.stars?.count, 0, 5000);
        hex(`${where}.stars.color`, e.stars?.color);
        if (e.moon) hex(`${where}.moon.color`, e.moon.color);
        file(`${where}.floor.texture`, e.floor?.texture);
        if (e.floor?.normal) file(`${where}.floor.normal`, e.floor.normal);
        hex(`${where}.floor.color`, e.floor?.color);
        num(`${where}.floor.radiusM`, e.floor?.radiusM, 1, 20);
        file(`${where}.stones.texture`, e.stones?.texture);
        if (e.stones?.normal) file(`${where}.stones.normal`, e.stones.normal);
        hex(`${where}.stones.color`, e.stones?.color);
        num(`${where}.stones.count`, e.stones?.count, 0, 24);
        num(`${where}.stones.ringRadiusM`, e.stones?.ringRadiusM, 1, 20);
        hex(`${where}.flameColor`, e.flameColor);
        if (e.fireflies) {
          num(`${where}.fireflies.count`, e.fireflies.count, 0, 500);
          hex(`${where}.fireflies.color`, e.fireflies.color);
        }
      } else if (e.kind === 'cloud-sea') {
        for (const key of ['zenith', 'upper', 'horizon', 'below'] as const) hex(`${where}.sky.${key}`, e.sky?.[key]);
        hex(`${where}.sun.color`, e.sun?.color);
        num(`${where}.sun.elevationDeg`, e.sun?.elevationDeg, -5, 60);
        num(`${where}.sun.azimuthDeg`, e.sun?.azimuthDeg, -180, 180);
        hex(`${where}.clouds.lit`, e.clouds?.lit);
        hex(`${where}.clouds.shade`, e.clouds?.shade);
        num(`${where}.clouds.speed`, e.clouds?.speed, 0, 1);
        if (e.terrace?.texture) file(`${where}.terrace.texture`, e.terrace.texture);
        if (e.terrace?.normal) file(`${where}.terrace.normal`, e.terrace.normal);
        hex(`${where}.terrace.color`, e.terrace?.color);
        num(`${where}.terrace.radiusM`, e.terrace?.radiusM, 1.5, 10);
        hex(`${where}.terrace.railColor`, e.terrace?.railColor);
        if (e.birds) {
          num(`${where}.birds.count`, e.birds.count, 0, 30);
          hex(`${where}.birds.color`, e.birds.color);
        }
      } else {
        errors.push(`${at}: ${where}.kind must be one of ${ENVIRONMENT_KINDS.join(', ')}`);
      }
    });
  }

  if (!t.lighting) {
    errors.push(`${at}: "lighting" missing`);
  } else {
    for (const key of ['sky', 'equator', 'ground'] as const) {
      const rgba = t.lighting[key];
      if (!Array.isArray(rgba) || rgba.length !== 4 || !rgba.every((v) => v >= 0 && v <= 1)) {
        errors.push(`${at}: lighting.${key} must be [r, g, b, a] from 0 to 1`);
      }
    }
    num('lighting.intensity', t.lighting.intensity, 0, 5);
  }

  return { ok: errors.length === 0, errors };
}
