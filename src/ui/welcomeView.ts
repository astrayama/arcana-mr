/**
 * The welcome page on a phone or computer (the flat browser view, before the
 * headset): who Carta Luna is for, and the two ways in. Begin in a headset,
 * or watch a friend's reading here. Plain DOM over the canvas, on the same
 * night sky as the loading screen (styles in index.html), laid out for
 * phones first.
 */

export interface WelcomeColors {
  panelBackground: string;
  panelBorder: string;
  panelText: string;
  panelMuted: string;
  accent: string;
  accentText: string;
  highlight: string;
  reversed: string;
}

const styles = (c: WelcomeColors) => `
.wl { position: fixed; inset: 0; z-index: 9; overflow-y: auto; color: ${c.panelText}; font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; -webkit-font-smoothing: antialiased; }
.wl[hidden] { display: none; }
.wl-main { position: relative; box-sizing: border-box; min-height: 100%; max-width: 880px; margin: 0 auto; display: flex; flex-direction: column; align-items: center; justify-content: center; padding: max(32px, env(safe-area-inset-top)) max(20px, env(safe-area-inset-right)) max(28px, env(safe-area-inset-bottom)) max(20px, env(safe-area-inset-left)); text-align: center; }
.wl-mark { position: relative; width: 84px; height: 84px; margin-bottom: 6px; }
.wl-mark::before { content: ''; position: absolute; inset: -18px; border-radius: 50%; background: radial-gradient(circle, ${c.highlight}38 0%, ${c.highlight}10 45%, transparent 70%); animation: wl-breathe 5s ease-in-out infinite; }
.wl-mark svg { position: relative; width: 100%; height: 100%; }
.wl h1 { font: 600 clamp(38px, 9vw, 52px)/1.1 Georgia, "Times New Roman", serif; color: ${c.accent}; margin: 0; letter-spacing: 0.01em; }
.wl-tag { margin: 10px 0 0; max-width: 30ch; font-size: 17.5px; color: ${c.panelText}; opacity: 0.88; }
.wl-paths { display: grid; grid-template-columns: 1fr; gap: 14px; width: 100%; max-width: 440px; margin-top: 30px; }
@media (min-width: 760px) { .wl-paths.wl-two { grid-template-columns: 1fr 1fr; max-width: 820px; } }
.wl-path { box-sizing: border-box; display: flex; flex-direction: column; align-items: flex-start; gap: 6px; padding: 22px 22px 20px; border-radius: 18px; border: 1px solid ${c.panelBorder}; background: ${c.panelBackground}d9; text-align: left; backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
.wl-path.wl-first { border-color: ${c.accent}88; box-shadow: 0 0 0 1px ${c.accent}22, 0 14px 40px #0008; }
.wl-path h2 { display: flex; align-items: center; gap: 10px; margin: 0; font: 600 21px/1.3 Georgia, serif; color: ${c.panelText}; }
.wl-path h2 svg { width: 24px; height: 24px; flex: none; color: ${c.accent}; }
.wl-path p { margin: 0; color: ${c.panelMuted}; font-size: 15.5px; }
.wl-btn { box-sizing: border-box; width: 100%; min-height: 50px; margin-top: 12px; border-radius: 999px; border: 1px solid ${c.accent}; background: transparent; color: ${c.accent}; font: 600 17px/1.2 system-ui, -apple-system, sans-serif; cursor: pointer; transition: background 0.2s, transform 0.1s; }
.wl-btn:hover { background: ${c.accent}1a; }
.wl-btn:active { transform: scale(0.98); }
.wl-btn:focus-visible { outline: 2px solid ${c.highlight}; outline-offset: 3px; }
.wl-btn.wl-primary { background: ${c.accent}; color: ${c.accentText}; }
.wl-btn.wl-primary:hover { background: ${c.highlight}; }
.wl-note { margin-top: 8px !important; color: ${c.reversed} !important; font-size: 14.5px !important; }
.wl-foot { margin-top: 30px; max-width: 46ch; font-size: 13.5px; color: ${c.panelMuted}; opacity: 0.9; }
.wl-maker { margin-top: 10px; font: 15px Georgia, serif; color: ${c.panelMuted}; }
@keyframes wl-breathe { 0%, 100% { opacity: 0.6; transform: scale(0.95); } 50% { opacity: 1; transform: scale(1.05); } }
@media (prefers-reduced-motion: reduce) { .wl-mark::before { animation: none; } .wl-btn { transition: none; } }
`;

