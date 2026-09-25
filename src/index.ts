import { World } from '@iwsdk/core';
import projectOptions from 'virtual:iwsdk-project';
import { LandingSystem } from './systems/landingSystem.js';
import { PlacementSystem } from './systems/placementSystem.js';
import { ReadingStatusSystem } from './systems/readingStatusSystem.js';
import { TableSystem } from './systems/tableSystem.js';
import { ThemeLightingSystem } from './systems/themeLightingSystem.js';

World.create(
  document.getElementById('scene-container') as HTMLDivElement,
  projectOptions,
).then((world) => {
  world
    .registerSystem(ReadingStatusSystem)
    .registerSystem(ThemeLightingSystem)
    .registerSystem(TableSystem)
    .registerSystem(PlacementSystem)
    .registerSystem(LandingSystem);
});
