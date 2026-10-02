/**
 * The fairy circle: a mossy forest clearing at golden hour. The table stands
 * inside a ring of flat pebbles, with a ring of mushrooms just beyond it,
 * moss, ferns, grass and small flowers around, and low-poly pines and
 * broadleaf trees fading into soft haze. Light falls in a few slanting shafts
 * and pollen drifts in the air. Everything is generated here, instanced into
 * about twenty draw calls.
 */

import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DirectionalLight,
  DoubleSide,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Object3D,
  PlaneGeometry,
  Points,
  PointsMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Material,
} from '@iwsdk/core';
import type { ResolvedTheme } from '../themes/registry.js';
import type { FairyCircleEnvironment } from './environment.schema.js';
import type { EnvironmentAssets, EnvironmentInstance } from './types.js';
import { radialTexture, seeded } from './common.js';
import * as parts from './forestParts.js';

const SKY_RADIUS = 40;
const GROUND_RADIUS = 28;
/** Inside this the ground is perfectly flat and clear: the reader, the table, the circle. */
const CLEARING_M = 2.6;
const UP = new Vector3(0, 1, 0);

/** Gentle rolling ground outside the clearing, rising toward the far trees. */
function heightAt(x: number, z: number): number {
  const r = Math.hypot(x, z);
  if (r <= CLEARING_M) return 0;
  const k = Math.min(1, (r - CLEARING_M) / 4);
  const ease = k * k * (3 - 2 * k);
  const roll = 0.18 * Math.sin(x * 0.7 + 1.3) * Math.cos(z * 0.55 - 0.4) + 0.1 * Math.sin(x * 1.6 - z * 1.2);
  const rise = r > 11 ? (r - 11) * 0.12 : 0;
  return ease * (roll + 0.12) + rise;
}

/** Patches of bare soil among the moss. */
const soilAt = (x: number, z: number) => Math.sin(x * 1.3 + z * 0.4) * Math.cos(z * 1.1 - x * 0.3) > 0.55;

function buildSky(env: FairyCircleEnvironment): Mesh {
  const geometry = new SphereGeometry(SKY_RADIUS, 32, 16);
  const top = new Color(env.sky.top);
  const horizon = new Color(env.sky.horizon);
  const bottom = new Color(env.sky.bottom);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  const c = new Color();
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    const y = geometry.attributes.position.getY(i) / SKY_RADIUS;
    if (y >= 0) c.lerpColors(horizon, top, Math.pow(y, 0.7));
    else c.lerpColors(horizon, bottom, Math.min(1, -y * 5));
    c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const sky = new Mesh(geometry, new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }));
  sky.renderOrder = -100;
  sky.name = 'ForestSky';
  return sky;
}

/** The forest floor: rings of faceted ground, mossy near the circle and darker toward the trees. */
function buildGround(env: FairyCircleEnvironment): BufferGeometry {
  const radii: number[] = [0];
  for (let r = 0.6; r < GROUND_RADIUS; r += Math.max(0.6, r * 0.18)) radii.push(r);
  radii.push(GROUND_RADIUS);
  const segments = 64;
  const moss = new Color(env.ground.moss);
  const floor = new Color(env.ground.floor);
  const soil = new Color(env.ground.soil);
  const vertex = (r: number, i: number, out: number[], colors: number[]) => {
    const a = (i / segments) * Math.PI * 2;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    out.push(x, heightAt(x, z), z);
    const k = Math.min(1, Math.max(0, (r - 2) / 7));
    const c = moss.clone().lerp(floor, k * k);
    if (r > CLEARING_M + 0.3 && soilAt(x, z)) c.lerp(soil, 0.65);
    // A slightly brighter, softer moss inside the circle.
    if (r < env.pebbles.ringRadiusM) c.offsetHSL(0, 0.02, 0.03);
    c.offsetHSL(0, 0, Math.sin(x * 3.1 + z * 2.3) * 0.015);
    colors.push(c.r, c.g, c.b);
  };
  const positions: number[] = [];
  const colors: number[] = [];
  for (let ring = 0; ring < radii.length - 1; ring++) {
    for (let i = 0; i < segments; i++) {
      const tri = (pts: [number, number][]) => {
        for (const [r, j] of pts) vertex(r, j, positions, colors);
      };
      const r0 = radii[ring];
      const r1 = radii[ring + 1];
      tri([[r0, i], [r1, i + 1], [r1, i]]);
      if (r0 > 0) tri([[r0, i], [r0, i + 1], [r1, i + 1]]);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3));
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3));
  g.computeVertexNormals();
  return g;
}

