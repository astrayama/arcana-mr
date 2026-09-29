/**
 * Mesh builders for the physical objects on the table: the mat, cards, and the
 * deck pile. Pure Three.js, no ECS, so systems stay about behavior. All sizes
 * come from config and the active deck; all colors come from the active theme.
 */

import {
  AssetManager,
  CanvasTexture,
  Color,
  DoubleSide,
  ExtrudeGeometry,
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
import type { ResolvedTheme } from '../themes/registry.js';
import { MAT_SURFACE_Y } from './layout.js';

function roundedRect(width: number, depth: number, radius: number, cx = 0, cy = 0): Shape {
  const x = cx - width / 2;
  const y = cy - depth / 2;
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

export { MAT_SURFACE_Y } from './layout.js';

/** The mat's outline in mat-local meters. */
export interface MatBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

const INLAY_INSET = 0.028;
const INLAY_LINE = 0.0022;

/**
 * The mat's shapes for the given extents. Shapes are drawn in the XY plane
 * and laid flat, so shape y is -z. UVs are in meters from the mat origin, so
 * the cloth's weave stays still while the mat grows.
 */
function matGeometries(b: MatBounds): { trim: ShapeGeometry; cloth: ShapeGeometry; inlay: ShapeGeometry } {
  const w = b.maxX - b.minX;
  const d = b.maxZ - b.minZ;
  const cx = (b.minX + b.maxX) / 2;
  const cy = -(b.minZ + b.maxZ) / 2;
  const ring = roundedRect(w - INLAY_INSET * 2, d - INLAY_INSET * 2, 0.018, cx, cy);
  ring.holes.push(roundedRect(w - (INLAY_INSET + INLAY_LINE) * 2, d - (INLAY_INSET + INLAY_LINE) * 2, 0.016, cx, cy));
  return {
    trim: new ShapeGeometry(roundedRect(w + 0.012, d + 0.012, 0.03, cx, cy), 6),
    cloth: new ShapeGeometry(roundedRect(w, d, 0.025, cx, cy), 6),
    inlay: new ShapeGeometry(ring, 6),
  };
}

/** The reading mat: a soft rounded cloth with a thin trim, lying flat at y = 0. */
export function buildMat(resolved: ResolvedTheme, bounds: MatBounds): Object3D {
  const { mat } = resolved.theme;
  const group = new Group();
  group.name = 'ReadingMat';
  const shapes = matGeometries(bounds);

  const trim = new Mesh(
    shapes.trim,
    new MeshStandardMaterial({ color: new Color(mat.edgeColor), roughness: 0.5, metalness: 0.6 }),
  );
  trim.rotation.x = -Math.PI / 2;
  trim.name = 'MatTrim';

  const clothMaterial = new MeshStandardMaterial({
    color: new Color(mat.color),
    roughness: mat.roughness,
  });
  const cloth = new Mesh(shapes.cloth, clothMaterial);
  cloth.rotation.x = -Math.PI / 2;
  cloth.position.y = MAT_SURFACE_Y;
  cloth.name = 'MatCloth';

  const textureUrl = resolved.assetUrl(mat.texture);
  if (textureUrl) {
    loadColorTexture(textureUrl).then((texture) => {
      texture.wrapS = RepeatWrapping;
      texture.wrapT = RepeatWrapping;
      // ShapeGeometry UVs are in meters; repeat N times across the everyday
      // mat's width, and keep that density when the mat grows.
      const perMeter = mat.textureRepeat / config.layout.matWidthM;
      texture.repeat.set(perMeter, perMeter);
      clothMaterial.map = texture;
      clothMaterial.needsUpdate = true;
    });
  }

  group.add(trim, cloth);

  // A thin border line set in from the edge, like a reading cloth.
  const inlay = new Mesh(
    shapes.inlay,
    new MeshStandardMaterial({ color: new Color(mat.edgeColor), roughness: 0.45, metalness: 0.6 }),
  );
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = MAT_SURFACE_Y + 0.0002;
  inlay.name = 'MatInlay';
  inlay.visible = mat.inlay;
  group.add(inlay);
  return group;
}

/** Reshape the mat in place (same objects, new outlines), freeing the old shapes. */
export function resizeMat(mat: Object3D, bounds: MatBounds): void {
  const shapes = matGeometries(bounds);
  for (const [name, geometry] of [
    ['MatTrim', shapes.trim],
    ['MatCloth', shapes.cloth],
    ['MatInlay', shapes.inlay],
  ] as const) {
    const mesh = mat.getObjectByName(name) as Mesh | undefined;
    if (!mesh) {
      geometry.dispose();
      continue;
    }
    mesh.geometry.dispose();
    mesh.geometry = geometry;
  }
}

/** Shared card-back and card-edge materials for the active deck and theme. */
export interface CardMaterials {
  back: MeshStandardMaterial;
  edge: MeshStandardMaterial;
  glow: MeshBasicMaterial;
}

/** A soft rounded-rectangle falloff used as the glow's alpha, so the halo fades out gently. */
function makeGlowAlpha(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 200;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.filter = 'blur(9px)';
  ctx.fillStyle = '#fff';
  const pad = 22;
  ctx.beginPath();
  ctx.roundRect(pad, pad, canvas.width - pad * 2, canvas.height - pad * 2, 10);
  ctx.fill();
  return new CanvasTexture(canvas);
}

/**
 * Shared card materials. The back starts as a plain tint; the table applies
 * the chosen back image with `applyCardBack`.
 */
export function buildCardMaterials(resolved: ResolvedTheme): CardMaterials {
  const back = new MeshStandardMaterial({
    // Placeholder tint until the back texture arrives (or if a deck has none).
    color: new Color(resolved.theme.colors.panelBackground),
    roughness: 0.7,
  });
  return {
    back,
    edge: new MeshStandardMaterial({ color: 0xefe6d2, roughness: 0.8 }),
    glow: new MeshBasicMaterial({
      color: new Color(resolved.theme.cardHighlight.color),
      alphaMap: makeGlowAlpha(),
      transparent: true,
      opacity: 0,
      depthWrite: false,
      side: DoubleSide,
    }),
  };
}

/**
 * Put a back image on the shared back material, cropped to fill cards of
 * `cardAspect` (width / height) without stretching. Every card, the deck,
 * and the riffle cards share this material, so they all change at once.
 */
export function applyCardBack(material: MeshStandardMaterial, source: Texture, imageAspect: number, cardAspect: number): void {
  // A clone has its own crop, so the cached original stays untouched.
  const map = source.clone();
  map.repeat.set(1, 1);
  map.offset.set(0, 0);
  if (imageAspect > cardAspect) {
    map.repeat.x = cardAspect / imageAspect;
    map.offset.x = (1 - map.repeat.x) / 2;
  } else if (imageAspect < cardAspect) {
    map.repeat.y = imageAspect / cardAspect;
    map.offset.y = (1 - map.repeat.y) / 2;
  }
  map.needsUpdate = true;
  const previous = material.map;
  material.map = map;
  material.color.set(0xffffff);
  material.needsUpdate = true;
  if (previous && previous !== source) previous.dispose();
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
  // The glow plane extends past the card; its alpha map fades to nothing at the edge.
  const halo = 0.02;
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

/** Height of the deck pile for a deck of `cardCount` cards. */
export function deckStackHeight(cardCount: number): number {
  return Math.max(cardCount, 1) * config.card.thicknessM * 0.28;
}

/** The face-down deck: a short rounded stack with the card back on top. */
export function buildDeckPile(
  materials: CardMaterials,
  widthM: number,
  heightM: number,
  cardCount: number,
): Object3D {
  const r = widthM * CARD_CORNER;
  const stackHeight = deckStackHeight(cardCount);
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

/**
 * An open spot in the spread: a faint card-shaped outline in the trim color.
 * Its name is set into the cloth separately (see `buildSpotName`), because
 * one name can serve two cards (the Celtic Cross crossing card).
 */
export interface SlotOutline {
  root: Group;
  outline: MeshBasicMaterial;
}

export function buildSlotOutline(resolved: ResolvedTheme, widthM: number, heightM: number): SlotOutline {
  const root = new Group();
  root.name = 'SlotMarker';
  const r = widthM * CARD_CORNER;
  const ring = roundedRect(widthM + 0.008, heightM + 0.008, r + 0.004);
  ring.holes.push(roundedRect(widthM + 0.002, heightM + 0.002, r + 0.001));
  const outline = new MeshBasicMaterial({
    color: new Color(resolved.theme.mat.edgeColor),
    transparent: true,
    opacity: 0.45,
    depthWrite: false,
  });
  const outlineMesh = new Mesh(new ShapeGeometry(ring, 8), outline);
  outlineMesh.rotation.x = -Math.PI / 2;
  outlineMesh.position.y = 0.0004;
  root.add(outlineMesh);
  return { root, outline };
}

/** Letter-spaced capitals fitted to the canvas, on one line or wrapped onto two. */
function spotNameTexture(text: string, color: string, aspect: number): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.max(64, Math.round(512 / aspect));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const spaced = (t: string) => t.toUpperCase().split('').join(String.fromCharCode(8202, 8202));
  const maxWidth = canvas.width * 0.94;
  const words = text.split(' ');
  // Try one line, then the best two-line split, shrinking the type until it fits.
  const layouts: string[][] = [[text]];
  for (let i = 1; i < words.length; i++) layouts.push([words.slice(0, i).join(' '), words.slice(i).join(' ')]);
  let best = { lines: [text], size: 8 };
  for (const lines of layouts) {
    let size = Math.min(58, (canvas.height * 0.8) / lines.length);
    while (size > 8) {
      ctx.font = `600 ${size}px Georgia, "Times New Roman", serif`;
      if (lines.every((line) => ctx.measureText(spaced(line)).width <= maxWidth)) break;
      size -= 2;
    }
    if (size > best.size) best = { lines, size };
  }
  ctx.font = `600 ${best.size}px Georgia, "Times New Roman", serif`;
  const lineHeight = best.size * 1.1;
  best.lines.forEach((line, i) => {
    const y = canvas.height / 2 + (i - (best.lines.length - 1) / 2) * lineHeight;
    ctx.fillText(spaced(line), canvas.width / 2, y);
  });
  return new CanvasTexture(canvas);
}

/** A spot's name set into the cloth, filling a `widthM` x `depthM` area. */
export function buildSpotName(
  resolved: ResolvedTheme,
  text: string,
  widthM: number,
  depthM: number,
): { mesh: Mesh; material: MeshBasicMaterial } {
  const material = new MeshBasicMaterial({
    map: spotNameTexture(text, resolved.theme.mat.edgeColor, widthM / depthM),
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });
  const mesh = new Mesh(new PlaneGeometry(widthM, depthM), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.name = 'SpotName';
  return { mesh, material };
}

/** A halo under the deck pile, lit when a hand could pick the deck up or a tap would do something. */
export function buildDeckGlow(materials: CardMaterials, geometry: CardGeometry): Mesh<ShapeGeometry, MeshBasicMaterial> {
  const glow = new Mesh(geometry.glow, materials.glow.clone());
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.0002;
  glow.renderOrder = -1;
  glow.name = 'DeckGlow';
  return glow;
}
