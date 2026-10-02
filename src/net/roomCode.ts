/**
 * Room codes for reading together: six digits, easy to read aloud and to
 * tap in on a keypad in the headset. The code itself never leaves the
 * headset (see secure.ts).
 */

export const CODE_LENGTH = 6;

/** A fresh, unpredictable six-digit code. */
export function newRoomCode(random: (array: Uint32Array) => Uint32Array = (a) => crypto.getRandomValues(a)): string {
  const limit = 4_294_000_000; // a multiple of 1,000,000, so every code is equally likely
  const buffer = new Uint32Array(1);
  let value: number;
  do value = random(buffer)[0];
  while (value >= limit);
  return String(value % 1_000_000).padStart(CODE_LENGTH, '0');
}

export function isRoomCode(text: string): boolean {
  return /^\d{6}$/.test(text);
}

/** "472913" reads as "472 913". */
export function formatCode(code: string): string {
  return code.length > 3 ? `${code.slice(0, 3)} ${code.slice(3)}` : code;
}

export type KeypadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | 'del' | 'clear';

/** What the code entry shows after a key on the keypad. */
export function pressKey(value: string, key: KeypadKey): string {
  if (key === 'clear') return '';
  if (key === 'del') return value.slice(0, -1);
  return value.length >= CODE_LENGTH ? value : value + key;
}
