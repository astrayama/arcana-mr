/**
 * End-to-end encryption for reading together. Both headsets turn the room
 * code into two things with one slow key-derivation run: an AES-GCM key, and
 * a room id. The relay only ever sees the room id and encrypted frames, never
 * the code or the reading.
 *
 * A six-digit code is only about 20 bits, so this keeps readings out of the
 * relay's hands in ordinary use, but someone who recorded the traffic and
 * tried every code could eventually read it. Rooms are short-lived and hold
 * nothing worth more than that.
 */

/** Who sent a frame: the host, the headset guest, or a viewer watching on a screen. */
export type PeerRole = 'host' | 'guest' | 'viewer';

export const FRAME_VERSION = 1;
const ROLE_BYTE: Record<PeerRole, number> = { host: 0, guest: 1, viewer: 2 };
const SALT = new TextEncoder().encode('arcana-mr/together/v1');
const ITERATIONS = 210_000;
const IV_LENGTH = 12;

export interface Room {
  /** 32 hex characters; the only thing the relay routes by. */
  roomId: string;
  key: CryptoKey;
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export async function deriveRoom(code: string, subtle: SubtleCrypto = crypto.subtle): Promise<Room> {
  const base = await subtle.importKey('raw', new TextEncoder().encode(code), 'PBKDF2', false, ['deriveBits']);
  const bits = new Uint8Array(
    await subtle.deriveBits({ name: 'PBKDF2', salt: SALT, iterations: ITERATIONS, hash: 'SHA-256' }, base, 384),
  );
  const key = await subtle.importKey('raw', bits.slice(0, 32), 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { roomId: toHex(bits.slice(32, 48)), key };
}

/** Encrypt a message from `from`: [version, role, iv(12), ciphertext]. */
export async function seal(room: Room, from: PeerRole, message: unknown): Promise<Uint8Array> {
  const header = new Uint8Array([FRAME_VERSION, ROLE_BYTE[from]]);
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
  const plain = new TextEncoder().encode(JSON.stringify(message));
  const sealed = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header }, room.key, plain),
  );
  const frame = new Uint8Array(2 + IV_LENGTH + sealed.length);
  frame.set(header, 0);
  frame.set(iv, 2);
  frame.set(sealed, 2 + IV_LENGTH);
  return frame;
}

/**
 * Decrypt a frame that should come from `from`. Returns null for anything
 * else: another version, a frame sent by our own role, a wrong key, or a
 * frame that was tampered with.
 */
export async function open(room: Room, frame: Uint8Array, from: PeerRole | readonly PeerRole[]): Promise<unknown | null> {
  const allowed = typeof from === 'string' ? [from] : from;
  if (frame.length < 2 + IV_LENGTH + 16 || frame[0] !== FRAME_VERSION || !allowed.some((role) => frame[1] === ROLE_BYTE[role])) return null;
  try {
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: frame.slice(2, 2 + IV_LENGTH), additionalData: frame.slice(0, 2) },
      room.key,
      frame.slice(2 + IV_LENGTH),
    );
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    return null;
  }
}
