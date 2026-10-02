import { createSystem, VisibilityState, Vector3 } from '@iwsdk/core';
import { app } from '../app/context.js';
import { onScreen } from '../app/screen.js';
import { config } from '../config.js';
import { getDeck } from '../decks/registry.js';
import { allowed } from '../net/permissions.js';
import { formatCode, isRoomCode } from '../net/roomCode.js';
import { permissionContext, session } from '../net/session.js';
import { problemText } from '../ui/togetherCopy.js';
import { ScreenWatchView } from '../ui/screenWatchView.js';
import { PlacementSystem } from './placementSystem.js';
import { TableSystem } from './tableSystem.js';
import { TogetherSystem } from './togetherSystem.js';

/** Where the mat sits when watching on a screen: table height, facing the camera. */
const SCREEN_MAT = { x: 0, y: 0.75, z: 0, yaw: 0 };
/** The camera circles the mat: angles in radians, distance in meters. */
const ORBIT = { yaw: 0, pitch: 0.85, distance: 1.25, minPitch: 0.12, maxPitch: 1.45, minDistance: 0.45, maxDistance: 3.2 };
const DRAG_YAW = 0.006;
const DRAG_PITCH = 0.005;
/** A shake: this many jolts (m/s², gravity left out) within the window, then a pause before the next. */
const SHAKE = { jolt: 13, jolts: 3, windowMs: 1200, gapMs: 120, restMs: 2500 };
/** How long a shuffle request waits for the reader's headset before the button is offered again. */
const ASK_MS = 2500;
/** Catching up for longer than this suggests the reader's app needs a reload. */
const SLOW_SYNC_MS = 10_000;
/** iPhones ask before sharing motion; elsewhere it just works. */
type MotionPermission = { requestPermission?: () => Promise<'granted' | 'denied'> };

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/**
 * Watching a shared reading on a phone or computer: no headset, just the
 * table and cards in 3D (drag to look around, scroll or pinch to zoom) and a
 * list of the cards with their meanings. Joins the room as a viewer, which
 * can see everything and touch nothing.
 */
export class ScreenWatchSystem extends createSystem({}) {
  private view: ScreenWatchView | null = null;
  private together!: TogetherSystem;
  private placement!: PlacementSystem;
  private table!: TableSystem;
  private watching = false;
  private yaw = ORBIT.yaw;
  private pitch = ORBIT.pitch;
  private distance = ORBIT.distance;
  private readonly target = new Vector3();
  private readonly eye = new Vector3();
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch = 0;
  private listening = false;
  private askedAt = 0;
  private unsyncedSince = 0;
  private motion: 'off' | 'asking' | 'on' = 'off';
  private readonly jolts: number[] = [];
  private lastJolt = 0;
  private lastShake = 0;
  private nextRefresh = 0;

  init(): void {
    this.together = this.world.getSystem(TogetherSystem)!;
    this.placement = this.world.getSystem(PlacementSystem)!;
    this.table = this.world.getSystem(TableSystem)!;
    // Without a relay there is no room to watch.
    if (!this.together.available) return;
    const c = app.theme.theme.colors;
    const view = new ScreenWatchView({
      panelBackground: c.panelBackground,
      panelBorder: c.panelBorder,
      panelText: c.panelText,
      panelMuted: c.panelMuted,
      accent: c.accent,
      accentText: c.accentText,
      reversed: c.reversed,
    });
    this.view = view;
    view.onEntry(() => view.show('join'));
    view.onCancel(() => view.show(this.watching ? 'watching' : onScreen.peek() ? 'join' : 'entry'));
    view.onSubmit((digits) => {
      if (!isRoomCode(digits)) view.setError('Six digits, like 472 913.');
      else this.start(digits);
    });
    view.onShuffle(() => {
      // The tap is the moment an iPhone can be asked about motion.
      void this.enableMotion();
      this.shuffle();
    });
    view.onLeave(() => {
      this.together.leave();
      this.watching = false;
      view.setError('');
      view.show('join');
    });

    this.cleanupFuncs.push(
      // In the headset the page around the view isn't seen; take it away.
      this.world.visibilityState.subscribe((state) => {
        if (state !== VisibilityState.NonImmersive) view.show('none');
        else view.show(this.watching ? 'watching' : onScreen.peek() ? 'join' : 'entry');
      }),
      session.subscribe(() => {
        this.refreshStatus();
        if (onScreen.peek()) view.renderCards(app.machine.current, app.cards, faceUrl, !session.peek().synced);
      }),
      app.machine.subscribe((snapshot) => {
        if (!onScreen.peek()) return;
        view.renderCards(snapshot, app.cards, faceUrl, !session.peek().synced);
        this.refreshStatus();
      }),
      () => view.root.remove(),
    );
  }

