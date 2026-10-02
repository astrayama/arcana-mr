/**
 * The connection to the relay for one shared reading: connects, keeps the
 * line alive with a small ping, and reconnects with growing pauses when it
 * drops. It only moves encrypted frames; it knows nothing about readings.
 */

import type { PeerRole } from './secure.js';

export type RelayControl = { r: 'welcome'; peer: boolean } | { r: 'peer'; present: boolean };

/** Why the relay closed a connection, and whether trying again could help. */
export const CLOSE = {
  noHost: 4001,
  taken: 4002,
  full: 4003,
  rateLimited: 4008,
  replaced: 4010,
  tooBig: 1009,
} as const;

export type CloseReason = 'no-host' | 'taken' | 'full' | 'replaced' | 'lost';

/**
 * Decide what a closed connection means. `reconnecting` is true once we had
 * been connected before: then "no host" is retried for a while, because the
 * host may be reconnecting too.
 */
export function classifyClose(code: number, reconnecting: boolean, lostForMs: number): { reason: CloseReason; final: boolean } {
  switch (code) {
    case CLOSE.noHost:
      return { reason: 'no-host', final: !reconnecting || lostForMs > 60_000 };
    case CLOSE.taken:
      return { reason: 'taken', final: true };
    case CLOSE.full:
      return { reason: 'full', final: true };
    case CLOSE.replaced:
      return { reason: 'replaced', final: true };
    default:
      return { reason: 'lost', final: false };
  }
}

const BACKOFF_S = [0.5, 1, 2, 4, 8, 10];
const PING_S = 15;
const MISSED_PONGS = 2;

export interface RelayHandlers {
  onOpen(): void;
  onFrame(frame: Uint8Array): void;
  onControl(control: RelayControl): void;
  /** `final`: the connection is over and won't be retried. */
  onClose(reason: CloseReason, final: boolean): void;
}

export interface RelayOptions {
  /** Base URL of the relay, e.g. wss://arcana-relay.example.workers.dev */
  url: string;
  roomId: string;
  role: PeerRole;
  handlers: RelayHandlers;
  WebSocketImpl?: typeof WebSocket;
  now?: () => number;
  random?: () => number;
}

export class RelayClient {
  private ws: WebSocket | null = null;
  private attempt = 0;
  private wasOpen = false;
  private lostAt = 0;
  private closedByUs = false;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private missed = 0;
  private readonly WS: typeof WebSocket;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly options: RelayOptions) {
    this.WS = options.WebSocketImpl ?? WebSocket;
    this.now = options.now ?? (() => Date.now());
    this.random = options.random ?? Math.random;
  }

  get connected(): boolean {
    return this.ws?.readyState === 1;
  }

  connect(): void {
    this.closedByUs = false;
    const { url, roomId, role } = this.options;
    const ws = new this.WS(`${url.replace(/\/$/, '')}/v1/room/${roomId}?role=${role}`);
    ws.binaryType = 'arraybuffer';
    this.ws = ws;
    ws.onopen = () => {
      this.attempt = 0;
      this.wasOpen = true;
      this.lostAt = 0;
      this.missed = 0;
      this.startPing();
      this.options.handlers.onOpen();
    };
    ws.onmessage = (event: MessageEvent) => {
      const data = event.data as unknown;
      if (typeof data === 'string') {
        if (data === 'pong') {
          this.missed = 0;
          return;
        }
        try {
          const control = JSON.parse(data) as RelayControl;
          if (control && (control.r === 'welcome' || control.r === 'peer')) this.options.handlers.onControl(control);
        } catch {
          // Not something the relay sends; ignore.
        }
        return;
      }
      if (data instanceof ArrayBuffer) this.options.handlers.onFrame(new Uint8Array(data));
    };
    ws.onclose = (event: CloseEvent) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.stopPing();
      if (this.closedByUs) return;
      if (this.wasOpen && this.lostAt === 0) this.lostAt = this.now();
      const lostFor = this.lostAt ? this.now() - this.lostAt : 0;
      const { reason, final } = classifyClose(event.code, this.wasOpen, lostFor);
      this.options.handlers.onClose(reason, final);
      if (!final) this.scheduleRetry();
    };
  }

  send(frame: Uint8Array): boolean {
    if (!this.connected) return false;
    this.ws!.send(frame);
    return true;
  }

  /** Leave for good. */
  close(): void {
    this.closedByUs = true;
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.stopPing();
    this.ws?.close(1000, 'bye');
    this.ws = null;
  }

  /** The pause before the next try, with a little jitter so two headsets don't retry in lockstep. */
  nextDelayMs(): number {
    const base = BACKOFF_S[Math.min(this.attempt, BACKOFF_S.length - 1)];
    return Math.round(base * (0.8 + this.random() * 0.4) * 1000);
  }

  private scheduleRetry(): void {
    const delay = this.nextDelayMs();
    this.attempt++;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      if (!this.closedByUs) this.connect();
    }, delay);
  }

  private startPing(): void {
    this.stopPing();
    this.pingTimer = setInterval(() => {
      if (!this.connected) return;
      if (++this.missed > MISSED_PONGS) {
        // The line went quiet: drop it and reconnect.
        this.ws?.close(4000, 'silent');
        return;
      }
      this.ws!.send('ping');
    }, PING_S * 1000);
  }

  private stopPing(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    this.pingTimer = null;
  }
}
