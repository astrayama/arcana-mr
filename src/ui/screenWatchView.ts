/**
 * The page around the 3D view for someone watching a reading on a phone or
 * computer: a button to start, the room-code form, a status bar with Leave,
 * and a list of the cards drawn with their meanings. Plain DOM over the
 * canvas. Everything shown is set as text, never as HTML, because spread
 * names and labels can come from the reader's headset.
 */

import type { CardData } from '../data/cards.schema.js';
import type { ReadingSnapshot } from '../state/readingMachine.js';

export interface ViewColors {
  panelBackground: string;
  panelBorder: string;
  panelText: string;
  panelMuted: string;
  accent: string;
  accentText: string;
  reversed: string;
}

const styles = (c: ViewColors) => `
.sw { position: fixed; inset: 0; pointer-events: none; font: 15px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; color: ${c.panelText}; z-index: 10; }
.sw [hidden] { display: none !important; }
.sw button { font: inherit; cursor: pointer; border-radius: 999px; padding: 10px 18px; border: 1px solid ${c.accent}; background: transparent; color: ${c.accent}; }
.sw button.sw-primary { background: ${c.accent}; color: ${c.accentText}; font-weight: 600; }
.sw-entry { position: absolute; left: 50%; bottom: max(16px, env(safe-area-inset-bottom)); transform: translateX(-50%); pointer-events: auto; background: ${c.panelBackground}e6 !important; max-width: calc(100% - 32px); white-space: nowrap; }
.sw-card { pointer-events: auto; background: ${c.panelBackground}f2; border: 1px solid ${c.panelBorder}; border-radius: 18px; box-shadow: 0 10px 40px #0008; }
.sw-join { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); width: min(360px, calc(100% - 32px)); padding: 24px; box-sizing: border-box; text-align: center; }
.sw-join h2, .sw-list h2 { font-family: Georgia, "Times New Roman", serif; color: ${c.accent}; font-weight: 600; margin: 0 0 6px; }
.sw-join h2 { font-size: 26px; }
.sw-join p { margin: 6px 0; color: ${c.panelMuted}; }
.sw-join input { width: 100%; box-sizing: border-box; margin: 14px 0 6px; padding: 12px; font: 600 28px/1 Georgia, serif; letter-spacing: 0.18em; text-align: center; border-radius: 12px; border: 1px solid ${c.panelBorder}; background: #0006; color: ${c.panelText}; }
.sw-join input:focus { outline: 2px solid ${c.accent}; }
.sw-join .sw-error { color: ${c.reversed}; min-height: 1.4em; }
.sw-join .sw-buttons { display: flex; gap: 10px; justify-content: center; margin-top: 10px; }
.sw-join .sw-fine { font-size: 12.5px; margin-top: 14px; }
.sw-bar { position: absolute; left: 12px; right: 12px; top: max(12px, env(safe-area-inset-top)); display: flex; align-items: center; gap: 12px; padding: 8px 8px 8px 16px; }
.sw-bar .sw-status { flex: 1; min-width: 0; }
.sw-bar button { padding: 6px 14px; }
.sw-bar button.sw-shuffle { padding: 8px 18px; }
.sw-bar button:disabled { opacity: 0.6; cursor: default; }
.sw-tip { position: absolute; left: 50%; top: calc(max(12px, env(safe-area-inset-top)) + 62px); transform: translateX(-50%); font-size: 13px; color: ${c.panelText}; background: ${c.panelBackground}e6; border: 1px solid ${c.panelBorder}; padding: 5px 14px; border-radius: 999px; white-space: nowrap; max-width: calc(100% - 32px); overflow: hidden; text-overflow: ellipsis; }
.sw-list { position: absolute; right: 12px; top: 76px; bottom: 12px; width: 340px; display: flex; flex-direction: column; overflow: hidden; }
.sw-list header { display: flex; align-items: center; gap: 8px; padding: 14px 16px 8px; }
.sw-list h2 { font-size: 20px; flex: 1; margin: 0; }
.sw-list header button { padding: 4px 12px; font-size: 13px; }
.sw-list ol { list-style: none; margin: 0; padding: 0 12px 12px; overflow-y: auto; }
.sw-row { display: flex; gap: 12px; padding: 10px 4px; border-top: 1px solid ${c.panelBorder}; }
.sw-row img, .sw-row .sw-back { width: 54px; height: 93px; flex: none; border-radius: 5px; object-fit: cover; background: ${c.panelBorder}; }
.sw-row img.sw-flip { transform: rotate(180deg); }
.sw-pos { font-size: 11.5px; letter-spacing: 0.08em; text-transform: uppercase; color: ${c.panelMuted}; }
.sw-name { font: 600 17px/1.3 Georgia, serif; color: ${c.panelText}; }
.sw-name .sw-rev { font: 12px system-ui, sans-serif; color: ${c.reversed}; margin-left: 6px; }
.sw-words { color: ${c.accent}; font-size: 13px; margin: 2px 0 4px; }
.sw-read { margin: 0; font-size: 14px; }
.sw-prompt { margin: 6px 0 0; font-style: italic; color: ${c.panelMuted}; font-size: 14px; }
.sw-wait { color: ${c.panelMuted}; font-style: italic; }
.sw-hint { position: absolute; left: 50%; bottom: 14px; transform: translateX(-50%); font-size: 12.5px; color: ${c.panelMuted}; background: #0008; padding: 4px 12px; border-radius: 999px; }
@media (max-width: 720px) {
  .sw-list { left: 8px; right: 8px; top: auto; bottom: 8px; width: auto; max-height: 44vh; }
  .sw-list.sw-folded ol { display: none; }
  .sw-hint { display: none; }
}
`;

