/**
 * Mesh builders for the physical objects on the table: the mat, cards, and the
 * deck pile. Pure Three.js, no ECS, so systems stay about behavior. All sizes
 * come from config and the active deck; all colors come from the active theme.
 */

import {
  AssetManager,
  Color,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
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

/** Corner radius of a card as a fraction of its width (physical tarot cards have rounded corners). */
const CARD_CORNER = 0.045;

/** A flat rounded rectangle whose UVs span 0-1 across it, so a card image maps edge to edge. */
function roundedPanelGeometry(width: number, height: number, radius: number): ShapeGeometry {
  const geometry = new ShapeGeometry(roundedRect(width, height, radius), 8);
  const position = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < position.count; i++) {
    uv.setXY(i, position.getX(i) / width + 0.5, position.getY(i) / height + 0.5);
  }
  uv.needsUpdate = true;
  return geometry;
}

/** A rounded slab of the given thickness, rising from y = 0. */
function roundedSlab(width: number, height: number, radius: number, thickness: number): Mesh {
  const geometry = new ExtrudeGeometry(roundedRect(width, height, radius), {
    depth: thickness,
    bevelEnabled: false,
    curveSegments: 8,
  });
  const slab = new Mesh(geometry);
  slab.rotation.x = -Math.PI / 2;
  return slab;
}

/**
 * One card. The hierarchy is:
 *   root  - sits on the mat; rotation.y = PI for a reversed card
 *   pivot - rotation.z = PI when face down, 0 when face up (flip animates this)
 *     face, back, edge
 *   glow  - highlight halo under the card, stays flat on the mat
 * The face is authored face-up with the image top pointing away from the
 * reader (-Z), so an upright card reads correctly once flipped.
 */
export interface CardVisual {
  root: Object3D;
  pivot: Object3D;
  face: Mesh<ShapeGeometry, MeshStandardMaterial>;
  glow: Mesh<ShapeGeometry, MeshBasicMaterial>;
}

/** Geometry shared by every card of one size. */
export interface CardGeometry {
  panel: ShapeGeometry;
  edge: ExtrudeGeometry;
  glow: ShapeGeometry;
}

export function buildCardGeometry(widthM: number, heightM: number): CardGeometry {
  const r = widthM * CARD_CORNER;
  const halo = 0.006;
  return {
    panel: roundedPanelGeometry(widthM, heightM, r),
    edge: roundedSlab(widthM * 0.998, heightM * 0.998, r, config.card.thicknessM)
      .geometry as ExtrudeGeometry,
    glow: roundedPanelGeometry(widthM + halo * 2, heightM + halo * 2, r + halo),
  };
}

export function buildCard(materials: CardMaterials, geometry: CardGeometry): CardVisual {
  const t = config.card.thicknessM;
  const root = new Group();
  const pivot = new Group();
  pivot.rotation.z = Math.PI;
  pivot.position.y = t / 2;
  root.add(pivot);

  const face = new Mesh(
    geometry.panel,
    new MeshStandardMaterial({ color: 0xffffff, roughness: 0.65 }),
  );
  face.rotation.x = -Math.PI / 2;
  face.position.y = t / 2 + 0.0001;
  face.name = 'CardFace';

  const back = new Mesh(geometry.panel, materials.back);
  back.rotation.x = Math.PI / 2;
  back.position.y = -(t / 2 + 0.0001);
  back.name = 'CardBack';

  const edge = new Mesh(geometry.edge, materials.edge);
  edge.rotation.x = -Math.PI / 2;
  edge.position.y = -t / 2;
  edge.name = 'CardEdge';

  const glow = new Mesh(geometry.glow, materials.glow.clone());
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.0002;
  glow.renderOrder = -1;
  glow.name = 'CardGlow';

  pivot.add(face, back, edge);
  root.add(glow);
  return { root, pivot, face, glow };
}

/** The face-down deck: a short rounded stack with the card back on top. */
export function buildDeckPile(
  materials: CardMaterials,
  widthM: number,
  heightM: number,
  cardCount: number,
): Object3D {
  const r = widthM * CARD_CORNER;
  const stackHeight = Math.max(cardCount, 1) * config.card.thicknessM * 0.28;
  const group = new Group();
  group.name = 'DeckPile';

  const sides = roundedSlab(widthM, heightM, r, stackHeight);
  sides.material = materials.edge;
  sides.name = 'DeckPileSides';

  const top = new Mesh(roundedPanelGeometry(widthM, heightM, r), materials.back);
  top.rotation.x = -Math.PI / 2;
  top.position.y = stackHeight + 0.0001;
  top.name = 'DeckPileTop';

  group.add(sides, top);
  return group;
}
