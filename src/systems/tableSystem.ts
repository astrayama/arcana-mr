import { createSystem, type Entity } from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { DeckPile, ReadingMat } from '../components/table.js';
import {
  buildCardMaterials,
  buildDeckPile,
  buildMat,
  type CardMaterials,
  MAT_SURFACE_Y,
} from '../visuals/tableVisuals.js';

/**
 * Builds the reading mat and the deck pile. The mat stays hidden until the
 * placement system puts it on a table; everything else on the table is
 * parented to it, so moving the mat moves the whole reading.
 */
export class TableSystem extends createSystem({}) {
  mat!: Entity;
  deck!: Entity;
  cardMaterials!: CardMaterials;

  init(): void {
    this.cardMaterials = buildCardMaterials(app.deck, app.theme);

    this.mat = this.world.createTransformEntity(buildMat(app.theme), { persistent: true });
    this.mat.addComponent(ReadingMat);
    this.mat.object3D!.visible = false;

    const pile = buildDeckPile(
      this.cardMaterials,
      config.card.widthM,
      app.cardHeightM,
      app.cards.size,
    );
    this.deck = this.world.createTransformEntity(pile, { parent: this.mat });
    this.deck.addComponent(DeckPile);
    this.deck.object3D!.position.set(0, MAT_SURFACE_Y, config.layout.deckZ);
  }
}