/** A soft vertical beam: bright at the top, fading out at the bottom and the sides. */
function shaftTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 32;
  canvas.height = 128;
  const ctx = canvas.getContext('2d')!;
  const down = ctx.createLinearGradient(0, 0, 0, 128);
  down.addColorStop(0, 'rgba(255,255,255,0.55)');
  down.addColorStop(0.5, 'rgba(255,255,255,0.3)');
  down.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = down;
  ctx.fillRect(0, 0, 32, 128);
  ctx.globalCompositeOperation = 'destination-in';
  const across = ctx.createLinearGradient(0, 0, 32, 0);
  across.addColorStop(0, 'rgba(0,0,0,0)');
  across.addColorStop(0.5, 'rgba(0,0,0,1)');
  across.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = across;
  ctx.fillRect(0, 0, 32, 128);
  return new CanvasTexture(canvas);
}

/** Writes instance transforms and colors without allocating per instance. */
class Placer {
  private readonly matrix = new Matrix4();
  private readonly quat = new Quaternion();
  private readonly tilt = new Quaternion();
  private readonly pos = new Vector3();
  private readonly scale = new Vector3();
  private readonly axis = new Vector3();
  private readonly color = new Color();

  /** Stand an instance on the ground at (x, z), turned `yaw`, leaning up to `lean` radians. */
  stand(mesh: InstancedMesh, i: number, x: number, z: number, yaw: number, sx: number, sy: number, sz: number, lean = 0, lift = 0): void {
    this.quat.setFromAxisAngle(UP, yaw);
    if (lean) {
      this.axis.set(Math.cos(yaw * 1.7), 0, Math.sin(yaw * 1.7));
      this.quat.premultiply(this.tilt.setFromAxisAngle(this.axis, lean));
    }
    this.pos.set(x, heightAt(x, z) + lift, z);
    mesh.setMatrixAt(i, this.matrix.compose(this.pos, this.quat, this.scale.set(sx, sy, sz)));
  }

  /** Put an instance at an exact transform. */
  at(mesh: InstancedMesh, i: number, pos: Vector3, quat: Quaternion, sx: number, sy = sx, sz = sx): void {
    mesh.setMatrixAt(i, this.matrix.compose(pos, quat, this.scale.set(sx, sy, sz)));
  }

  /** Tint an instance: `hex` nudged in lightness and hue by up to `vary`. */
  tint(mesh: InstancedMesh, i: number, hex: string, random: () => number, vary = 0.06): void {
    this.color.set(hex).offsetHSL((random() - 0.5) * vary * 0.4, (random() - 0.5) * vary, (random() - 0.5) * vary * 2);
    mesh.setColorAt(i, this.color);
  }
}

