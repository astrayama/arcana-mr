/**
 * A list of things the app can use (decks, card backs, surroundings) that
 * can grow while it runs. Built-in items come with the app; "device" items
 * are ones the reader adds later, kept on the headset. Device ids always
 * start with "device:", so they can never replace a built-in.
 */

export type ItemOrigin = 'builtin' | 'device';

export interface RegistryItem {
  id: string;
  origin: ItemOrigin;
  /** Free anything the item holds (object URLs for images on the headset). */
  dispose?(): void;
}

export const DEVICE_PREFIX = 'device:';

export interface Registry<T extends RegistryItem> {
  get(id: string): T | undefined;
  list(): readonly T[];
  /** Add an item. Returns an error message instead if it isn't allowed. */
  register(item: T): string | null;
  /** Remove a device item and free what it holds. Built-ins stay. */
  unregister(id: string): boolean;
  /** Hear about additions and removals. Returns an unsubscribe function. */
  onChange(listener: () => void): () => void;
}

export function createRegistry<T extends RegistryItem>(builtins: readonly T[] = []): Registry<T> {
  const items = new Map<string, T>();
  const listeners = new Set<() => void>();
  const changed = () => listeners.forEach((listener) => listener());
  for (const item of builtins) items.set(item.id, item);

  return {
    get: (id) => items.get(id),
    list: () => [...items.values()],
    register(item) {
      const device = item.id.startsWith(DEVICE_PREFIX);
      if (item.origin === 'device' && !device) return `device items need an id starting with "${DEVICE_PREFIX}"`;
      if (item.origin === 'builtin' && device) return `"${DEVICE_PREFIX}" ids are only for device items`;
      const existing = items.get(item.id);
      if (existing?.origin === 'builtin') return `"${item.id}" is built in and can't be replaced`;
      existing?.dispose?.();
      items.set(item.id, item);
      changed();
      return null;
    },
    unregister(id) {
      const item = items.get(id);
      if (!item || item.origin === 'builtin') return false;
      items.delete(id);
      item.dispose?.();
      changed();
      return true;
    },
    onChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
