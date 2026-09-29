/**
 * Where decks, card backs, and surroundings the reader adds themselves will
 * be kept: on this headset only (IndexedDB), never uploaded anywhere. This
 * is the interface the rest of the app uses; the "Add your own" screen and
 * the IndexedDB store come in a later update. Until then the store is empty.
 * Pack formats are described in docs/formats.md.
 */

export type PackKind = 'deck' | 'back' | 'environment';

export interface StoredPack {
  /** Always starts with "device:". */
  id: string;
  kind: PackKind;
  /** The pack's deck.json, back.json, or environment.json, as parsed JSON. */
  manifest: unknown;
  /** Paths of the pack's files, relative to the pack (e.g. "faces/major-00-the-fool.webp"). */
  files: string[];
  /** When it was added (ms since 1970), for sorting. */
  addedAt: number;
}

export interface AssetStore {
  listPacks(): Promise<StoredPack[]>;
  getFile(packId: string, path: string): Promise<Blob | null>;
  putPack(pack: StoredPack, files: ReadonlyMap<string, Blob>): Promise<void>;
  deletePack(packId: string): Promise<void>;
}

/** The store until adding your own arrives: always empty, never writes. */
export const emptyAssetStore: AssetStore = {
  listPacks: async () => [],
  getFile: async () => null,
  putPack: async () => {
    throw new Error('Adding your own decks and surroundings is not available yet');
  },
  deletePack: async () => {},
};
