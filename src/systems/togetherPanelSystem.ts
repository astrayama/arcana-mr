import { createSystem, type UIKitDocument } from '@iwsdk/core';
import { app } from '../app/context.js';
import type { Mode } from '../net/permissions.js';
import { formatCode, isRoomCode, pressKey, CODE_LENGTH, type KeypadKey } from '../net/roomCode.js';
import { session } from '../net/session.js';
import { bindClicks, setText } from '../ui/panels.js';
import { GUEST_MODE_NOTE, guestStatus, hostStatus, MODE_TITLE, problemText } from '../ui/togetherCopy.js';
import { HubSystem, type HubPage } from './hubSystem.js';
import { TogetherSystem } from './togetherSystem.js';

type View = 'start' | 'setup' | 'room' | 'join' | 'joined';
const VIEWS: readonly View[] = ['start', 'setup', 'room', 'join', 'joined'];
const KEYS: readonly KeypadKey[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'del'];

/**
 * The hub's Read together page: open a room (choosing how you'll read) or
 * join one by tapping in its code, then the room's code and how the
 * connection is doing. While someone is a guest, the hub opens here instead
 * of Home, since the reader chooses the spreads.
 */
export class TogetherPanelSystem extends createSystem({}) {
  private hub!: HubSystem;
  private together!: TogetherSystem;
  private view: View = 'start';
  private mode: Mode = 'watch';
  private entry = '';
  /** What was last tried, so a failure shows on the page it came from. */
  private attempt: 'host' | 'join' | null = null;

  init(): void {
    this.hub = this.world.getSystem(HubSystem)!;
    this.together = this.world.getSystem(TogetherSystem)!;

    const wire = (doc: UIKitDocument) => {
      const handlers: Record<string, () => void> = {
        'hb-together-go': () => this.open(),
        'hb-tg-back': () => this.back(),
        'hb-tg-go-host': () => this.go('setup'),
        'hb-tg-go-join': () => {
          this.entry = '';
          this.attempt = null;
          this.go('join');
        },
        'hb-tg-mode-watch': () => this.pickMode('watch'),
        'hb-tg-mode-shuffle': () => this.pickMode('shuffle'),
        'hb-tg-open': () => this.host(),
        'hb-tg-begin': () => this.hub.openSpreads('classic'),
        'hb-tg-close': () => this.leave(),
        'hb-tg-key-join': () => this.join(),
        'hb-tg-settings': () => this.hub.show('settings'),
        'hb-tg-leave': () => this.leave(),
      };
      for (const key of KEYS) handlers[`hb-tg-key-${key}`] = () => this.press(key);
      return bindClicks(doc, handlers);
    };
    const onPage = (page: HubPage, doc: UIKitDocument) => {
      // A guest's reader chooses the spreads, so their hub opens on the room.
      if (page === 'home' && session.peek().role === 'guest') {
        this.hub.show('together');
        return;
      }
      if (page === 'home') this.renderHome(doc);
      if (page === 'together') this.render(doc);
    };
    this.hub.wireListeners.add(wire);
    this.hub.pageListeners.add(onPage);
    this.cleanupFuncs.push(
      () => this.hub.wireListeners.delete(wire),
      () => this.hub.pageListeners.delete(onPage),
      session.subscribe(() => this.refresh()),
    );
  }

  private refresh(): void {
    const doc = this.hub.document;
    if (!doc || app.machine.state !== 'IDLE') return;
    if (this.hub.page === 'home' && session.peek().role === 'guest') this.hub.show('together');
    else if (this.hub.page === 'home') this.renderHome(doc);
    else if (this.hub.page === 'together') this.render(doc);
  }

  // Actions

  private open(): void {
    if (session.peek().role === 'solo') this.view = 'start';
    this.hub.show('together');
  }

  private go(view: View): void {
    this.view = view;
    this.attempt = null;
    this.refresh();
  }

  private back(): void {
    const s = session.peek();
    if (s.role === 'solo' && (this.view === 'setup' || this.view === 'join')) this.go('start');
    else this.hub.show('home');
  }

  private pickMode(mode: Mode): void {
    this.mode = mode;
    this.refresh();
  }

