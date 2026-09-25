/**
 * The app-wide context: card data, the active deck and theme, and the reading
 * state machine. Resolved once at startup; systems import `app` from here.
 */

import { config } from '../config.js';
import cardsJson from '../data/cards.json';
import { validateCards, type CardData } from '../data/cards.schema.js';
import { getDeck, listDeckIds, type ResolvedDeck } from '../decks/registry.js';
import { pickFromUrl } from '../lib/urlOverrides.js';
import { ReadingMachine } from '../state/readingMachine.js';
import { getTheme, listThemeIds, type ResolvedTheme } from '../themes/registry.js';

export interface AppContext {
  cards: ReadonlyMap<string, CardData>;
  deck: ResolvedDeck;
  theme: ResolvedTheme;
  machine: ReadingMachine;
  /** Card height in meters, from the configured width and the deck's aspect ratio. */
  cardHeightM: number;
}

function loadCards(): CardData[] {
  if (import.meta.env.DEV) {
    const result = validateCards(cardsJson);
    // An empty file is expected until the card data checkpoint lands.
    if (!result.ok && (cardsJson as unknown[]).length > 0) {
      console.error('[arcana] cards.json failed validation:\n' + result.errors.join('\n'));
    }
  }
  return cardsJson as CardData[];
}

export function createAppContext(search: string): AppContext {
  const cards = loadCards();

  const deckPick = pickFromUrl(search, config.urlParams.deck, listDeckIds(), config.defaults.deck);
  const themePick = pickFromUrl(search, config.urlParams.theme, listThemeIds(), config.defaults.theme);

  const deck = getDeck(deckPick.id);
  const theme = getTheme(themePick.id);
  if (!deck) throw new Error(`[arcana] default deck "${deckPick.id}" is missing from src/decks/`);
  if (!theme) throw new Error(`[arcana] default theme "${themePick.id}" is missing from src/themes/`);

  // Only draw cards the active deck can actually show.
  const drawable = cards.map((card) => card.id).filter((id) => deck.faceUrl(id) !== null);
  if (drawable.length < cards.length) {
    console.warn(
      `[arcana] deck "${deck.manifest.id}" has faces for ${drawable.length} of ${cards.length} cards`,
    );
  }

  console.info(`[arcana] deck=${deck.manifest.id} theme=${theme.theme.id} cards=${cards.length}`);

  return {
    cards: new Map(cards.map((card) => [card.id, card])),
    deck,
    theme,
    machine: new ReadingMachine({
      cardIds: drawable,
      reversalChance: config.reading.reversalChance,
    }),
    cardHeightM: config.card.widthM / deck.manifest.aspectRatio,
  };
}

export const app = createAppContext(window.location.search);
