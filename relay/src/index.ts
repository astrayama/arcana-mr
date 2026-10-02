/**
 * Carta Luna relay: one Durable Object per room, holding at most one host and
 * one guest. It forwards each side's binary frames to the other, unchanged.
 * Frames are encrypted by the headsets; the relay never sees the room code,
 * never reads a frame, and never stores anything.
 *
 *   GET /health                        -> "ok"
 *   GET /v1/room/<32 hex>?role=host|guest  (WebSocket)
 *
 * Text frames from the relay itself:
 *   {"r":"welcome","peer":bool}   on joining: is the other side here?
 *   {"r":"peer","present":bool}   the other side joined or left
 * "ping" is answered with "pong" without waking the room.
 *
 * Close codes: 4001 no host yet, 4002 host already there, 4003 guest already
 * there, 4004 unexpected text, 4008 too many messages, 4010 replaced by a
 * newer connection, 1009 frame too big.
 */

import { DurableObject } from 'cloudflare:workers';

export interface Env {
  ROOM: DurableObjectNamespace<Room>;
  ALLOWED_ORIGINS: string;
}

type Role = 'host' | 'guest';

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
    if (role !== 'host' && role !== 'guest') return new Response('bad role', { status: 400 });
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
    const other: Role = role === 'host' ? 'guest' : 'host';
    const { 0: client, 1: server } = new WebSocketPair();

    const now = Date.now();
    const same = this.open(role);
    let refuse: [number, string] | null = null;
    if (same.length > 0) {
      if (same.every((ws) => this.isStale(ws, now))) {
        for (const ws of same) ws.close(4010, 'replaced');
      } else {
        refuse = role === 'host' ? [4002, 'taken'] : [4003, 'full'];
      }
    } else if (role === 'guest' && this.open('host').length === 0) {
      refuse = [4001, 'no host'];
    }

    if (refuse) {
      this.ctx.acceptWebSocket(server, ['rejected']);
      server.serializeAttachment({ role: 'rejected', joinedAt: now } satisfies Attachment);
      server.close(refuse[0], refuse[1]);
      return new Response(null, { status: 101, webSocket: client });
    }

    this.ctx.acceptWebSocket(server, [role]);
    server.serializeAttachment({ role, joinedAt: now } satisfies Attachment);
    const peers = this.open(other);
    server.send(JSON.stringify({ r: 'welcome', peer: peers.length > 0 }));
    for (const ws of peers) ws.send(JSON.stringify({ r: 'peer', present: true }));
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
    const other: Role = attachment.role === 'host' ? 'guest' : 'host';
    for (const peer of this.open(other)) peer.send(message);
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

  /** Open connections with this role. */
  private open(role: Role): WebSocket[] {
    return this.ctx.getWebSockets(role).filter((ws) => ws.readyState === WebSocket.OPEN);
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

  /** Tell the other side someone left, unless a newer connection already took their place. */
  private left(ws: WebSocket): void {
    this.buckets.delete(ws);
    const attachment = ws.deserializeAttachment() as Attachment | null;
    if (!attachment || attachment.role === 'rejected') return;
    const role = attachment.role;
    if (this.open(role).some((other) => other !== ws)) return;
    const otherRole: Role = role === 'host' ? 'guest' : 'host';
    for (const peer of this.open(otherRole)) peer.send(JSON.stringify({ r: 'peer', present: false }));
  }
}
