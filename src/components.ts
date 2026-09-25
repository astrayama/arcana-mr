import { defineComponents } from '@iwsdk/core';
import { DeckPile, ReadingMat } from './components/table.js';
import { TarotCard } from './components/tarotCard.js';
import { ReadingStatus, UiPanel } from './components/ui.js';

export default defineComponents([ReadingMat, DeckPile, TarotCard, UiPanel, ReadingStatus]);