  private host(): void {
    this.attempt = 'host';
    void this.together.host(this.mode);
  }

  private press(key: KeypadKey): void {
    this.entry = pressKey(this.entry, key);
    this.attempt = null;
    this.refresh();
  }

  private join(): void {
    if (!isRoomCode(this.entry)) return;
    this.attempt = 'join';
    void this.together.join(this.entry);
  }

  private leave(): void {
    this.together.leave();
    this.attempt = null;
    this.view = 'start';
    this.refresh();
  }

  // Drawing

  /** Home's Read together button: hidden when this build has no relay, and the room's code once open. */
  private renderHome(doc: UIKitDocument): void {
    const available = this.together.available;
    doc.getElementById('hb-together-go')?.setProperties({ display: available ? 'flex' : 'none' });
    doc.getElementById('hb-begin')?.setProperties({ width: available ? 19.8 : 26 });
    const s = session.peek();
    setText(doc, 'hb-together-text', s.role === 'host' && s.code ? `Room ${formatCode(s.code)}` : 'Read together');
  }

  private render(doc: UIKitDocument): void {
    const s = session.peek();
    const { colors } = app.theme.theme;
    // Joining or failing to: back where it was tried, with what went wrong.
    if (s.role === 'solo' && s.status === 'ended' && this.attempt) this.view = this.attempt === 'host' ? 'setup' : 'join';
    const view: View = s.role === 'host' ? 'room' : s.role === 'guest' ? 'joined' : this.view;
    const show = (id: string, on: boolean) => doc.getElementById(id)?.setProperties({ display: on ? 'flex' : 'none' });
    for (const v of VIEWS) show(`hb-tg-${v}`, v === view);
    // A guest's way out is Leave; the spacer keeps the title centered.
    show('hb-tg-back', s.role !== 'guest');
    show('hb-tg-noback', s.role === 'guest');
    const failed = s.role === 'solo' && s.status === 'ended' && this.attempt !== null;

    if (view === 'setup') {
      for (const mode of ['watch', 'shuffle'] as const) {
        const on = mode === this.mode;
        doc.getElementById(`hb-tg-mode-${mode}`)?.setProperties({
          borderColor: on ? colors.accent : colors.panelBorder,
          backgroundColor: on ? colors.panelBorder : 'transparent',
        });
      }
      show('hb-tg-setup-error', failed);
      if (failed) setText(doc, 'hb-tg-setup-error', problemText(s.problem));
    }
    if (view === 'room') {
      setText(doc, 'hb-tg-code', s.code ? formatCode(s.code) : '');
      setText(doc, 'hb-tg-room-status', hostStatus(s));
      setText(doc, 'hb-tg-room-mode', MODE_TITLE[s.mode]);
    }
    if (view === 'join') {
      for (let i = 0; i < CODE_LENGTH; i++) {
        setText(doc, `hb-tg-digit-${i}`, this.entry[i] ?? '');
        doc.getElementById(`hb-tg-box-${i}`)?.setProperties({
          borderColor: i === this.entry.length ? colors.accent : colors.panelBorder,
        });
      }
      const ready = isRoomCode(this.entry);
      doc.getElementById('hb-tg-key-join')?.setProperties({
        backgroundColor: ready ? colors.accent : 'transparent',
        borderColor: ready ? colors.accent : colors.panelBorder,
      });
      doc.getElementById('hb-tg-join-text')?.setProperties({ color: ready ? colors.accentText : colors.panelMuted });
      show('hb-tg-join-error', failed);
      if (failed) setText(doc, 'hb-tg-join-error', problemText(s.problem));
    }
    if (view === 'joined') {
      const title =
        s.status === 'preparing' || s.status === 'connecting'
          ? 'Joining...'
          : s.status === 'reconnecting'
            ? 'Reconnecting...'
            : "You're in";
      setText(doc, 'hb-tg-joined-title', title);
      setText(doc, 'hb-tg-joined-status', guestStatus(s));
      setText(doc, 'hb-tg-joined-mode', GUEST_MODE_NOTE[s.mode]);
    }
  }
}
