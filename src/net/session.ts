/**
 * The shared-reading session as the rest of the app sees it: whether this
 * headset is reading alone, hosting, or a guest, the room's mode, and how
 * the connection is doing. Systems read this to decide what's allowed and
 * what to show; the together system is the only one that changes it.
 */

import { signal } from '@iwsdk/core';
import type { Mode, PermissionContext, SessionRole } from './permissions.js';

export type SessionStatus =
  /** Reading alone. */
  | 'off'
  /** Turning the room code into a key (takes a moment). */
  | 'preparing'
  | 'connecting'
  /** Host: room open, no guest yet. */
  | 'waiting'
  | 'connected'
  /** The connection dropped; trying again. */
  | 'reconnecting'
  /** The other person left (host: guest left; guest: reader left). */
  | 'alone'
  /** Couldn't join or the session ended; see `problem`. */
  | 'ended';

export type SessionProblem = 'no-host' | 'taken' | 'full' | 'replaced' | 'unavailable' | null;

export interface Session {
  role: SessionRole;
  mode: Mode;
  /** The room code, for the host to read out. */
  code: string | null;
  status: SessionStatus;
  peerPresent: boolean;
  problem: SessionProblem;
}

export const SOLO: Session = { role: 'solo', mode: 'watch', code: null, status: 'off', peerPresent: false, problem: null };

export const session = signal<Session>(SOLO);

export function permissionContext(s: Session = session.peek()): PermissionContext {
  return { role: s.role, mode: s.mode, peerPresent: s.peerPresent };
}
