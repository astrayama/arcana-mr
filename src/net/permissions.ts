/**
 * Who may do what in a shared reading. The host chose a mode when opening
 * the room: "watch" (the host reads, the guest watches) or "shuffle" (the
 * guest shuffles, the host lays out). With no guest present, the host can do
 * everything, and anyone reading alone always can.
 */

import type { GateDecision, ReadingEvent } from '../state/readingMachine.js';

/** `viewer`: watching on a phone or computer screen, never touching anything. */
export type SessionRole = 'solo' | 'host' | 'guest' | 'viewer';
export type Mode = 'watch' | 'shuffle';

export interface PermissionContext {
  role: SessionRole;
  mode: Mode;
  peerPresent: boolean;
}

export type Action = 'chooseSpread' | 'newReading' | 'shuffle' | 'draw' | 'turn' | 'liftDeck' | 'grabCard';

/** "forward" means: ask the host, who decides. */
export type Allowance = 'yes' | 'no' | 'forward';

export function allowed(ctx: PermissionContext, action: Action): Allowance {
  if (ctx.role === 'solo' || (ctx.role === 'host' && !ctx.peerPresent)) return 'yes';
  if (ctx.role === 'viewer') return 'no';
  if (ctx.role === 'host') {
    // In shuffle mode the deck is the guest's to shuffle.
    if (ctx.mode === 'shuffle' && (action === 'shuffle' || action === 'liftDeck')) return 'no';
    return 'yes';
  }
  // Guest.
  if (ctx.mode === 'shuffle') {
    if (action === 'shuffle') return 'forward';
    if (action === 'liftDeck') return 'yes';
  }
  return 'no';
}

/** What a local event from this headset should do in a shared reading. */
export function gateFor(ctx: PermissionContext, event: ReadingEvent): GateDecision {
  switch (event.type) {
    case 'MAT_PLACED':
    case 'REPLACE_MAT':
      return 'apply';
    case 'SHUFFLE_DONE':
      // The end of a riffle: only whoever owns the reading says it's done.
      return ctx.role === 'guest' || ctx.role === 'viewer' ? 'reject' : 'apply';
    case 'RESTORE':
      return 'reject';
    case 'CHOOSE_SPREAD':
      return decide(allowed(ctx, 'chooseSpread'));
    case 'NEW_READING':
      return decide(allowed(ctx, 'newReading'));
    case 'SHUFFLE':
      return decide(allowed(ctx, 'shuffle'));
    case 'DRAW':
      return decide(allowed(ctx, 'draw'));
    case 'TURN':
      return decide(allowed(ctx, 'turn'));
  }
}

function decide(allowance: Allowance): GateDecision {
  return allowance === 'yes' ? 'apply' : allowance === 'forward' ? 'forwarded' : 'reject';
}
