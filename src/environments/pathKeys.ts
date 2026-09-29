/** Resolve "assets/x.webp" or "../shared/x.webp" against a folder, as a "./"-rooted key. */
export function resolveAssetKey(folder: string, path: string): string {
  const out: string[] = [];
  for (const part of [...folder.split('/'), ...path.split('/')]) {
    if (part === '..') out.pop();
    else if (part && part !== '.') out.push(part);
  }
  return `./${out.join('/')}`;
}
