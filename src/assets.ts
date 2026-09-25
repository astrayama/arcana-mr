import { AssetType, defineAssets } from '@iwsdk/core';

/**
 * Arcana MR loads its card art through the deck and theme registries (so art
 * packs and themes are drop-in folders), and its panels are theme templates
 * in src/ui. The only manifest entries are the controller and hand models.
 *
 * IWSDK's input visuals request those models from the public WebXR input
 * profiles CDN. Registering each CDN address as an asset key that points at a
 * local copy keeps every request on this site: the app loads nothing from
 * third parties. Copies come from @webxr-input-profiles/assets@1.0.20 (MIT).
 */

const publicAssetUrl = (filePath: string): string =>
  `${import.meta.env.BASE_URL}${filePath.replace(/^\/+/u, '')}`;

const CDN = 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles';
const PROFILES = [
  'meta-quest-touch-plus',
  'meta-quest-touch-plus-v2',
  'meta-quest-touch-pro',
  'oculus-touch-v3',
  'generic-hand',
] as const;

const inputModels = Object.fromEntries(
  PROFILES.flatMap((profile) =>
    (['left', 'right'] as const).map((hand) => [
      `${CDN}/${profile}/${hand}.glb`,
      {
        url: publicAssetUrl(`input-profiles/${profile}/${hand}.glb`),
        type: AssetType.GLTF,
        name: `Input model: ${profile} (${hand})`,
        priority: 'lazy' as const,
      },
    ]),
  ),
);

export default defineAssets(inputModels);
