/**
 * Panels are UIKitML templates with `{{token}}` placeholders. This fills them
 * from the active theme and hands IWSDK a URL it can load through `PanelUI`.
 * Swapping themes (or adding an in-headset theme picker later) only means
 * rendering the same template against a different theme.
 *
 * Tokens:
 *   {{colors.<name>}}   any key of ThemeColors, e.g. {{colors.accent}}
 *   {{panelRadius}}     corner radius in UIKit units
 *   {{fontFaces}}       @font-face rules for themes that ship TTF files
 *   {{headingFont}}     `font-family: ...;` for headings, or nothing
 *   {{bodyFont}}        `font-family: ...;` for body text, or nothing
 */

import type { ResolvedTheme } from '../themes/registry.js';
import type { ThemeFont } from '../themes/theme.schema.js';

function fontFaceRules(font: ThemeFont | null, resolved: ResolvedTheme): string {
  if (!font?.files) return '';
  return Object.entries(font.files)
    .map(([weight, path]) => {
      const url = resolved.assetUrl(path);
      return url
        ? `@font-face { font-family: ${font.family}; src: url(${url}); font-weight: ${weight}; }`
        : '';
    })
    .join('\n');
}

const familyRule = (font: ThemeFont | null) => (font ? `font-family: ${font.family};` : '');

export function renderPanelTemplate(template: string, resolved: ResolvedTheme): string {
  const { theme } = resolved;
  const tokens = new Map<string, string>([
    ['panelRadius', String(theme.panelRadius)],
    [
      'fontFaces',
      [fontFaceRules(theme.fonts.heading, resolved), fontFaceRules(theme.fonts.body, resolved)]
        .filter(Boolean)
        .join('\n'),
    ],
    ['headingFont', familyRule(theme.fonts.heading)],
    ['bodyFont', familyRule(theme.fonts.body)],
  ]);
  for (const [name, value] of Object.entries(theme.colors)) {
    tokens.set(`colors.${name}`, value);
  }
  // Comments are for template authors; drop them so they can mention tokens freely.
  const body = template.replace(/<!--[\s\S]*?-->/g, '');
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_, key: string) => {
    const value = tokens.get(key);
    if (value === undefined) {
      throw new Error(`[arcana] unknown theme token {{${key}}} in panel template`);
    }
    return value;
  });
}

const urls = new Map<string, string>();

/**
 * URL for a template rendered with a theme, cached per (panel, theme) pair so
 * every copy of a panel shares one parsed source.
 */
export function themedPanelUrl(name: string, template: string, resolved: ResolvedTheme): string {
  const key = `${name}@${resolved.theme.id}`;
  let url = urls.get(key);
  if (url === undefined) {
    const source = renderPanelTemplate(template, resolved);
    url = URL.createObjectURL(new Blob([source], { type: 'text/plain' }));
    urls.set(key, url);
  }
  return url;
}