/** Make an element with a class and (text-only) content. */
function el<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text?: string): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export class ScreenWatchView {
  readonly root = el('div', 'sw');
  readonly entry = el('button', 'sw-entry', 'No headset? Watch a reading on this screen');
  private readonly join = el('form', 'sw-card sw-join');
  private readonly input = el('input');
  private readonly error = el('p', 'sw-error');
  private readonly cancel = el('button', '', 'Cancel');
  private readonly bar = el('div', 'sw-card sw-bar');
  private readonly status = el('div', 'sw-status');
  private readonly leave = el('button', '', 'Leave');
  private readonly shuffle = el('button', 'sw-primary sw-shuffle', 'Shuffle');
  private readonly tip = el('div', 'sw-tip');
  private readonly list = el('section', 'sw-card sw-list');
  private readonly title = el('h2');
  private readonly fold = el('button', '', 'Hide');
  private readonly rows = el('ol');
  private readonly hint = el('div', 'sw-hint', 'Drag to look around. Scroll or pinch to zoom.');

  constructor(colors: ViewColors) {
    const style = el('style');
    style.textContent = styles(colors);
    document.head.append(style);

    this.input.inputMode = 'numeric';
    this.input.autocomplete = 'off';
    this.input.maxLength = 7;
    this.input.placeholder = '000 000';
    this.input.setAttribute('aria-label', 'Room code');
    const submit = el('button', 'sw-primary', 'Watch');
    submit.type = 'submit';
    this.cancel.type = 'button';
    const buttons = el('div', 'sw-buttons');
    buttons.append(this.cancel, submit);
    this.join.append(
      el('h2', '', 'Watch a reading'),
      el('p', '', 'Ask your reader for the six-digit code of their room.'),
      this.input,
      this.error,
      buttons,
      el('p', 'sw-fine', 'Nothing is recorded. The reading reaches this screen encrypted, through a relay that stores nothing.'),
    );

    this.bar.append(this.status, this.shuffle, this.leave);
    this.shuffle.hidden = true;
    this.tip.hidden = true;
    const header = el('header');
    header.append(this.title, this.fold);
    this.list.append(header, this.rows);
    this.fold.addEventListener('click', () => {
      const folded = this.list.classList.toggle('sw-folded');
      this.fold.textContent = folded ? 'Show' : 'Hide';
    });

    this.root.append(this.entry, this.join, this.bar, this.tip, this.list, this.hint);
    document.body.append(this.root);
    this.show('entry');
  }

  /** Which part shows: the start button, the code form, or the reading being watched. */
  show(part: 'none' | 'entry' | 'join' | 'watching'): void {
    this.entry.hidden = part !== 'entry';
    this.join.hidden = part !== 'join';
    for (const node of [this.bar, this.list, this.hint]) node.hidden = part !== 'watching';
    if (part !== 'watching') this.tip.hidden = true;
    if (part === 'join') setTimeout(() => this.input.focus(), 0);
  }

  /** Whether the card list is covering the lower part of the view (a phone, list open). */
  get coversView(): boolean {
    return !this.list.hidden && !this.list.classList.contains('sw-folded') && window.matchMedia('(max-width: 720px)').matches;
  }

  onEntry(handler: () => void): void {
    this.entry.addEventListener('click', handler);
  }

  /** The code typed in, as digits, when the form is sent. */
  onSubmit(handler: (digits: string) => void): void {
    this.join.addEventListener('submit', (event) => {
      event.preventDefault();
      handler(this.input.value.replace(/\D/g, ''));
    });
  }

  onCancel(handler: () => void): void {
    this.cancel.addEventListener('click', handler);
  }

  onShuffle(handler: () => void): void {
    this.shuffle.addEventListener('click', handler);
  }

  /** The Shuffle button: hidden, ready, or waiting on the reader's headset. */
  setShuffle(state: 'hidden' | 'ready' | 'asking' | 'shuffling'): void {
    this.shuffle.hidden = state === 'hidden';
    this.shuffle.disabled = state !== 'ready';
    this.shuffle.textContent = state === 'asking' ? 'Asking...' : state === 'shuffling' ? 'Shuffling...' : 'Shuffle';
  }

  /** A short hint under the bar, or none. */
  setTip(text: string | null): void {
    this.tip.hidden = !text || this.bar.hidden;
    if (text) this.tip.textContent = text;
  }

  onLeave(handler: () => void): void {
    this.leave.addEventListener('click', handler);
  }

  setError(text: string): void {
    this.error.textContent = text;
  }

  setStatus(text: string): void {
    this.status.textContent = text;
  }

  /**
   * The spread, spot by spot: each turned card with its picture, words, and
   * meaning; face-down and undrawn spots say so.
   */
  renderCards(
    snapshot: ReadingSnapshot,
    cards: ReadonlyMap<string, CardData>,
    faceUrl: (id: string) => string | null,
    catchingUp = false,
  ): void {
    this.title.textContent = catchingUp ? 'Catching up...' : (snapshot.spread?.name ?? 'Waiting for a spread');
    const rows = snapshot.slots.map((slot) => {
      const row = el('li', 'sw-row');
      const card = slot.cardId ? cards.get(slot.cardId) : undefined;
      const url = card && slot.faceUp ? faceUrl(card.id) : null;
      if (url) {
        const img = el('img', slot.reversed ? 'sw-flip' : '');
        img.src = url;
        img.alt = card!.name;
        row.append(img);
      } else {
        row.append(el('div', 'sw-back'));
      }
      const text = el('div');
      text.append(el('div', 'sw-pos', slot.label));
      if (!slot.cardId) {
        text.append(el('div', 'sw-wait', 'Waiting to be drawn'));
      } else if (!slot.faceUp || !card) {
        text.append(el('div', 'sw-wait', 'Drawn, still face down'));
      } else {
        const side = slot.reversed ? card.reversed : card.upright;
        const name = el('div', 'sw-name', card.name);
        if (slot.reversed) name.append(el('span', 'sw-rev', 'Reversed'));
        text.append(
          name,
          el('div', 'sw-words', side.keywords.join(' · ')),
          el('p', 'sw-read', side.read),
          el('p', 'sw-prompt', side.prompt),
        );
      }
      row.append(text);
      return row;
    });
    this.rows.replaceChildren(...rows);
  }
}
