/**
 * The messages two headsets exchange in a shared reading (inside the
 * encryption), and strict checks on everything that arrives. Anything that
 * doesn't look exactly right is dropped.
 */

import type { DrawnCard } from '../lib/shuffle.js';
import type { ReadingEvent, ReadingSnapshot, ResolvedEvent, SharedReading } from '../state/readingMachine.js';
import { MAX_SPREAD_CARDS, validateSpread, type SpreadDef } from '../spreads/spread.schema.js';
import type { Mode } from './permissions.js';
import type { PeerRole } from './secure.js';

export const PROTOCOL_VERSION = 1;

export type Obj = 'deck' | number;
export type V3 = [number, number, number];
export type Q4 = [number, number, number, number];

export type WireEvent =
  | { type: 'CHOOSE_SPREAD'; spread: SpreadDef; rn: number }
  | { type: 'SHUFFLE'; shuffles: number; passes: 1 | 2 }
  | { type: 'SHUFFLE_DONE'; shuffles: number }
  | { type: 'DRAW'; slot: number; cardId: string; reversed: boolean; toHand: boolean }
  | { type: 'TURN'; slot: number; faceUp: boolean }
  | { type: 'NEW_READING' };

export interface HoldState {
  obj: Obj;
  hid: number;
  p: V3;
  q: Q4;
}

export type SyncReason = 'join' | 'placed' | 'gap' | 'reconnect' | 'failed' | 'stale';

export type Msg =
  | { t: 'hello'; v: number; role: PeerRole; deck: string; mode?: Mode; epoch?: string }
  | { t: 'sync-req'; why: SyncReason }
  | { t: 'state'; epoch: string; seq: number; mode: Mode; reading: SharedReading; holds: HoldState[] }
  | { t: 'ev'; seq: number; ev: WireEvent }
  | { t: 'intent'; id: number; ev: { type: 'SHUFFLE' } }
  | { t: 'nack'; id: number; why: 'not-allowed' | 'not-now' }
  | { t: 'hold'; rn: number; hid: number; obj: Obj; on: boolean; p: V3; q: Q4 }
  | { t: 'pose'; rn: number; hid: number; obj: Obj; p: V3; q: Q4; ts: number }
  | { t: 'bye' };

export interface ParseContext {
  isCardId(id: string): boolean;
}

const PHASES = ['IDLE', 'READY', 'SHUFFLING', 'DRAWING', 'AWAITING_FLIPS', 'REVEALED'] as const;
const SYNC_REASONS: readonly SyncReason[] = ['join', 'placed', 'gap', 'reconnect', 'failed', 'stale'];

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);
const isInt = (v: unknown, min = 0, max = Number.MAX_SAFE_INTEGER): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= min && v <= max;
const isStr = (v: unknown, max = 64): v is string => typeof v === 'string' && v.length > 0 && v.length <= max;
const isBool = (v: unknown): v is boolean => typeof v === 'boolean';
const onlyKeys = (o: Record<string, unknown>, keys: readonly string[]) => Object.keys(o).every((k) => keys.includes(k));

function isV3(v: unknown): v is V3 {
  return Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) < 3);
}

function isQ4(v: unknown): v is Q4 {
  if (!Array.isArray(v) || v.length !== 4 || !v.every((n) => typeof n === 'number' && Number.isFinite(n))) return false;
  const length = Math.hypot(...(v as number[]));
  return Math.abs(length - 1) < 0.01;
}

const isObjRef = (v: unknown): v is Obj => v === 'deck' || isInt(v, 0, MAX_SPREAD_CARDS - 1);
const isMode = (v: unknown): v is Mode => v === 'watch' || v === 'shuffle';
const isRole = (v: unknown): v is PeerRole => v === 'host' || v === 'guest';

function isSpread(v: unknown): v is SpreadDef {
  if (!isObj(v) || (v.origin !== 'builtin' && v.origin !== 'custom')) return false;
  return validateSpread(v, null).ok;
}

export function parseSharedReading(v: unknown, ctx: ParseContext): SharedReading | null {
  if (!isObj(v) || !onlyKeys(v, ['phase', 'spread', 'rn', 'shuffles', 'slots'])) return null;
  if (!PHASES.includes(v.phase as (typeof PHASES)[number])) return null;
  if (v.spread !== null && !isSpread(v.spread)) return null;
  if (!isInt(v.rn) || !isInt(v.shuffles)) return null;
  if (!Array.isArray(v.slots) || v.slots.length > MAX_SPREAD_CARDS) return null;
  for (const slot of v.slots) {
    if (!isObj(slot) || !onlyKeys(slot, ['c', 'r', 'u'])) return null;
    if (slot.c !== null && !(isStr(slot.c) && ctx.isCardId(slot.c))) return null;
    if (!isBool(slot.r) || !isBool(slot.u)) return null;
  }
  return v as unknown as SharedReading;
}

function parseWireEvent(v: unknown, ctx: ParseContext): WireEvent | null {
  if (!isObj(v)) return null;
  switch (v.type) {
    case 'CHOOSE_SPREAD':
      return onlyKeys(v, ['type', 'spread', 'rn']) && isSpread(v.spread) && isInt(v.rn) ? (v as WireEvent) : null;
    case 'SHUFFLE':
      return onlyKeys(v, ['type', 'shuffles', 'passes']) && isInt(v.shuffles) && (v.passes === 1 || v.passes === 2)
        ? (v as WireEvent)
        : null;
    case 'SHUFFLE_DONE':
      return onlyKeys(v, ['type', 'shuffles']) && isInt(v.shuffles) ? (v as WireEvent) : null;
    case 'DRAW':
      return onlyKeys(v, ['type', 'slot', 'cardId', 'reversed', 'toHand']) &&
        isInt(v.slot, 0, MAX_SPREAD_CARDS - 1) &&
        isStr(v.cardId) &&
        ctx.isCardId(v.cardId) &&
        isBool(v.reversed) &&
        isBool(v.toHand)
        ? (v as WireEvent)
        : null;
    case 'TURN':
      return onlyKeys(v, ['type', 'slot', 'faceUp']) && isInt(v.slot, 0, MAX_SPREAD_CARDS - 1) && isBool(v.faceUp)
        ? (v as WireEvent)
        : null;
    case 'NEW_READING':
      return onlyKeys(v, ['type']) ? (v as WireEvent) : null;
    default:
      return null;
  }
}