  update(): void {
    if (!onScreen.peek()) return;
    const now = performance.now();
    if (now >= this.nextRefresh) {
      this.nextRefresh = now + 250;
      this.refreshShuffle(now);
      this.refreshStatus();
    }
    // Circle the mat, looking at its middle.
    this.table.mat.object3D!.getWorldPosition(this.target);
    // With the card list over the bottom of a phone screen, aim lower so the table sits above it.
    this.target.y += this.view?.coversView ? 0.02 - this.distance * 0.3 : 0.02;
    const flat = Math.cos(this.pitch) * this.distance;
    this.eye.set(Math.sin(this.yaw) * flat, Math.sin(this.pitch) * this.distance, Math.cos(this.yaw) * flat).add(this.target);
    const camera = this.world.camera;
    if (camera.parent) {
      camera.parent.updateWorldMatrix(true, false);
      camera.parent.worldToLocal(this.eye);
    }
    camera.position.copy(this.eye);
    camera.lookAt(this.target);
  }

  /** Join a room as a viewer, with the mat set out in front of the camera. */
  private start(code: string): void {
    this.view?.setError('');
    onScreen.value = true;
    this.placement.placeAt(SCREEN_MAT);
    this.listen();
    this.watching = true;
    this.view?.renderCards(app.machine.current, app.cards, faceUrl, true);
    this.view?.show('watching');
    // Where motion needs no asking (Android), a shake works from the start.
    if (!(window.DeviceMotionEvent as unknown as MotionPermission | undefined)?.requestPermission) void this.enableMotion();
    void this.together.watch(code);
  }

  /** Whether this screen may ask to shuffle right now. */
  private canShuffle(): boolean {
    return session.peek().synced && allowed(permissionContext(), 'shuffle') === 'forward' && app.machine.can({ type: 'SHUFFLE' });
  }

  /** Ask the reader's headset to shuffle (it decides, and everyone sees the riffle). */
  private shuffle(): void {
    if (!this.canShuffle() || performance.now() - this.askedAt < ASK_MS) return;
    if (!app.machine.send({ type: 'SHUFFLE' })) return;
    this.askedAt = performance.now();
    navigator.vibrate?.(40);
  }

  private refreshShuffle(now: number): void {
    const view = this.view;
    if (!view || !this.watching) return;
    const mine = session.peek().mode === 'shuffle' && session.peek().synced;
    if (mine && app.machine.state === 'SHUFFLING') view.setShuffle('shuffling');
    else if (this.canShuffle()) view.setShuffle(now - this.askedAt < ASK_MS ? 'asking' : 'ready');
    else view.setShuffle('hidden');
    const touch = window.matchMedia('(pointer: coarse)').matches;
    if (!mine || !this.canShuffle()) view.setTip(null);
    else if (touch && this.motion === 'on') view.setTip('Tap Shuffle or shake your phone.');
    else if (touch && this.motion === 'off') view.setTip('Tap Shuffle. After that, a shake works too.');
    else view.setTip('Your reader lets you shuffle: tap Shuffle.');
  }

  /** Listen for the phone being shaken, asking first where the phone requires it. */
  private async enableMotion(): Promise<void> {
    if (this.motion !== 'off' || !window.DeviceMotionEvent) return;
    const ask = (window.DeviceMotionEvent as unknown as MotionPermission).requestPermission;
    this.motion = 'asking';
    try {
      if (ask && (await ask()) !== 'granted') {
        this.motion = 'off';
        return;
      }
    } catch {
      this.motion = 'off';
      return;
    }
    this.motion = 'on';
    const onMotion = (e: DeviceMotionEvent) => this.felt(e);
    window.addEventListener('devicemotion', onMotion);
    this.cleanupFuncs.push(() => window.removeEventListener('devicemotion', onMotion));
  }

