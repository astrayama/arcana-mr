/**
 * Mesh builders for the physical objects on the table: the mat, cards, and the
 * deck pile. Pure Three.js, no ECS, so systems stay about behavior. All sizes
 * come from config and the active deck; all colors come from the active theme.
 */

import {
  AssetManager,
  BoxGeometry,
  Color,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  RepeatWrapping,
  Shape,
  ShapeGeometry,
  SRGBColorSpace,
  type Texture,
} from '@iwsdk/core';
import { config } from '../config.js';
import type { ResolvedDeck } from '../decks/registry.js';
import type { ResolvedTheme } from '../themes/registry.js';

function roundedRect(width: number, depth: number, radius: number): Shape {
  const x = -width / 2;
  const y = -depth / 2;
  const r = Math.min(radius, width / 2, depth / 2);
  const shape = new Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + depth - r);
  shape.quadraticCurveTo(x + width, y + depth, x + width - r, y + depth);
  shape.lineTo(x + r, y + depth);
  shape.quadraticCurveTo(x, y + depth, x, y + depth - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

/** Load a texture through IWSDK's asset manager with color-correct settings. */
export async function loadColorTexture(url: string): Promise<Texture> {
  const texture = await AssetManager.loadTexture(url, url);
  texture.colorSpace = SRGBColorSpace;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  return texture;
}

/** Height of the cloth's top surface above the mat origin. Things resting on the mat sit here. */
export const MAT_SURFACE_Y = 0.001;

/** The reading mat: a soft rounded cloth with a thin trim, lying flat at y = 0. */
export function buildMat(resolved: ResolvedTheme): Object3D {
  const { mat } = resolved.theme;
  const { matWidthM, matDepthM } = config.layout;
  const group = new Group();
  group.name = 'ReadingMat';

  const trim = new Mesh(
    new ShapeGeometry(roundedRect(matWidthM + 0.012, matDepthM + 0.012, 0.03), 6),
    new MeshStandardMaterial({ color: new Color(mat.edgeColor), roughness: 0.5, metalness: 0.6 }),
  );
  trim.rotation.x = -Math.PI / 2;
  trim.name = 'MatTrim';

  const clothMaterial = new MeshStandardMaterial({
    color: new Color(mat.color),
    roughness: mat.roughness,
  });
  const cloth = new Mesh(
    new ShapeGeometry(roundedRect(matWidthM, matDepthM, 0.025), 6),
    clothMaterial,
  );
  cloth.rotation.x = -Math.PI / 2;
  cloth.position.y = MAT_SURFACE_Y;
  cloth.name = 'MatCloth';

  const textureUrl = resolved.assetUrl(mat.texture);
  if (textureUrl) {
    loadColorTexture(textureUrl).then((texture) => {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      // ShapeGeometry UVs are in meters; scale so the texture repeats N times across the width.
      const perMeter = mat.textureRepeat / matWidthM;
      texture.repeat.set(perMeter, perMeter);
      clothMaterial.map = texture;
      clothMaterial.needsUpdate = true;
    });
  }

  group.add(trim, cloth);
  return group;
}

/** Shared card-back and card-edge materials for the active deck and theme. */
export interface CardMaterials {
  back: MeshStandardMaterial;
  edge: MeshStandardMaterial;
  glow: MeshBasicMaterial;
}

export function buildCardMaterials(deck: ResolvedDeck, resolved: ResolvedTheme): CardMaterials {
  const back = new MeshStandardMaterial({
    // Placeholder tint until the back texture arrives (or if a deck has none).
    color: new Color(resolved.theme.colors.panelBackground),
    roughness: 0.7,
  });
  if (deck.backUrl) {
    loadColorTexture(deck.backUrl).then((texture) => {
      back.map = texture;
      back.color.set(0xffffff);
      back.needsUpdate = true;
    });
  }
  return {
    back,
    edge: new MeshStandardMaterial({ color: 0xefe6d2, roughness: 0.8 }),
    glow: new MeshBasicMaterial({
      color: new Color(resolved.theme.cardHighlight.color),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
    }),
  };
}

/**
 * One card. The hierarchy is:
 *   root  - sits on the mat; rotation.y = PI for a reversed card
 *   pivot - rotation.z = PI when face down, 0 when face up (flip animates this)
 *     face, back, edge, glow
 * The face plane is authored face-up with the image top pointing away from
 * the reader (-Z), so an upright card reads correctly once flipped.
 */
export interface CardVisual {
  root: Object3D;
  pivot: Object3D;
  face: Mesh<PlaneGeometry, MeshStandardMaterial>;
  glow: Mesh<PlaneGeometry, MeshBasicMaterial>;
}

export function buildCard(
  materials: CardMaterials,
  widthM: number,
  heightM: number,
): CardVisual {
  const t = config.card.thicknessM;
  const root = new Group();
  const pivot = new Group();
  pivot.rotation.z = Math.PI;
  pivot.position.y = t / 2;
  root.add(pivot);

  const plane = new PlaneGeometry(widthM, heightM);

  const face = new Mesh(
    plane,
    new MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 }),
  );
  face.rotation.x = -Math.PI / 2;
  face.position.y = t / 2 + 0.0001;
  face.name = 'CardFace';

  const back = new Mesh(plane, materials.back);
  back.rotation.x = Math.PI / 2;
  back.position.y = -(t / 2 + 0.0001);
  back.name = 'CardBack';

  const edge = new Mesh(new BoxGeometry(widthM * 0.998, t, heightM * 0.998), materials.edge);
  edge.name = 'CardEdge';

  const glow = new Mesh(
    new PlaneGeometry(widthM + 0.012, heightM + 0.012),
    materials.glow.clone(),
  );
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = -t / 2 - 0.0004;
  glow.name = 'CardGlow';

  pivot.add(face, back, edge);
  root.add(glow);
  return { root, pivot, face, glow };
}

/** The face-down deck: a short stack with the card back on top. */
export function buildDeckPile(
  materials: CardMaterials,
  widthM: number,
  heightM: number,
  cardCount: number,
): Object3D {
  const stackHeight = Math.max(cardCount, 1) * config.card.thicknessM * 0.35;
  const mats = [
    materials.edge,
    materials.edge,
    materials.back, // +Y: the top of the stack
    materials.edge,
    materials.edge,
    materials.edge,
  ];
  const pile = new Mesh(new BoxGeometry(widthM, stackHeight, heightM), mats);
  pile.position.y = stackHeight / 2;
  pile.name = 'DeckPileMesh';
  const group = new Group();
  group.name = 'DeckPile';
  group.add(pile);
  return group;
}
