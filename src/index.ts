import { Raycaster, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { app } from './app/context.js';
import { backRegistry } from './backs/catalog.js';
import { deckRegistry, getDeck } from './decks/registry.js';
import { environmentRegistry } from './environments/catalog.js';
import { emptyAssetStore } from './storage/assetStore.js';
import { loadDevicePacks } from './storage/devicePacks.js';
import { builtinSpreads, getSpread } from './spreads/catalog.js';
import { panelRegistry } from './ui/panels.js';
import { AmbientSystem } from './systems/ambientSystem.js';
import { FocusSystem } from './interaction/focusSystem.js';
import { BuilderSystem } from './systems/builderSystem.js';
import { HubSystem } from './systems/hubSystem.js';
import { CardInteractionSystem } from './systems/cardInteractionSystem.js';
import { DeckSystem } from './systems/deckSystem.js';
import { DrawSystem } from './systems/drawSystem.js';
import { EnvironmentSystem } from './systems/environmentSystem.js';
import { LandingSystem } from './systems/landingSystem.js';
import { MatDragSystem } from './systems/matDragSystem.js';
import { MeaningSystem } from './systems/meaningSystem.js';
import { NearTriggerSystem } from './systems/nearTriggerSystem.js';
import { PointerSafetySystem } from './systems/pointerSafetySystem.js';
import { PlacementSystem } from './systems/placementSystem.js';
import { ReadingFlowSystem } from './systems/readingFlowSystem.js';
import { ReadingStatusSystem } from './systems/readingStatusSystem.js';
import { SessionSystem } from './systems/sessionSystem.js';
import { TableGrabSystem } from './systems/tableGrabSystem.js';
import { TableSystem } from './systems/tableSystem.js';
import { ThemeLightingSystem } from './systems/themeLightingSystem.js';

if (import.meta.env.DEV) {
  // Relay headset errors and XR attempts to the dev server log (dev builds only).
  await import('./dev/deviceLog.js');
}

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world
    .registerSystem(ReadingStatusSystem)
    .registerSystem(SessionSystem)
    .registerSystem(ThemeLightingSystem)
    .registerSystem(FocusSystem)
    .registerSystem(NearTriggerSystem)
    .registerSystem(PointerSafetySystem)
    .registerSystem(TableSystem)
    // Before the reading flow, so it lets go of everything before the table is cleared.
    .registerSystem(TableGrabSystem)
    .registerSystem(AmbientSystem)
    .registerSystem(EnvironmentSystem)
    .registerSystem(PlacementSystem)
    .registerSystem(MatDragSystem)
    .registerSystem(ReadingFlowSystem)
    .registerSystem(HubSystem)
    .registerSystem(MeaningSystem)
    .registerSystem(DeckSystem)
    .registerSystem(DrawSystem)
    .registerSystem(BuilderSystem)
    .registerSystem(CardInteractionSystem)
    .registerSystem(LandingSystem);

  // Decks, backs, and surroundings the reader added on this headset (none yet:
  // adding your own comes in a later update, and the store is empty until then).
  void loadDevicePacks(emptyAssetStore, {
    addDeck: (deck) => deckRegistry.register(deck),
    addBack: (back) => backRegistry.register(back),
    addEnvironment: (env) => environmentRegistry.register(env),
    cardIds: [...app.cards.keys()],
    toUrl: (blob) => URL.createObjectURL(blob),
    revokeUrl: (url) => URL.revokeObjectURL(url),
  }).then((problems) => {
    for (const problem of problems) console.warn(`[arcana] skipped something saved on this headset: ${problem}`);
    // The saved deck may be one of them.
    const saved = app.settings.peek().deck;
    if (saved !== app.deck.id && getDeck(saved)) app.setDeck(saved);
  });

  if (import.meta.env.DEV) {
    // Handle for automated checks in the IWSDK emulator. Not present in production builds.
    (window as unknown as { __arcana: unknown }).__arcana = {
      app,
      world,
      placement: world.getSystem(PlacementSystem),
      flow: world.getSystem(ReadingFlowSystem),
      hub: world.getSystem(HubSystem),
      builder: world.getSystem(BuilderSystem),
      meaning: world.getSystem(MeaningSystem),
      table: world.getSystem(TableSystem),
      grab: world.getSystem(TableGrabSystem),
      deck: world.getSystem(DeckSystem),
      draw: world.getSystem(DrawSystem),
      cardsys: world.getSystem(CardInteractionSystem),
      spreads: { builtinSpreads, getSpread },
      registries: { decks: deckRegistry, backs: backRegistry },
      panels: panelRegistry,
      Raycaster,
    };
  }
});
