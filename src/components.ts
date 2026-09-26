import { defineComponents } from '@iwsdk/core';
import {
  DeckPile,
  MatHandle,
  OfferedCard,
  ReadingMat,
  SlotMarker,
  TableHandle,
} from './components/table.js';
import { TarotCard } from './components/tarotCard.js';
import { ReadingStatus, UiPanel } from './components/ui.js';

export default defineComponents([
  ReadingMat,
  DeckPile,
  MatHandle,
  TableHandle,
  SlotMarker,
  OfferedCard,
  TarotCard,
  UiPanel,
  ReadingStatus,
]);
