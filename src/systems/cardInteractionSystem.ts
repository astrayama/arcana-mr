import {
  BoxGeometry,
  createSystem,
  Grabbed,
  GrabSystem,
  Hovered,
  Mesh,
  MeshBasicMaterial,
  OneHandGrabbable,
  PokeInteractable,
  Pressed,
  RayInteractable,
  type Entity,
} from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { CardGrabProxy, TarotCard } from '../components/tarotCard.js';
import { ease, Tweens } from '../lib/tween.js';
import { MeaningSystem } from './meaningSystem.js';
import { ReadingFlowSystem, type DealtCard } from './readingFlowSystem.js';

const FLIP_SECONDS = 0.6;
const FLIP_LIFT_M = 0.05;
/** How quickly hover feedback eases in and out (per second). */
const HOVER_RATE = 12;
/** Glow on the card whose meaning is showing, as a share of the hover glow. */
const FOCUS_GLOW = 0.45;
/** Extra reach around a card for near grabs, in meters. */
const GRAB_MARGIN_M = 0.012;

interface CardFeel {
  hover: number;
  flipLift: number;
  proxy: Entity | null;
}

/**
 * Lets the reader turn cards over with whatever they have:
 *   - a controller ray and trigger, or a hand ray and pinch (RayInteractable)
 *   - a fingertip tap (PokeInteractable)
 *   - reaching out and grabbing the card with a hand or grip (OneHandGrabbable
 *     on an invisible proxy, since IWSDK grabbables deliberately ignore rays)
 * Hovering lifts the card slightly and lights a halo in the theme's highlight.
 */
export class CardInteractionSystem extends createSystem({
  cards: { required: [TarotCard] },
  pressed: { required: [TarotCard, Pressed] },
  grabbedProxies: { required: [CardGrabProxy, Grabbed] },
}) {
  private readonly tweens = new Tweens();
  private readonly feel = new Map<Entity, CardFeel>();
  private readonly baseY = config.card.thicknessM / 2;
  private flow!: ReadingFlowSystem;
  private meaning!: MeaningSystem;
  private proxyGeometry!: BoxGeometry;
  private proxyMaterial!: MeshBasicMaterial;

  init(): void {
    this.flow = this.world.getSystem(ReadingFlowSystem)!;
    this.meaning = this.world.getSystem(MeaningSystem)!;
    this.proxyGeometry = new BoxGeometry(
      config.card.widthM + GRAB_MARGIN_M * 2,
      GRAB_MARGIN_M * 2,
      app.cardHeightM + GRAB_MARGIN_M * 2,
    );
    // Invisible but still hit-testable: raycasts ignore material visibility.
    this.proxyMaterial = new MeshBasicMaterial({ visible: false });

    this.cleanupFuncs.push(
      this.queries.cards.subscribe('qualify', (entity) => this.makeInteractive(entity)),
      this.queries.cards.subscribe('disqualify', (entity) => {
        this.removeProxy(entity);
        this.feel.delete(entity);
      }),
      this.queries.pressed.subscribe('qualify', (entity) => this.flip(entity)),
      this.queries.grabbedProxies.subscribe('qualify', (proxy) => {
        this.world.getSystem(GrabSystem)?.forceRelease(proxy);
        const slot = proxy.getValue(CardGrabProxy, 'slot') ?? -1;
        const card = this.flow.dealt[slot];
        if (card) this.flip(card.entity);
      }),
      () => {
        this.proxyGeometry.dispose();
        this.proxyMaterial.dispose();
      },
    );
  }

  update(delta: number): void {
    this.tweens.update(delta);
    const { hoverLiftM, intensity } = app.theme.theme.cardHighlight;
    const live = app.machine.state === 'AWAITING_FLIPS' || app.machine.state === 'REVEALED';
    const step = Math.min(1, delta * HOVER_RATE);
    for (const entity of this.queries.cards.entities) {
      const card = this.dealtFor(entity);
      const feel = this.feel.get(entity);
      if (!card || !feel) continue;
      const target = live && entity.hasComponent(Hovered) ? 1 : 0;
      feel.hover += (target - feel.hover) * step;
      const focused = live && this.meaning.focusedSlot === card.slot ? FOCUS_GLOW : 0;
      card.visual.pivot.position.y = this.baseY + feel.hover * hoverLiftM + feel.flipLift;
      card.visual.glow.material.opacity = Math.max(feel.hover, focused) * intensity;
    }
  }

  private makeInteractive(entity: Entity): void {
    entity.addComponent(RayInteractable);
    entity.addComponent(PokeInteractable);
    const proxyMesh = new Mesh(this.proxyGeometry, this.proxyMaterial);
    proxyMesh.name = `CardGrab-${entity.getValue(TarotCard, 'slot')}`;
    proxyMesh.position.y = config.card.thicknessM / 2;
    const proxy = this.world.createTransformEntity(proxyMesh, { parent: entity });
    proxy.addComponent(CardGrabProxy, { slot: entity.getValue(TarotCard, 'slot') ?? 0 });
    // Grabbing only turns the card over; it never pulls it off the mat.
    proxy.addComponent(OneHandGrabbable, { translate: false, rotate: false });
    this.feel.set(entity, { hover: 0, flipLift: 0, proxy });
  }

  private removeProxy(entity: Entity): void {
    const feel = this.feel.get(entity);
    if (!feel?.proxy) return;
    feel.proxy.object3D?.removeFromParent();
    feel.proxy.destroy();
    feel.proxy = null;
  }

  private dealtFor(entity: Entity): DealtCard | undefined {
    const slot = entity.getValue(TarotCard, 'slot') ?? -1;
    const card = this.flow.dealt[slot];
    return card?.entity === entity ? card : undefined;
  }

  private flip(entity: Entity): void {
    if (entity.getValue(TarotCard, 'faceUp')) return;
    const slot = entity.getValue(TarotCard, 'slot') ?? -1;
    // The state machine is the gatekeeper: it ignores flips outside AWAITING_FLIPS.
    if (!app.machine.send({ type: 'FLIP', slot })) return;
    entity.setValue(TarotCard, 'faceUp', true);
    this.removeProxy(entity);

    const card = this.dealtFor(entity);
    const feel = this.feel.get(entity);
    if (!card || !feel) return;
    const pivot = card.visual.pivot;
    this.tweens.add({
      duration: FLIP_SECONDS,
      easing: ease.inOutCubic,
      onUpdate: (k) => {
        pivot.rotation.z = Math.PI * (1 - k);
        feel.flipLift = Math.sin(Math.PI * k) * FLIP_LIFT_M;
      },
      onDone: () => {
        feel.flipLift = 0;
      },
    });
  }
}
