import { createSystem, type UIKitDocument } from '@iwsdk/core';
import { app } from '../app/context.js';
import type { Mode } from '../net/permissions.js';
import { formatCode, isRoomCode, pressKey, CODE_LENGTH, type KeypadKey } from '../net/roomCode.js';
import { session } from '../net/session.js';
import { bindClicks, setText } from '../ui/panels.js';
import { GUEST_MODE_NOTE, guestStatus, hostStatus, problemText, roomModeNote, viewersLine } from '../ui/togetherCopy.js';
import { HubSystem, type HubPage } from './hubSystem.js';
import { TogetherSystem } from './togetherSystem.js';

type View = 'start' | 'room' | 'join' | 'joined';
const VIEWS: readonly View[] = ['start', 'room', 'join', 'joined'];
const KEYS: readonly KeypadKey[] = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'del'];

/**
 * The hub's Read together page: open a room, or join one by choosing to
 * watch or shuffle and tapping in its code; then the room's code, who
 * shuffles (the host can switch it any time), and who's watching. While someone is a guest, the hub opens here instead
 * of Home, since the reader chooses the spreads.
 */
export class TogetherPanelSystem extends createSystem({}) {
  private hub!: HubSystem;
  private together!: TogetherSystem;
  private view: View = 'start';
  /** What this person chooses to do when joining as a guest. */
  private wants: Mode = 'watch';
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
        'hb-tg-go-host': () => this.host(),
        'hb-tg-go-join': () => {
          this.entry = '';
          this.attempt = null;
          this.go('join');
        },
        'hb-tg-wants-watch': () => this.pickWants('watch'),
        'hb-tg-wants-shuffle': () => this.pickWants('shuffle'),
        'hb-tg-room-watch': () => this.together.setMode('watch'),
        'hb-tg-room-shuffle': () => this.together.setMode('shuffle'),
        'hb-tg-begin': () => this.hub.openSpreads('classic'),
        'hb-tg-close': () => this.leave(),
        'hb-tg-key-join': () => this.join(),
        'hb-tg-settings': () => this.hub.show('settings'),
        // The room stays open while the mat moves; the page comes back once it's down.
        'hb-tg-room-move': () => app.machine.send({ type: 'REPLACE_MAT' }),
        'hb-tg-joined-move': () => app.machine.send({ type: 'REPLACE_MAT' }),
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
    if (s.role === 'solo' && this.view === 'join') this.go('start');
    else this.hub.show('home');
  }

  private pickWants(mode: Mode): void {
    this.wants = mode;
    this.refresh();
  }

  private host(): void {
    this.attempt = 'host';
    void this.together.host();
  }

  private press(key: KeypadKey): void {
    this.entry = pressKey(this.entry, key);
    this.attempt = null;
    this.refresh();
  }

  private join(): void {
    if (!isRoomCode(this.entry)) return;
    this.attempt = 'join';
    void this.together.join(this.entry, this.wants);
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
    if (s.role === 'solo' && s.status === 'ended' && this.attempt) this.view = this.attempt === 'host' ? 'start' : 'join';
    const view: View = s.role === 'host' ? 'room' : s.role === 'guest' ? 'joined' : this.view;
    const show = (id: string, on: boolean) => doc.getElementById(id)?.setProperties({ display: on ? 'flex' : 'none' });
    for (const v of VIEWS) show(`hb-tg-${v}`, v === view);
    // A guest's way out is Leave; the spacer keeps the title centered.
    show('hb-tg-back', s.role !== 'guest');
    show('hb-tg-noback', s.role === 'guest');
    const failed = s.role === 'solo' && s.status === 'ended' && this.attempt !== null;

    const chip = (id: string, on: boolean) =>
      doc.getElementById(id)?.setProperties({
        borderColor: on ? colors.accent : colors.panelBorder,
        backgroundColor: on ? colors.panelBorder : 'transparent',
      });
    if (view === 'start') {
      show('hb-tg-start-error', failed);
      if (failed) setText(doc, 'hb-tg-start-error', problemText(s.problem));
    }
    if (view === 'room') {
      setText(doc, 'hb-tg-code', s.code ? formatCode(s.code) : '');
      setText(doc, 'hb-tg-room-status', hostStatus(s));
      chip('hb-tg-room-watch', s.mode === 'watch');
      chip('hb-tg-room-shuffle', s.mode === 'shuffle');
      setText(doc, 'hb-tg-room-mode', roomModeNote(s));
      show('hb-tg-room-viewers', s.viewers > 0);
      if (s.viewers > 0) setText(doc, 'hb-tg-room-viewers', viewersLine(s.viewers));
    }
    if (view === 'join') {
      chip('hb-tg-wants-watch', this.wants === 'watch');
      chip('hb-tg-wants-shuffle', this.wants === 'shuffle');
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