export function buildFairyCircle(env: FairyCircleEnvironment, _assets: EnvironmentAssets, _theme: ResolvedTheme): EnvironmentInstance {
  const random = seeded(77);
  const root = new Group();
  root.name = 'FairyCircle';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(thing: T) => (disposables.push(thing), thing);
  const place = new Placer();
  const standard = (color: string, extra: Partial<ConstructorParameters<typeof MeshStandardMaterial>[0]> = {}) =>
    track(new MeshStandardMaterial({ color: new Color(color), roughness: 0.95, flatShading: true, envMapIntensity: 0.6, ...extra }));
  const instanced = (name: string, geometry: BufferGeometry, material: Material, count: number) => {
    const mesh = new InstancedMesh(track(geometry), material, count);
    mesh.name = name;
    root.add(mesh);
    return mesh;
  };
  const done = (mesh: InstancedMesh, used = mesh.count) => {
    mesh.count = used;
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    mesh.computeBoundingSphere();
  };

  // Sky and ground.
  const sky = buildSky(env);
  track(sky.geometry);
  track(sky.material as MeshBasicMaterial);
  root.add(sky);
  const ground = new Mesh(track(buildGround(env)), standard('#ffffff', { vertexColors: true, roughness: 1 }));
  ground.name = 'ForestFloor';
  root.add(ground);

  // Warm sun slanting through the trees, with sky and moss light from above and below.
  const strength = env.light.intensity;
  const hemi = new HemisphereLight(new Color(env.light.sky), new Color(env.light.ground), 0.55 * strength);
  const sun = new DirectionalLight(new Color(env.light.sun), 0.95 * strength);
  const sunDir = new Vector3(-0.55, 0.62, -0.56).normalize();
  sun.position.copy(sunDir).multiplyScalar(20);
  const sunTarget = new Object3D();
  sun.target = sunTarget;
  root.add(hemi, sun, sunTarget);

  // The fairy circle: flat pebbles in a ring around the reading area.
  const ring = env.pebbles.ringRadiusM;
  const pebbleCount = env.pebbles.count;
  const pebbles = instanced('CirclePebbles', parts.pebble(random), standard('#ffffff', { envMapIntensity: 0.8 }), pebbleCount);
  for (let i = 0; i < pebbleCount; i++) {
    const a = (i / pebbleCount) * Math.PI * 2 + (random() - 0.5) * 0.06;
    const r = ring + (random() - 0.5) * 0.08;
    const size = 0.055 + random() * 0.045;
    place.stand(pebbles, i, Math.cos(a) * r, Math.sin(a) * r, a + (random() - 0.5) * 0.6, size, size * (0.8 + random() * 0.5), size, 0.06);
    place.tint(pebbles, i, random() < 0.25 ? '#9aa08c' : env.pebbles.color, random, 0.08);
  }
  done(pebbles);

  // Moss: cushions along the pebbles, and bigger ones out among the trees.
  const mossCount = 46 + 60;
  const moss = instanced('Moss', parts.mossMound(random), standard('#ffffff', { roughness: 1 }), mossCount);
  for (let i = 0; i < mossCount; i++) {
    const nearRing = i < 46;
    const a = random() * Math.PI * 2;
    const r = nearRing ? ring + (random() - 0.5) * 0.35 : CLEARING_M + 0.5 + random() * 8;
    const size = nearRing ? 0.08 + random() * 0.1 : 0.18 + random() * 0.35;
    place.stand(moss, i, Math.cos(a) * r, Math.sin(a) * r, random() * 6, size, size * (0.7 + random() * 0.6), size * (0.8 + random() * 0.4));
    place.tint(moss, i, env.plants.moss, random, 0.1);
  }
  done(moss);

  // Mushrooms: a ring of little clusters just beyond the pebbles, a few out by
  // the trees. Red ones carry white spots; a few small ones glow.
  const mushroomCount = env.mushrooms.count;
  const stems = instanced('MushroomStems', parts.mushroomStem(), standard('#f1e9d8', { roughness: 0.85 }), mushroomCount);
  const caps = instanced('MushroomCaps', parts.mushroomCap(), standard('#ffffff', { roughness: 0.75 }), mushroomCount);
  const glowColor = new Color(env.mushrooms.glow);
  const glowMaterial = track(
    new MeshStandardMaterial({ color: glowColor, emissive: glowColor, emissiveIntensity: 0.9, roughness: 0.6, flatShading: true }),
  );
  const glowCaps = instanced('GlowingCaps', parts.mushroomCap(), glowMaterial, mushroomCount);
  const spots = instanced('CapSpots', parts.capSpot(random), standard(env.mushrooms.spots, { roughness: 0.7 }), mushroomCount * 6);
  let capN = 0;
  let glowN = 0;
  let spotN = 0;
  const base = new Vector3();
  const capPos = new Vector3();
  const quat = new Quaternion();
  const lean = new Quaternion();
  const leanAxis = new Vector3();
  const spotPos = new Vector3();
  const spotQuat = new Quaternion();
  const normal = new Vector3();
  let clusterX = 0;
  let clusterZ = 0;
  let clusterLeft = 0;
  for (let i = 0; i < mushroomCount; i++) {
    if (clusterLeft === 0) {
      const a = random() * Math.PI * 2;
      const r = random() < 0.78 ? ring + 0.22 + random() * 0.25 : CLEARING_M + 0.8 + random() * 5;
      clusterX = Math.cos(a) * r;
      clusterZ = Math.sin(a) * r;
      clusterLeft = 2 + Math.floor(random() * 4);
    }
    clusterLeft--;
    const x = clusterX + (random() - 0.5) * 0.24;
    const z = clusterZ + (random() - 0.5) * 0.24;
    const kind = random();
    const glowing = kind < 0.16;
    const red = !glowing && kind < 0.5;
    const height = glowing ? 0.05 + random() * 0.04 : 0.04 + random() * 0.08;
    const girth = glowing ? 0.045 : 0.06 + random() * 0.05;
    const capR = glowing ? 0.014 + random() * 0.008 : 0.022 + random() * 0.03;
    const yaw = random() * Math.PI * 2;
    leanAxis.set(Math.cos(yaw), 0, Math.sin(yaw));
    lean.setFromAxisAngle(leanAxis, (random() - 0.5) * 0.4);
    quat.setFromAxisAngle(UP, yaw).premultiply(lean);
    base.set(x, heightAt(x, z) - 0.004, z);
    place.at(stems, i, base, quat, girth, height, girth);
    // The cap sits on top of the stem, leaning with it.
    capPos.set(0, height * 0.96, 0).applyQuaternion(quat).add(base);
    if (glowing) {
      place.at(glowCaps, glowN++, capPos, quat, capR, capR * 1.5, capR);
      continue;
    }
    place.at(caps, capN, capPos, quat, capR);
    place.tint(caps, capN++, red ? env.mushrooms.cap : env.mushrooms.brown, random, 0.08);
    if (!red) continue;
    const count = 4 + Math.floor(random() * 3);
    for (let k = 0; k < count; k++) {
      const { p, n } = parts.capSurface(random(), random() * 0.8);
      spotPos.set(p[0], p[1], p[2]).multiplyScalar(capR).applyQuaternion(quat).add(capPos);
      normal.set(n[0], n[1], n[2]).applyQuaternion(quat);
      spotQuat.setFromUnitVectors(UP, normal);
      place.at(spots, spotN++, spotPos, spotQuat, capR * (0.13 + random() * 0.08));
    }
  }
  done(stems);
  done(caps, capN);
  done(glowCaps, glowN);
  done(spots, spotN);

  // Grass, ferns and small flowers, sparse by the circle and thicker toward the trees.
  const plantMaterial = (color: string) => standard(color, { side: DoubleSide, roughness: 0.9 });
  const grassCount = 420;
  const grass = instanced('Grass', parts.grassTuft(random), plantMaterial('#ffffff'), grassCount);
  for (let i = 0; i < grassCount; i++) {
    const a = random() * Math.PI * 2;
    const r = ring + 0.2 + Math.pow(random(), 0.6) * 8;
    const h = 0.12 + random() * 0.2;
    place.stand(grass, i, Math.cos(a) * r, Math.sin(a) * r, random() * 6, h * 0.9, h, h * 0.9);
    place.tint(grass, i, env.plants.grass, random, 0.12);
  }
  done(grass);

  const fernCount = 70;
  const ferns = instanced('Ferns', parts.fern(random), plantMaterial('#ffffff'), fernCount);
  for (let i = 0; i < fernCount; i++) {
    const a = random() * Math.PI * 2;
    const r = CLEARING_M + 0.4 + random() * 8.5;
    const s = 0.28 + random() * 0.35;
    place.stand(ferns, i, Math.cos(a) * r, Math.sin(a) * r, random() * 6, s, s * (0.8 + random() * 0.4), s, 0.08);
    place.tint(ferns, i, env.plants.fern, random, 0.1);
  }
  done(ferns);

  const flowerCount = 90;
  const flowerStems = instanced('FlowerStems', parts.flowerStem(), plantMaterial(env.plants.grass), flowerCount);
  const flowerHeads = instanced('FlowerHeads', parts.flowerHead(), standard('#ffffff', { roughness: 0.7 }), flowerCount);
  const headPos = new Vector3();
  for (let i = 0; i < flowerCount; i++) {
    const a = random() * Math.PI * 2;
    const r = ring + 0.3 + Math.pow(random(), 0.8) * 4.5;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const h = 0.1 + random() * 0.14;
    const s = 0.7 + random() * 0.6;
    quat.setFromAxisAngle(UP, random() * 6);
    base.set(x, heightAt(x, z), z);
    place.at(flowerStems, i, base, quat, 1, h, 1);
    headPos.set(x, base.y + h, z);
    place.at(flowerHeads, i, headPos, quat, s);
    place.tint(flowerHeads, i, env.plants.flowers[Math.floor(random() * env.plants.flowers.length)], random, 0.05);
  }
  done(flowerStems);
  done(flowerHeads);

  // Trees: pines and broadleaf trees around the clearing, and taller pines beyond.
  const near = env.trees.count;
  const far = 50;
  const trunks = instanced('Trunks', parts.trunk(random), standard('#ffffff', { roughness: 1 }), near + far);
  const pines = instanced('PineCrowns', parts.pineCanopy(random), standard('#ffffff'), near + far);
  const crowns = instanced('LeafyCrowns', parts.leafyCanopy(random), standard('#ffffff'), near);
  const farPine = '#' + new Color(env.trees.pine).offsetHSL(0, -0.05, -0.05).getHexString();
  let pineN = 0;
  let crownN = 0;
  for (let i = 0; i < near + far; i++) {
    const isFar = i >= near;
    const a = isFar ? random() * Math.PI * 2 : (i / near) * Math.PI * 2 + (random() - 0.5) * 0.25;
    const r = isFar ? 17 + random() * 9 : 4.6 + Math.pow(random(), 0.7) * 11;
    const x = Math.cos(a) * r;
    const z = Math.sin(a) * r;
    const yaw = random() * Math.PI * 2;
    const pine = isFar || random() < 0.55;
    const girth = 0.75 + random() * 0.5;
    if (pine) {
      const crownH = isFar ? 6 + random() * 4 : 4 + random() * 3;
      const bare = 0.9 + random() * 0.7;
      const width = crownH * (0.28 + random() * 0.06);
      place.stand(trunks, i, x, z, yaw, girth, bare + crownH * 0.5, girth, 0.03);
      place.stand(pines, pineN, x, z, yaw, width, crownH, width, 0.02, bare - 0.2);
      place.tint(pines, pineN++, isFar ? farPine : env.trees.pine, random, 0.08);
    } else {
      const bare = 2 + random() * 1.2;
      const width = 1.3 + random() * 0.7;
      place.stand(trunks, i, x, z, yaw, girth * 1.2, bare + 0.6, girth * 1.2, 0.04);
      place.stand(crowns, crownN, x, z, yaw, width, width * (0.85 + random() * 0.25), width, 0.04, bare - 0.5);
      place.tint(crowns, crownN++, env.trees.leaves, random, 0.1);
    }
    place.tint(trunks, i, env.trees.trunk, random, 0.08);
  }
  done(trunks);
  done(pines, pineN);
  done(crowns, crownN);

  // A fallen log and two old stumps, in the bark's color.
  const barkMaterial = standard(env.trees.trunk, { roughness: 1 });
  const log = instanced('FallenLog', parts.fallenLog(random), barkMaterial, 1);
  place.stand(log, 0, Math.cos(2.3) * 3.4, Math.sin(2.3) * 3.4, 0.4, 2.2, 1.4, 1.4);
  done(log);
  const stumps = instanced('Stumps', parts.stump(random), barkMaterial, 2);
  place.stand(stumps, 0, Math.cos(0.9) * 3.1, Math.sin(0.9) * 3.1, 0.3, 0.5, 0.32, 0.5);
  place.stand(stumps, 1, Math.cos(-2.6) * 4.3, Math.sin(-2.6) * 4.3, 1.1, 0.62, 0.45, 0.62);
  done(stumps);

  // Light falling through the canopy in a few soft, slanting shafts.
  const shaftMaterial = track(
    new MeshBasicMaterial({
      color: new Color(env.light.sun),
      map: track(shaftTexture()),
      transparent: true,
      opacity: 0.16,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    }),
  );
  const shaftGeometry = track(new PlaneGeometry(1, 1));
  shaftGeometry.translate(0, 0.5, 0);
  const shafts = new Group();
  shafts.name = 'LightShafts';
  for (const [x, z, width] of [
    [-1.6, -2.4, 0.9],
    [1.4, -3.1, 0.7],
    [3.0, -0.6, 0.8],
    [-2.7, 1.6, 0.6],
  ]) {
    const shaft = new Group();
    shaft.position.set(x, heightAt(x, z), z);
    shaft.quaternion.setFromUnitVectors(UP, sunDir);
    shaft.scale.set(width, 9, 1);
    for (const turn of [0, Math.PI / 2]) {
      const plane = new Mesh(shaftGeometry, shaftMaterial);
      plane.rotation.y = turn;
      shaft.add(plane);
    }
    shafts.add(shaft);
  }
  root.add(shafts);

  // Pollen drifting in the warm air.
  let motes: Points | null = null;
  let motePositions: Float32Array | null = null;
  let moteShade: Float32Array | null = null;
  let moteSeeds: Float32Array | null = null;
  if (env.motes && env.motes.count > 0) {
    const n = env.motes.count;
    motePositions = new Float32Array(n * 3);
    moteShade = new Float32Array(n * 3);
    moteSeeds = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) moteSeeds[i] = random();
    const geometry = track(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(motePositions, 3));
    geometry.setAttribute('color', new BufferAttribute(moteShade, 3));
    motes = new Points(
      geometry,
      track(
        new PointsMaterial({
          color: new Color(env.motes.color),
          size: 0.018,
          sizeAttenuation: true,
          vertexColors: true,
          map: track(radialTexture([[0, 'rgba(255,255,255,1)'], [0.35, 'rgba(255,255,255,0.45)'], [1, 'rgba(0,0,0,0)']])),
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    motes.name = 'Pollen';
    motes.frustumCulled = false;
    root.add(motes);
  }

  return {
    root,
    update(_delta, time) {
      glowMaterial.emissiveIntensity = 0.8 + 0.2 * Math.sin(time * 1.1);
      shaftMaterial.opacity = 0.14 + 0.03 * Math.sin(time * 0.35);
      if (motes && motePositions && moteShade && moteSeeds) {
        const n = motePositions.length / 3;
        for (let i = 0; i < n; i++) {
          const a = moteSeeds[i * 4];
          const b = moteSeeds[i * 4 + 1];
          const r = 0.7 + moteSeeds[i * 4 + 2] * 4;
          const angle = a * Math.PI * 2 + time * (0.01 + b * 0.02);
          motePositions[i * 3] = Math.cos(angle) * r + Math.sin(time * 0.3 + a * 9) * 0.2;
          motePositions[i * 3 + 1] = 0.25 + moteSeeds[i * 4 + 3] * 2.4 + Math.sin(time * 0.4 + a * 17) * 0.12;
          motePositions[i * 3 + 2] = Math.sin(angle) * r;
          const glint = 0.35 + 0.65 * Math.max(0, Math.sin(time * (0.5 + b) + a * 40));
          moteShade[i * 3] = moteShade[i * 3 + 1] = moteShade[i * 3 + 2] = glint;
        }
        motes.geometry.attributes.position.needsUpdate = true;
        motes.geometry.attributes.color.needsUpdate = true;
      }
    },
    dispose() {
      for (const thing of disposables) thing.dispose();
    },
    // The pedestal under the mat: an old, moss-tinged stone.
    stoneMaterial: standard('#8a8f7c', { roughness: 0.95 }),
  };
}