  /** Count sharp jolts; a few in quick succession is a shake. */
  private felt(e: DeviceMotionEvent): void {
    const a = e.acceleration;
    let strength: number;
    if (a && a.x !== null && a.y !== null && a.z !== null) strength = Math.hypot(a.x, a.y, a.z);
    else {
      const g = e.accelerationIncludingGravity;
      if (!g || g.x === null || g.y === null || g.z === null) return;
      strength = Math.abs(Math.hypot(g.x, g.y, g.z) - 9.81);
    }
    const now = performance.now();
    if (strength < SHAKE.jolt || now - this.lastJolt < SHAKE.gapMs) return;
    this.lastJolt = now;
    this.jolts.push(now);
    while (this.jolts.length && now - this.jolts[0] > SHAKE.windowMs) this.jolts.shift();
    if (this.jolts.length >= SHAKE.jolts && now - this.lastShake > SHAKE.restMs && this.canShuffle()) {
      this.lastShake = now;
      this.jolts.length = 0;
      this.shuffle();
    }
  }

  private refreshStatus(): void {
    const view = this.view;
    if (!view || !this.watching) return;
    const s = session.peek();
    if (s.role === 'solo' && s.status === 'ended') {
      // Couldn't join, or the room closed: back to the form, saying why.
      this.watching = false;
      view.setError(problemText(s.problem));
      view.show('join');
      return;
    }
    const room = s.code ? `room ${formatCode(s.code)}` : 'the room';
    const text: Partial<Record<typeof s.status, string>> = {
      preparing: `Joining ${room}...`,
      connecting: `Joining ${room}...`,
      connected: !s.synced
        ? this.unsyncedFor() > SLOW_SYNC_MS
          ? 'Still catching up. If this lasts, ask your reader to reload Carta Luna.'
          : 'Catching up with your reader...'
        : app.machine.current.spread
          ? `Watching ${room}`
          : `Watching ${room}. Your reader will choose a spread.`,
      reconnecting: 'Reconnecting...',
      alone: 'The reader stepped away. This page catches up when they are back.',
    };
    view.setStatus(text[s.status] ?? '');
  }

  /** How long this screen has been connected but not yet in step. */
  private unsyncedFor(): number {
    const s = session.peek();
    if (s.status !== 'connected' || s.synced) {
      this.unsyncedSince = 0;
      return 0;
    }
    if (!this.unsyncedSince) this.unsyncedSince = performance.now();
    return performance.now() - this.unsyncedSince;
  }

  /** Drag to turn around the table; scroll or pinch to come closer or move back. */
  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    const canvas = this.world.renderer.domElement;
    canvas.style.touchAction = 'none';
    const down = (e: PointerEvent) => {
      this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
      canvas.setPointerCapture?.(e.pointerId);
      this.pinch = 0;
    };
    const move = (e: PointerEvent) => {
      const last = this.pointers.get(e.pointerId);
      if (!last) return;
      if (this.pointers.size === 1) {
        this.yaw -= (e.clientX - last.x) * DRAG_YAW;
        this.pitch = clamp(this.pitch + (e.clientY - last.y) * DRAG_PITCH, ORBIT.minPitch, ORBIT.maxPitch);
      }
      last.x = e.clientX;
      last.y = e.clientY;
      if (this.pointers.size === 2) {
        const [a, b] = [...this.pointers.values()];
        const apart = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch > 0) this.zoom(this.pinch / apart);
        this.pinch = apart;
      }
    };
    const up = (e: PointerEvent) => {
      this.pointers.delete(e.pointerId);
      this.pinch = 0;
    };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      this.zoom(Math.exp(e.deltaY * 0.0012));
    };
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
    this.cleanupFuncs.push(() => {
      canvas.removeEventListener('pointerdown', down);
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerup', up);
      canvas.removeEventListener('pointercancel', up);
      canvas.removeEventListener('wheel', wheel);
    });
  }

  private zoom(factor: number): void {
    this.distance = clamp(this.distance * factor, ORBIT.minDistance, ORBIT.maxDistance);
  }
}

/** A card's face picture: the deck in use, or the default deck if this one lacks it. */
function faceUrl(id: string): string | null {
  return app.deck.faceUrl(id) ?? getDeck(config.defaults.deck)?.faceUrl(id) ?? null;
}
