import { createSystem, IBLGradient, type Entity } from '@iwsdk/core';
import { app } from '../app/context.js';

/** Applies the active theme's light gradient to the level's image-based lighting. */
export class ThemeLightingSystem extends createSystem({}) {
  init(): void {
    this.cleanupFuncs.push(this.world.activeLevel.subscribe((level) => this.apply(level)));
  }

  private apply(level: Entity | undefined): void {
    if (!level?.hasComponent(IBLGradient)) return;
    const { lighting } = app.theme.theme;
    level.getVectorView(IBLGradient, 'sky').set(lighting.sky);
    level.getVectorView(IBLGradient, 'equator').set(lighting.equator);
    level.getVectorView(IBLGradient, 'ground').set(lighting.ground);
    level.setValue(IBLGradient, 'intensity', lighting.intensity);
    level.setValue(IBLGradient, '_needsUpdate', true);
  }
}