/** The crescent moon mark, matching the loading screen. */
const MOON = `<svg viewBox="0 0 100 100" aria-hidden="true"><defs><radialGradient id="wl-moon-light" cx="38%" cy="38%" r="70%"><stop offset="0" stop-color="#fff4cf"/><stop offset="1" stop-color="#d4af37"/></radialGradient><mask id="wl-moon-cut"><rect width="100" height="100" fill="#fff"/><circle cx="64" cy="38" r="36" fill="#000"/></mask></defs><circle cx="48" cy="52" r="38" fill="url(#wl-moon-light)" mask="url(#wl-moon-cut)"/></svg>`;
/** Line icons for the two paths: a headset, and two people. */
const HEADSET = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 9.5c0-1.4 1.1-2.5 2.5-2.5h13c1.4 0 2.5 1.1 2.5 2.5v4c0 1.4-1.1 2.5-2.5 2.5h-3.2l-1.6-2.2a2 2 0 0 0-3.4 0L8.7 16H5.5C4.1 16 3 14.9 3 13.5z"/></svg>`;
const FRIENDS = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.6-3 2.8-4.6 5.5-4.6s4.9 1.6 5.5 4.6"/><circle cx="16.8" cy="9.5" r="2.5"/><path d="M15.6 14.6c2.4-.2 4.3 1.2 4.9 3.9"/></svg>`;

/** Make an element with a class and (text-only) content. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

/** A path card: an icon (trusted, from this file) and a title, then text. */
function path(icon: string, title: string, text: string): { card: HTMLElement; body: HTMLElement } {
  const card = el('section', 'wl-path');
  const h2 = el('h2');
  h2.innerHTML = icon;
  h2.append(title);
  const body = el('p', '', text);
  card.append(h2, body);
  return { card, body };
}

export class WelcomeView {
  readonly root = el('div', 'wl');
  private readonly paths = el('div', 'wl-paths');
  private readonly headset = path(HEADSET, 'In your headset', 'On Meta Quest 3, the cards appear on your own table. Shuffle, draw, and turn them with your hands.');
  private readonly friend = path(
    FRIENDS,
    'With a friend',
    'Watch their reading on this phone or computer, and shuffle or press Next when they let you.',
  );
  private readonly begin = el('button', 'wl-btn', 'Begin');
  private readonly copy = el('button', 'wl-btn', 'Copy link');
  private readonly watch = el('button', 'wl-btn', 'Watch a reading');
  private readonly note = el('p', 'wl-note');

  /** `canWatch`: this build can join rooms (it has a relay address). */
  constructor(colors: WelcomeColors, canWatch: boolean) {
    const style = el('style');
    style.textContent = styles(colors);
    document.head.append(style);

    this.begin.id = 'landing-begin';
    this.begin.type = 'button';
    this.copy.type = 'button';
    this.watch.type = 'button';
    this.watch.id = 'landing-watch';
    this.note.hidden = true;
    this.headset.card.append(this.begin, this.copy, this.note);
    this.friend.card.append(this.watch);
    this.paths.append(this.headset.card);
    if (canWatch) this.paths.append(this.friend.card);
    this.paths.classList.toggle('wl-two', canWatch);

    const mark = el('div', 'wl-mark');
    mark.innerHTML = MOON;
    const main = el('main', 'wl-main');
    main.append(
      mark,
      el('h1', '', 'Carta Luna'),
      el('p', 'wl-tag', 'Tarot for self-reflection, laid out on your own table.'),
      this.paths,
      el('p', 'wl-foot', 'Nothing you do here is recorded. Reading together sends encrypted messages through our relay, which never stores them.'),
      el('div', 'wl-maker', 'Made by Screen Sage Studios'),
    );
    this.root.append(el('div', 'night-sky'), main);
    document.body.append(this.root);

    this.copy.addEventListener('click', () => void this.copyLink());
    this.setHeadset(false);
  }

  /**
   * Put the way in that fits this device first. In a headset's browser that's
   * Begin; elsewhere it's watching a friend, with a link to open in the Quest.
   */
  setHeadset(supported: boolean): void {
    this.begin.hidden = !supported;
    this.copy.hidden = supported;
    this.headset.body.textContent = supported
      ? 'The cards appear on your own table. Shuffle, draw, and turn them with your hands.'
      : 'On Meta Quest 3, the cards appear on your own table. Open this page in the Quest Browser to begin.';
    const first = supported || !this.friend.card.isConnected ? this.headset.card : this.friend.card;
    if (this.paths.firstElementChild !== first) this.paths.prepend(first);
    this.headset.card.classList.toggle('wl-first', first === this.headset.card);
    this.friend.card.classList.toggle('wl-first', first === this.friend.card);
    this.begin.classList.toggle('wl-primary', supported);
    this.watch.classList.toggle('wl-primary', !supported);
  }

  onBegin(handler: () => void): void {
    this.begin.addEventListener('click', handler);
  }

  onWatch(handler: () => void): void {
    this.watch.addEventListener('click', handler);
  }

  /** A note under Begin (the headset view didn't open, say), or none. */
  setNote(text: string | null): void {
    this.note.hidden = !text;
    if (text) this.note.textContent = text;
  }

  show(visible: boolean): void {
    this.root.hidden = !visible;
  }

  private async copyLink(): Promise<void> {
    const link = `${location.origin}${location.pathname}`;
    try {
      await navigator.clipboard.writeText(link);
      this.copy.textContent = 'Link copied';
    } catch {
      // No clipboard here: show the address to copy by hand.
      this.copy.textContent = link.replace(/^https?:\/\//, '');
    }
    setTimeout(() => (this.copy.textContent = 'Copy link'), 2500);
  }
}
