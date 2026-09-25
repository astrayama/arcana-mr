/**
 * Types and runtime validation for `cards.json`. Shared by the app and by
 * `scripts/validate-cards.ts`, so the rules only live in one place.
 */

export const SUITS = ['wands', 'cups', 'swords', 'pentacles'] as const;
export type Suit = (typeof SUITS)[number];

export interface CardOrientation {
  keywords: [string, string, string];
  read: string;
  prompt: string;
}

export interface CardData {
  id: string;
  name: string;
  arcana: 'major' | 'minor';
  suit: Suit | null;
  number: number;
  upright: CardOrientation;
  reversed: CardOrientation;
}

/** Minor-arcana rank slugs by number (1 = Ace ... 14 = King). */
export const MINOR_RANK_SLUGS = [
  '',
  'ace',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'page',
  'knight',
  'queen',
  'king',
] as const;

/** Words and phrases the voice guide rules out. Matched case-insensitively. */
export const BANNED_PHRASES = [
  'delve',
  'journey',
  'tapestry',
  'embrace the unknown',
  'you will',
  "you'll",
  'someone is coming',
  'destiny',
  'destined',
] as const;

const slugify = (text: string): string =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** The id a card must have, derived from its other fields so ids stay stable and predictable. */
export function expectedCardId(card: Pick<CardData, 'arcana' | 'suit' | 'number' | 'name'>): string {
  if (card.arcana === 'major') {
    return `major-${String(card.number).padStart(2, '0')}-${slugify(card.name)}`;
  }
  return `${card.suit}-${MINOR_RANK_SLUGS[card.number] ?? card.number}`;
}

/** Split prose into sentences. Colons and commas don't end a sentence. */
export function countSentences(text: string): number {
  return (text.trim().match(/[^.!?]+[.!?]+["')\]]*/g) ?? []).length;
}

const isString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

function validateOrientation(
  label: string,
  value: unknown,
  errors: string[],
): value is CardOrientation {
  if (typeof value !== 'object' || value === null) {
    errors.push(`${label}: missing`);
    return false;
  }
  const o = value as Record<string, unknown>;
  const startErrors = errors.length;

  if (!Array.isArray(o.keywords) || o.keywords.length !== 3 || !o.keywords.every(isString)) {
    errors.push(`${label}.keywords: needs exactly 3 non-empty strings`);
  }
  if (!isString(o.read)) {
    errors.push(`${label}.read: missing`);
  } else {
    const sentences = countSentences(o.read);
    if (sentences < 2 || sentences > 3) {
      errors.push(`${label}.read: needs 2-3 sentences, found ${sentences}`);
    }
  }
  if (!isString(o.prompt)) {
    errors.push(`${label}.prompt: missing`);
  } else {
    if (!o.prompt.trim().endsWith('?')) {
      errors.push(`${label}.prompt: must end with "?"`);
    }
    if (countSentences(o.prompt) !== 1) {
      errors.push(`${label}.prompt: must be a single question`);
    }
  }
  const extra = Object.keys(o).filter((k) => !['keywords', 'read', 'prompt'].includes(k));
  if (extra.length > 0) {
    errors.push(`${label}: unexpected fields ${extra.join(', ')}`);
  }
  return errors.length === startErrors;
}

export interface CardsValidationResult {
  ok: boolean;
  errors: string[];
  cards: CardData[];
}

/**
 * Validate parsed `cards.json`. Pass `rawText` as well to check rules that
 * apply to the file as written (the em-dash ban).
 */
export function validateCards(data: unknown, rawText?: string): CardsValidationResult {
  const errors: string[] = [];

  if (rawText !== undefined && rawText.includes('—')) {
    const lines = rawText
      .split('\n')
      .map((line, i) => (line.includes('—') ? i + 1 : 0))
      .filter(Boolean);
    errors.push(`em-dash found on line(s) ${lines.join(', ')}`);
  }

  if (!Array.isArray(data)) {
    return { ok: false, errors: [...errors, 'cards.json must be an array'], cards: [] };
  }

  const ids = new Set<string>();
  let majors = 0;
  const perSuit: Record<Suit, number> = { wands: 0, cups: 0, swords: 0, pentacles: 0 };

  data.forEach((entry: unknown, index) => {
    const at = `card[${index}]`;
    if (typeof entry !== 'object' || entry === null) {
      errors.push(`${at}: not an object`);
      return;
    }
    const c = entry as Record<string, unknown>;
    const label = isString(c.id) ? c.id : at;

    if (!isString(c.id)) errors.push(`${at}.id: missing`);
    if (!isString(c.name)) errors.push(`${label}.name: missing`);
    if (c.arcana !== 'major' && c.arcana !== 'minor') {
      errors.push(`${label}.arcana: must be "major" or "minor"`);
    }
    if (typeof c.number !== 'number' || !Number.isInteger(c.number)) {
      errors.push(`${label}.number: must be an integer`);
    }

    if (c.arcana === 'major') {
      majors++;
      if (c.suit !== null) errors.push(`${label}.suit: must be null for majors`);
      if (typeof c.number === 'number' && (c.number < 0 || c.number > 21)) {
        errors.push(`${label}.number: majors run 0-21`);
      }
    } else if (c.arcana === 'minor') {
      if (!SUITS.includes(c.suit as Suit)) {
        errors.push(`${label}.suit: must be one of ${SUITS.join(', ')}`);
      } else {
        perSuit[c.suit as Suit]++;
      }
      if (typeof c.number === 'number' && (c.number < 1 || c.number > 14)) {
        errors.push(`${label}.number: minors run 1-14`);
      }
    }

    if (isString(c.id)) {
      if (ids.has(c.id)) errors.push(`${c.id}: duplicate id`);
      ids.add(c.id);
      if (isString(c.name) && (c.arcana === 'major' || c.arcana === 'minor')) {
        const expected = expectedCardId(c as unknown as CardData);
        if (c.id !== expected) errors.push(`${c.id}: id should be "${expected}"`);
      }
    }

    const uprightOk = validateOrientation(`${label}.upright`, c.upright, errors);
    const reversedOk = validateOrientation(`${label}.reversed`, c.reversed, errors);
    if (uprightOk && reversedOk) {
      const up = (c.upright as CardOrientation).prompt.trim().toLowerCase();
      const rev = (c.reversed as CardOrientation).prompt.trim().toLowerCase();
      if (up === rev) errors.push(`${label}: upright and reversed prompts must differ`);
    }

    for (const orientation of ['upright', 'reversed'] as const) {
      const o = c[orientation] as Partial<CardOrientation> | undefined;
      const text = [o?.read, o?.prompt, ...(o?.keywords ?? [])].join(' ').toLowerCase();
      for (const phrase of BANNED_PHRASES) {
        if (new RegExp(`\\b${phrase.replace(/'/g, "['’]")}\\b`).test(text)) {
          errors.push(`${label}.${orientation}: avoid "${phrase}"`);
        }
      }
    }
  });

  if (data.length !== 78) errors.push(`expected 78 cards, found ${data.length}`);
  if (majors !== 22) errors.push(`expected 22 major arcana, found ${majors}`);
  for (const suit of SUITS) {
    if (perSuit[suit] !== 14) errors.push(`expected 14 ${suit}, found ${perSuit[suit]}`);
  }

  return { ok: errors.length === 0, errors, cards: errors.length === 0 ? (data as CardData[]) : [] };
}
