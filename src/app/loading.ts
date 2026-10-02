/**
 * The loading screen in index.html, shown from the first moment the page
 * opens until the app is ready to show something.
 */

/** Fade the loading screen out and remove it. */
export function finishLoading(): void {
  const screen = document.getElementById('loading');
  if (!screen || screen.classList.contains('done')) return;
  screen.classList.add('done');
  setTimeout(() => screen.remove(), 600);
}

/** Starting up failed: say so on the loading screen instead of loading forever. */
export function loadingFailed(): void {
  const screen = document.getElementById('loading');
  if (!screen) return;
  screen.classList.add('failed');
  const text = screen.querySelector('.loading-text');
  if (text) text.textContent = "This page didn't load properly. Try reloading it.";
}
