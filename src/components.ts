import { defineComponents } from '@iwsdk/core';
import { DeckPile, MatHandle, ReadingMat } from './components/table.js';
import { CardGrabProxy, TarotCard } from './components/tarotCard.js';
import { ReadingStatus, UiPanel } from './components/ui.js';

export default defineComponents([ReadingMat, DeckPile, MatHandle, TarotCard, CardGrabProxy, UiPanel, ReadingStatus]);
