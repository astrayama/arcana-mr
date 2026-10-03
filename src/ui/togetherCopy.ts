/**
 * Words for reading together, shared by the hub's Read together page and the
 * panel beside the mat. Plain ASCII, no predictions, no yes/no prompts.
 */

import { formatCode } from '../net/roomCode.js';
import type { Mode } from '../net/permissions.js';
import type { Session, SessionProblem } from '../net/session.js';
import type { ReadingSnapshot, ReadingStateName } from '../state/readingMachine.js';

/** What the guest does in each mode, said to the guest. */
export const GUEST_MODE_NOTE: Record<Mode, string> = {
  watch: 'Your reader shuffles, draws, and turns the cards. You see every move on your own mat.',
  shuffle: 'When the spread is chosen, lift the deck and give it a shake to shuffle. Your reader draws and turns the cards.',
};

export function problemText(problem: SessionProblem): string {
  switch (problem) {
    case 'no-host':
      return 'No reading has that code right now. Check it with your reader.';
    case 'full':
      return 'That reading already has a guest.';
    case 'taken':
      return "Couldn't open a room just now. Try again in a moment.";
    case 'outdated':
      return "Your reader's Carta Luna is an older version. Ask them to reload the page, then try again.";
    case 'replaced':
      return 'This reading was opened on another headset.';
    case 'unavailable':
      return "Reading together isn't set up in this version.";
    default:
      return 'The connection was lost.';
  }
}

/** The host's room, in a few words. */
export function hostStatus(s: Session): string {
  switch (s.status) {
    case 'preparing':
    case 'connecting':
      return 'Opening the room...';
    case 'waiting':
    case 'connected':
      return s.peerPresent ? 'Your guest is here.' : 'Waiting for your guest...';
    case 'reconnecting':
      return 'Reconnecting...';
    default:
      return '';
  }
}

/** The guest's connection, in a few words. */
export function guestStatus(s: Session): string {
  switch (s.status) {
    case 'preparing':
    case 'connecting':
      return 'Joining...';
    case 'connected':
      return 'Your reader will choose a spread.';
    case 'reconnecting':
      return 'Reconnecting...';
    case 'alone':
      return 'Your reader stepped away. Stay here and you will pick up where they are when they come back.';
    default:
      return '';
  }
}

/** "2 people watching on a screen." */
export function viewersLine(viewers: number): string {
  return viewers === 1 ? '1 person watching on a screen.' : `${viewers} people watching on a screen.`;
}

/** Under the host's watch/shuffle choice. */
export function roomModeNote(s: Session): string {
  if (!s.peerPresent && s.viewers === 0) return 'Your guest picks when they join; you can change it here any time.';
  return s.mode === 'shuffle'
    ? 'Your guests shuffle: in a headset by shaking the deck, on a phone with a button or a shake. Change it any time.'
    : 'Your guests watch while you shuffle. Change it any time.';
}

/** One line under the reading's status, while reading together. */
export function sessionLine(s: Session): string | null {
  if (s.role === 'solo') return null;
  if (s.status === 'reconnecting') return 'Reconnecting...';
  if (s.role === 'host') {
    const room = s.code ? `Room ${formatCode(s.code)}` : 'Your room';
    const watching = s.viewers > 0 ? `, ${s.viewers} watching on a screen` : '';
    return (s.peerPresent ? `${room}: reading together` : `${room}: waiting for your guest`) + watching;
  }
  if (s.status === 'alone') return 'Your reader stepped away';
  return s.peerPresent ? 'Reading together' : 'Joining...';
}

type ReadingState = Exclude<ReadingStateName, 'PLACING' | 'IDLE'>;

/** What the guest sees beside the mat. */
export function guestReadingStatus(state: ReadingState, mode: Mode): string {
  switch (state) {
    case 'READY':
      return mode === 'shuffle' ? 'Tap the deck, or lift it and give it a shake, to shuffle for your reader.' : 'Your reader is about to shuffle.';
    case 'SHUFFLING':
      return 'Shuffling...';
    case 'DRAWING':
      return mode === 'shuffle'
        ? "Your reader is drawing. Tap the deck, or lift it and shake it, to shuffle what's left."
        : 'Your reader is drawing the cards.';
    case 'AWAITING_FLIPS':
      return 'Your reader is turning the cards over.';
    case 'REVEALED':
      return 'Take your time with what came up.';
  }
}

/** The host's status while a guest does the shuffling, or null to use the usual words. */
export function hostShuffleModeStatus(state: ReadingState, snapshot: ReadingSnapshot, drawn: number): string | null {
  if (state === 'READY') return 'Your guests shuffle this time: wait for one of them to shuffle the deck.';
  if (state !== 'DRAWING') return null;
  if (snapshot.slots.length === 1) return 'Draw your card: pinch the top card, or tap the deck.';
  const next = snapshot.slots.find((slot) => slot.cardId === null)?.label ?? 'the next spot';
  if (drawn === 0) return `Draw the card for ${next}: pinch the top card, or tap the deck.`;
  return `Now the card for ${next}. Your guests can shuffle what's left.`;
}
