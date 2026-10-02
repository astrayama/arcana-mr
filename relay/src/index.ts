/**
 * Carta Luna relay: one Durable Object per room, holding one host, at most
 * one headset guest, and up to six screen viewers watching on a phone or
 * computer. The host's frames go to everyone else; the guest's and viewers'
 * frames go to the host only. Frames are encrypted by the devices; the relay
 * never sees the room code, never reads a frame, and never stores anything.
 *
 *   GET /health                                   -> "ok"
 *   GET /v1/room/<32 hex>?role=host|guest|viewer   (WebSocket)
 *
 * Text frames from the relay itself:
 *   to the host:   {"r":"welcome"|"peer","peer"|"present":bool,"guest":bool,"viewers":n}
 *                  (anyone here, the headset guest here, how many viewers)
 *   to the others: {"r":"welcome","peer":bool} / {"r":"peer","present":bool} (the host)
 * "ping" is answered with "pong" without waking the room.
 *
 * Close codes: 4001 no host yet, 4002 host already there, 4003 room full (a
 * guest already there, or six viewers), 4004 unexpected text, 4008 too many
 * messages, 4010 replaced by a newer connection, 1009 frame too big.
 */

import { DurableObject } from 'cloudflare:workers';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  ALLOWED_ORIGINS: string;
}

type Role = 'host' | 'guest' | 'viewer';

/** Screen viewers one room can hold. */
const MAX_VIEWERS = 6;

interface Attachment {
  role: Role | 'rejected';
  joinedAt: number;
}

const MAX_FRAME_BYTES = 16 * 1024;
/** Token bucket per connection: steady rate and burst. */
const RATE_PER_S = 40;
const BURST = 80;
/** A same-role connection silent this long (no pings) is replaced by a new one. */
const STALE_MS = 45_000;

const escapeRe = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, '\\$&');

export function originAllowed(origin: string | null, allowed: string): boolean {
  if (!origin) return false;
  return allowed
    .split(',')
    .map((pattern) => pattern.trim())
    .filter(Boolean)
    .some((pattern) =>
      pattern.includes('*')
        ? new RegExp(`^${pattern.split('*').map(escapeRe).join('[a-z0-9-]+')}$`).test(origin)
        : pattern === origin,
    );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === '/health') return new Response('ok');
    const match = url.pathname.match(/^\/v1\/room\/([0-9a-f]{32})$/);
    if (!match) return new Response('not found', { status: 404 });
    if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
      return new Response('expected a WebSocket', { status: 426 });
    }
    if (!originAllowed(request.headers.get('Origin'), env.ALLOWED_ORIGINS)) {
      return new Response('forbidden', { status: 403 });
    }
    const role = url.searchParams.get('role');
    if (role !== 'host' && role !== 'guest' && role !== 'viewer') return new Response('bad role', { status: 400 });
    const room = env.ROOM.get(env.ROOM.idFromName(match[1]));
    return room.fetch(request);
  },
} satisfies ExportedHandler<Env>;

export class Room extends DurableObject<Env> {
  /** Rate counters; losing them when the room hibernates is fine. */
  private readonly buckets = new Map<WebSocket, { tokens: number; at: number }>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair('ping', 'pong'));
  }

  async fetch(request: Request): Promise<Response> {
    const role = new URL(request.url).searchParams.get('role') as Role;
    const { 0: client, 1: server } = new WebSocketPair();

    const now = Date.now();
    const same = this.open(role);
    let refuse: [number, string] | null = null;
    if (role !== 'host' && this.open('host').length === 0) {
      refuse = [4001, 'no host'];
    } else if (role === 'viewer') {
      // Room for six; a viewer gone quiet makes way for a new one.
      if (same.length >= MAX_VIEWERS) {
        const stale = same.find((ws) => this.isStale(ws, now));
        if (stale) stale.close(4010, 'replaced');
        else refuse = [4003, 'full'];
      }
    } else if (same.length > 0) {
      if (same.every((ws) => this.isStale(ws, now))) {
        for (const ws of same) ws.close(4010, 'replaced');
      } else {
        refuse = role === 'host' ? [4002, 'taken'] : [4003, 'full'];
      }
    }

    if (refuse) {
      this.ctx.acceptWebSocket(server, ['rejected']);
      server.serializeAttachment({ role: 'rejected', joinedAt: now } satisfies Attachment);
      server.close(refuse[0], refuse[1]);
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, joinedAt: now } satisfies Attachment);
    if (role === 'host') {
      server.send(JSON.stringify({ r: 'welcome', ...this.audience() }));
      for (const ws of this.followers()) ws.send(JSON.stringify({ r: 'peer', present: true }));
    } else {
      server.send(JSON.stringify({ r: 'welcome', peer: true }));
      this.tellHost();
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment || attachment.role === 'rejected') return;
    if (typeof message === 'string') {
      ws.close(4004, 'text not allowed');
      return;
    }
    if (message.byteLength > MAX_FRAME_BYTES) {
      ws.close(1009, 'too big');
      return;
    }
    if (!this.take(ws)) {
      ws.close(4008, 'slow down');
      return;
    }
    // The host speaks to everyone; the others speak only to the host.
    const to = attachment.role === 'host' ? this.followers() : this.open('host');
    for (const peer of to) peer.send(message);
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.left(ws);
    try {
      ws.close(code, reason);
    } catch {
      // Already closed.
    }
  }

  async webSocketError(ws: WebSocket): Promise<void> {
    this.left(ws);
  }

  /** Open connections with this role (leaving out one that is closing). */
  private open(role: Role, except?: WebSocket): WebSocket[] {
    return this.ctx.getWebSockets(role).filter((ws) => ws !== except && ws.readyState === WebSocket.OPEN);
  }

  /** Everyone who follows the host: the headset guest and the screen viewers. */
  private followers(except?: WebSocket): WebSocket[] {
    return [...this.open('guest', except), ...this.open('viewer', except)];
  }

  /** Who is with the host, as the host hears it. */
  private audience(except?: WebSocket): { peer: boolean; guest: boolean; viewers: number } {
    const guest = this.open('guest', except).length > 0;
    const viewers = this.open('viewer', except).length;
    return { peer: guest || viewers > 0, guest, viewers };
  }

  private tellHost(except?: WebSocket): void {
    const { peer, guest, viewers } = this.audience(except);
    const frame = JSON.stringify({ r: 'peer', present: peer, guest, viewers });
    for (const host of this.open('host', except)) host.send(frame);
  }

  private isStale(ws: WebSocket, now: number): boolean {
    const attachment = ws.deserializeAttachment() as Attachment | null;
    const lastPing = this.ctx.getWebSocketAutoResponseTimestamp(ws)?.getTime() ?? attachment?.joinedAt ?? 0;
    return now - lastPing > STALE_MS;
  }

  private take(ws: WebSocket): boolean {
    const now = Date.now();
    const bucket = this.buckets.get(ws) ?? { tokens: BURST, at: now };
    bucket.tokens = Math.min(BURST, bucket.tokens + ((now - bucket.at) / 1000) * RATE_PER_S);
    bucket.at = now;
    this.buckets.set(ws, bucket);
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  }

  /** Tell the others someone left (unless a newer host already took the host's place). */
  private left(ws: WebSocket): void {
    this.buckets.delete(ws);
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment || attachment.role === 'rejected') return;
    if (attachment.role !== 'host') {
      this.tellHost(ws);
      return;
    }
    if (this.open('host', ws).length > 0) return;
    for (const peer of this.followers(ws)) peer.send(JSON.stringify({ r: 'peer', present: false }));
  }
}
