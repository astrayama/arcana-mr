/**
 * Card randomness. Uses the Web Crypto CSPRNG (`crypto.getRandomValues`) so
 * every shuffle is unbiased and unpredictable. Never `Math.random`.
 */

const UINT32_RANGE = 0x1_0000_0000;

function randomUint32(): number {
  const buffer = new Uint32Array(1);
  crypto.getRandomValues(buffer);
  return buffer[0];
}

/** Uniform integer in `[0, maxExclusive)`, using rejection sampling to avoid modulo bias. */
export function randomInt(maxExclusive: number): number {
  if (!Number.isInteger(maxExclusive) || maxExclusive <= 0) {
    throw new RangeError(`randomInt needs a positive integer, got ${maxExclusive}`);
  }
  const limit = UINT32_RANGE - (UINT32_RANGE % maxExclusive);
  let value = randomUint32();
  while (value >= limit) {
    value = randomUint32();
  }
  return value % maxExclusive;
}

/** Uniform float in `[0, 1)`. */
export function randomFloat(): number {
  return randomUint32() / UINT32_RANGE;
}

/** Fisher-Yates shuffle. Returns a new array and leaves the input untouched. */
export function shuffle<T>(items: readonly T[]): T[] {
  const result = items.slice();
  for (let i = result.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const swap = result[i];
    result[i] = result[j];
    result[j] = swap;
  }
  return result;
}

export interface DrawnCard {
  cardId: string;
  reversed: boolean;
}

/**
 * Shuffle the deck and take the top `count` cards. Each card independently
 * lands reversed with probability `reversalChance`. Cards are never repeated
 * within one draw because they come from a single shuffled deck.
 */
export function drawCards(
  cardIds: readonly string[],
  count: number,
  reversalChance: number,
): DrawnCard[] {
  if (count > cardIds.length) {
    throw new RangeError(`Cannot draw ${count} cards from a deck of ${cardIds.length}`);
  }
  return shuffle(cardIds)
    .slice(0, count)
    .map((cardId) => ({ cardId, reversed: randomFloat() < reversalChance }));
}
