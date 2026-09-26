/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { iwsdkDev } from '@iwsdk/vite-plugin-dev';
import { defineConfig, type Plugin } from 'vite';

/**
 * Dev server only: receives log lines from src/dev/deviceLog.ts so errors
 * that happen in the headset show up in the dev server log on the computer.
 */
function deviceLogRelay(): Plugin {
  return {
    name: 'arcana-device-log',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__arcana/log', (req, res) => {
        let body = '';
        req.on('data', (chunk) => (body += chunk));
        req.on('end', () => {
          try {
            const { client, device, level, message } = JSON.parse(body);
            server.config.logger.info(`[device ${device} ${client}] ${level}: ${message}`);
          } catch {
            // Ignore malformed lines.
          }
          res.statusCode = 204;
          res.end();
        });
      });
    },
  };
}

type BundledFont = NonNullable<
  NonNullable<Parameters<typeof iwsdkDev>[0]>['bundle']
>['fonts'];

/**
 * Panels are theme templates, so IWSDK can't see their fonts statically.
 * Collect the bundled font families every theme asks for, so a new theme
 * folder never needs a config edit.
 */
function themeFonts(): BundledFont {
  const themesDir = join(import.meta.dirname, 'src/themes');
  const families = new Set<string>(['inter']);
  for (const entry of readdirSync(themesDir, { withFileTypes: true })) {
    const file = join(themesDir, entry.name, 'theme.json');
    if (!entry.isDirectory() || !existsSync(file)) continue;
    const theme = JSON.parse(readFileSync(file, 'utf8'));
    for (const font of [theme.fonts?.heading, theme.fonts?.body]) {
      if (font && !font.files) families.add(font.family);
    }
  }
  return [...families] as BundledFont;
}

export default defineConfig({
  plugins: [iwsdkDev({ bundle: { fonts: themeFonts() } }), deviceLogRelay()],
  server: { host: '0.0.0.0', port: 8081, open: false },
  build: {
    outDir: 'dist',
    sourcemap: process.env.NODE_ENV !== 'production',
    target: 'esnext',
    rollupOptions: { input: './index.html' },
  },
  esbuild: { target: 'esnext' },
  // @drawcall/uikitml otherwise pulls a second three/@pmndrs/uikit graph
  // (three@0.185 vs app super-three@0.181). Duplicate Component classes break
  // instanceof checks → "Only pmndrs/uikit components can be added as children".
  resolve: {
    dedupe: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
    ],
  },
  optimizeDeps: {
    exclude: ['@babylonjs/havok'],
    include: [
      'three',
      '@pmndrs/uikit',
      '@pmndrs/uikit-horizon',
      '@pmndrs/uikit-lucide',
      '@drawcall/uikitml',
    ],
    esbuildOptions: { target: 'esnext' },
  },
  publicDir: 'public',
  base: './',
});
