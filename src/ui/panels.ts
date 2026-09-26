/**
 * Helpers shared by every in-world panel: creation from a theme template,
 * showing and hiding (which also switches off hand and ray input), and
 * wiring button clicks.
 */

import {
  PanelDocument,
  PanelUI,
  PokeInteractable,
  RayInteractable,
  type Entity,
  type UIKitDocument,
  type World,
} from '@iwsdk/core';
import { app } from '../app/context.js';
import { UiPanel } from '../components/ui.js';
import { themedPanelUrl } from './themedPanel.js';

export interface PanelOptions {
  kind: string;
  template: string;
  parent?: Entity;
  slot?: number;
  name?: string;
  /** Uniform size multiplier for the whole panel. */
  scale?: number;
}

/** Live panels by key ("placement", "menu", "meaning-0", ...), for dev tooling and tests. */
export const panelRegistry = new Map<string, Entity>();

/** Create a panel entity. Its document loads asynchronously; see `panelDocument`. */
export function createPanel(world: World, options: PanelOptions): Entity {
  const entity = world.createTransformEntity(undefined, options.parent ?? { persistent: true });
  entity.object3D!.name = options.name ?? `${options.kind}Panel`;
  entity.object3D!.scale.setScalar(options.scale ?? 1);
  entity.addComponent(UiPanel, { kind: options.kind, slot: options.slot ?? -1 });
  entity.addComponent(PanelUI, {
    config: themedPanelUrl(options.kind, options.template, app.theme),
  });
  setPanelActive(entity, false);
  panelRegistry.set(options.slot === undefined ? options.kind : `${options.kind}-${options.slot}`, entity);
  return entity;
}

/** The loaded UIKit document, once PanelUI has finished loading it. */
export function panelDocument(entity: Entity): UIKitDocument | null {
  if (!entity.hasComponent(PanelDocument)) return null;
  return entity.getValue(PanelDocument, 'document') as UIKitDocument;
}

/**
 * Show or hide a panel. Hidden panels also stop taking ray and poke input.
 * Pass `poke: false` for panels that sit near things you grab: a fingertip
 * near a pokeable panel takes over the hand's input and blocks grabbing.
 */
export function setPanelActive(entity: Entity, active: boolean, options: { poke?: boolean } = {}): void {
  entity.object3D!.visible = active;
  if (active) {
    if (!entity.hasComponent(RayInteractable)) entity.addComponent(RayInteractable);
    const poke = options.poke ?? true;
    if (poke && !entity.hasComponent(PokeInteractable)) entity.addComponent(PokeInteractable);
    if (!poke && entity.hasComponent(PokeInteractable)) entity.removeComponent(PokeInteractable);
  } else {
    if (entity.hasComponent(RayInteractable)) entity.removeComponent(RayInteractable);
    if (entity.hasComponent(PokeInteractable)) entity.removeComponent(PokeInteractable);
  }
}

/** Attach click handlers by element id. Returns one cleanup function for all of them. */
export function bindClicks(
  document: UIKitDocument,
  handlers: Record<string, () => void>,
): () => void {
  const cleanups: (() => void)[] = [];
  for (const [id, handler] of Object.entries(handlers)) {
    const element = document.getElementById(id);
    if (!element) {
      console.warn(`[arcana] panel has no element #${id}`);
      continue;
    }
    element.name = id;
    const listener = () => handler();
    element.addEventListener('click', listener);
    cleanups.push(() => element.removeEventListener('click', listener));
  }
  return () => cleanups.forEach((cleanup) => cleanup());
}

/** Replace the text of an element, if it exists. */
export function setText(document: UIKitDocument, id: string, text: string): void {
  document.getElementById(id)?.setProperties({ text } as never);
}
