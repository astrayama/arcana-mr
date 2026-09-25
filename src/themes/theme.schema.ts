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
