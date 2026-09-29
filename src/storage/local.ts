/**
 * Small JSON values kept on this device only (the browser's local storage).
 * Nothing here is ever sent anywhere. Storage can be unavailable (private
 * browsing, blocked site data) or full, so every access is guarded and the
 * app carries on with defaults.
 */

/** Just enough of the Web Storage API, so tests can pass a stand-in. */
export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function defaultStore(): KeyValueStore | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function readJson(key: string, store: KeyValueStore | null = defaultStore()): unknown {
  try {
    const raw = store?.getItem(key);
    return raw == null ? null : JSON.parse(raw);
  } catch {
    return null;
  }
}

/** Returns false if the value couldn't be saved. */
export function writeJson(key: string, value: unknown, store: KeyValueStore | null = defaultStore()): boolean {
  try {
    if (!store) return false;
    store.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function removeKey(key: string, store: KeyValueStore | null = defaultStore()): void {
  try {
    store?.removeItem(key);
  } catch {
    // Nothing to do: it wasn't stored, or storage is unavailable.
  }
}
