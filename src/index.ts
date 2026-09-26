import { Raycaster, World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { app } from './app/context.js';
import { panelRegistry } from './ui/panels.js';
import { AmbientSystem } from './systems/ambientSystem.js';
import { CardInteractionSystem } from './systems/cardInteractionSystem.js';
import { EnvironmentSystem } from './systems/environmentSystem.js';
import { LandingSystem } from './systems/landingSystem.js';
import { MatDragSystem } from './systems/matDragSystem.js';
import { MeaningSystem } from './systems/meaningSystem.js';
import { PlacementSystem } from './systems/placementSystem.js';
import { ReadingFlowSystem } from './systems/readingFlowSystem.js';
import { ReadingStatusSystem } from './systems/readingStatusSystem.js';
import { SessionSystem } from './systems/sessionSystem.js';
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
    .registerSystem(TableSystem)
    .registerSystem(AmbientSystem)
    .registerSystem(EnvironmentSystem)
    .registerSystem(PlacementSystem)
    .registerSystem(MatDragSystem)
    .registerSystem(ReadingFlowSystem)
    .registerSystem(MeaningSystem)
    .registerSystem(CardInteractionSystem)
    .registerSystem(LandingSystem);

  if (import.meta.env.DEV) {
    // Handle for automated checks in the IWSDK emulator. Not present in production builds.
    (window as unknown as { __arcana: unknown }).__arcana = {
      app,
      world,
      placement: world.getSystem(PlacementSystem),
      flow: world.getSystem(ReadingFlowSystem),
      meaning: world.getSystem(MeaningSystem),
      panels: panelRegistry,
      Raycaster,
    };
  }
});