/** Check a decrypted message. Returns null for anything malformed or unexpected. */
export function parseMessage(v: unknown, ctx: ParseContext): Msg | null {
  if (!isObj(v)) return null;
  switch (v.t) {
    case 'hello':
      return onlyKeys(v, ['t', 'v', 'role', 'deck', 'mode', 'epoch']) &&
        isInt(v.v) &&
        isRole(v.role) &&
        isStr(v.deck) &&
        (v.mode === undefined || isMode(v.mode)) &&
        (v.epoch === undefined || isStr(v.epoch, 32))
        ? (v as Msg)
        : null;
    case 'sync-req':
      return onlyKeys(v, ['t', 'why']) && SYNC_REASONS.includes(v.why as SyncReason) ? (v as Msg) : null;
    case 'state': {
      if (!onlyKeys(v, ['t', 'epoch', 'seq', 'mode', 'reading', 'holds'])) return null;
      if (!isStr(v.epoch, 32) || !isInt(v.seq) || !isMode(v.mode)) return null;
      if (!parseSharedReading(v.reading, ctx)) return null;
      if (!Array.isArray(v.holds) || v.holds.length > 2) return null;
      for (const h of v.holds) {
        if (!isObj(h) || !onlyKeys(h, ['obj', 'hid', 'p', 'q']) || !isObjRef(h.obj) || !isInt(h.hid)) return null;
        if (!isV3(h.p) || !isQ4(h.q)) return null;
      }
      return v as Msg;
    }
    case 'ev': {
      if (!onlyKeys(v, ['t', 'seq', 'ev']) || !isInt(v.seq)) return null;
      return parseWireEvent(v.ev, ctx) ? (v as Msg) : null;
    }
    case 'intent':
      return onlyKeys(v, ['t', 'id', 'ev']) && isInt(v.id) && isObj(v.ev) && v.ev.type === 'SHUFFLE' && onlyKeys(v.ev, ['type'])
        ? (v as Msg)
        : null;
    case 'nack':
      return onlyKeys(v, ['t', 'id', 'why']) && isInt(v.id) && (v.why === 'not-allowed' || v.why === 'not-now')
        ? (v as Msg)
        : null;
    case 'hold':
      return onlyKeys(v, ['t', 'rn', 'hid', 'obj', 'on', 'p', 'q']) &&
        isInt(v.rn) &&
        isInt(v.hid) &&
        isObjRef(v.obj) &&
        isBool(v.on) &&
        isV3(v.p) &&
        isQ4(v.q)
        ? (v as Msg)
        : null;
    case 'pose':
      return onlyKeys(v, ['t', 'rn', 'hid', 'obj', 'p', 'q', 'ts']) &&
        isInt(v.rn) &&
        isInt(v.hid) &&
        isObjRef(v.obj) &&
        isV3(v.p) &&
        isQ4(v.q) &&
        typeof v.ts === 'number' &&
        Number.isFinite(v.ts)
        ? (v as Msg)
        : null;
    case 'bye':
      return onlyKeys(v, ['t']) ? (v as Msg) : null;
    default:
      return null;
  }
}

/** A reading event the host just applied, as it goes over the wire. Null for events that aren't shared. */
export function toWire(event: ResolvedEvent, snapshot: ReadingSnapshot): WireEvent | null {
  switch (event.type) {
    case 'CHOOSE_SPREAD':
      return { type: 'CHOOSE_SPREAD', spread: event.spread, rn: snapshot.readingNumber };
    case 'SHUFFLE':
      return { type: 'SHUFFLE', shuffles: snapshot.shuffles, passes: event.passes ?? 2 };
    case 'SHUFFLE_DONE':
      return { type: 'SHUFFLE_DONE', shuffles: snapshot.shuffles };
    case 'DRAW': {
      const card = event.card;
      if (!card || event.slot === undefined) return null;
      return { type: 'DRAW', slot: event.slot, cardId: card.cardId, reversed: card.reversed, toHand: event.toHand ?? false };
    }
    case 'TURN':
      return { type: 'TURN', slot: event.slot, faceUp: event.faceUp };
    case 'NEW_READING':
      return { type: 'NEW_READING' };
    default:
      return null;
  }
}

/** A host event as the guest's reading machine takes it. */
export function fromWire(ev: WireEvent): ReadingEvent {
  switch (ev.type) {
    case 'CHOOSE_SPREAD':
      return { type: 'CHOOSE_SPREAD', spread: { ...ev.spread, origin: ev.spread.origin }, rn: ev.rn };
    case 'SHUFFLE':
      return { type: 'SHUFFLE', passes: ev.passes };
    case 'SHUFFLE_DONE':
      return { type: 'SHUFFLE_DONE' };
    case 'DRAW': {
      const card: DrawnCard = { cardId: ev.cardId, reversed: ev.reversed };
      return { type: 'DRAW', slot: ev.slot, card, toHand: ev.toHand };
    }
    case 'TURN':
      return { type: 'TURN', slot: ev.slot, faceUp: ev.faceUp };
    case 'NEW_READING':
      return { type: 'NEW_READING' };
  }
}
