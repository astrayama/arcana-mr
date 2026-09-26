/**
 * The cloud sea: a small stone terrace floating above an endless sea of
 * slowly drifting clouds at sunset, with a low golden sun and a few birds far
 * off. Everything is generated here except the terrace stone texture (CC0,
 * shared with the sanctum, see CREDITS.md). Everything stays inside the
 * camera's 200 m far plane.
 */

import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  ConeGeometry,
  CylinderGeometry,
  Group,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  RepeatWrapping,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  TorusGeometry,
  Vector3,
} from '@iwsdk/core';
import type { ResolvedTheme } from '../themes/registry.js';
import type { CloudSeaEnvironment } from '../themes/theme.schema.js';
import { radialTexture, seeded, tiled } from './common.js';
import type { EnvironmentInstance } from './types.js';

const SKY_RADIUS = 140;
const SEA_RADIUS = 165;
const DEG = Math.PI / 180;

/** Direction of the sun: azimuth 0 is straight ahead of the reader (-Z), positive to the right. */
function sunDirection(env: CloudSeaEnvironment): Vector3 {
  const el = env.sun.elevationDeg * DEG;
  const az = env.sun.azimuthDeg * DEG;
  return new Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
}

function buildSky(env: CloudSeaEnvironment, sun: Vector3): Mesh {
  const geometry = new SphereGeometry(SKY_RADIUS, 48, 24);
  const zenith = new Color(env.sky.zenith);
  const upper = new Color(env.sky.upper);
  const horizon = new Color(env.sky.horizon);
  const below = new Color(env.sky.below);
  const glow = new Color(env.sun.color);
  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const c = new Color();
  const dir = new Vector3();
  for (let i = 0; i < position.count; i++) {
    dir.set(position.getX(i), position.getY(i), position.getZ(i)).normalize();
    const elevation = Math.asin(dir.y) / (Math.PI / 2);
    if (elevation >= 0.12) c.lerpColors(upper, zenith, Math.pow((elevation - 0.12) / 0.88, 0.7));
    else if (elevation >= 0) c.lerpColors(horizon, upper, elevation / 0.12);
    // Below the horizon the sky fades into the haze the clouds disappear into.
    else c.lerpColors(horizon, below, Math.min(1, -elevation * 6));
    // Warm glow around the sun, broad and soft plus a tight bright core.
    const toward = Math.max(0, dir.dot(sun));
    const k = Math.pow(toward, 10) * 0.55 + Math.pow(toward, 120) * 0.6;
    c.r = Math.min(1, c.r + glow.r * k);
    c.g = Math.min(1, c.g + glow.g * k);
    c.b = Math.min(1, c.b + glow.b * k);
    c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const sky = new Mesh(
    geometry,
    new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -100;
  sky.name = 'CloudSeaSky';
  return sky;
}

/**
 * Tileable soft cloud cover: a few octaves of periodic value noise, turned
 * into alpha so gaps show the layer beneath. Generated once, 256 px.
 */
function cloudTexture(random: () => number): CanvasTexture {
  const size = 256;
  const noise = new Float32Array(size * size);
  let amplitude = 0.55;
  for (const cells of [4, 8, 16, 32]) {
    const lattice = new Float32Array(cells * cells);
    for (let i = 0; i < lattice.length; i++) lattice[i] = random();
    const step = size / cells;
    for (let y = 0; y < size; y++) {
      const gy = y / step;
      const y0 = Math.floor(gy) % cells;
      const y1 = (y0 + 1) % cells;
      const fy = gy - Math.floor(gy);
      const sy = fy * fy * (3 - 2 * fy);
      for (let x = 0; x < size; x++) {
        const gx = x / step;
        const x0 = Math.floor(gx) % cells;
        const x1 = (x0 + 1) % cells;
        const fx = gx - Math.floor(gx);
        const sx = fx * fx * (3 - 2 * fx);
        const top = lattice[y0 * cells + x0] * (1 - sx) + lattice[y0 * cells + x1] * sx;
        const bottom = lattice[y1 * cells + x0] * (1 - sx) + lattice[y1 * cells + x1] * sx;
        noise[y * size + x] += (top * (1 - sy) + bottom * sy) * amplitude;
      }
    }
    amplitude *= 0.5;
  }
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const image = ctx.createImageData(size, size);
  for (let i = 0; i < noise.length; i++) {
    const n = noise[i] / 1.0;
    const cover = Math.min(1, Math.max(0, (n - 0.38) / 0.32));
    const shade = 215 + Math.round(40 * Math.min(1, Math.max(0, (n - 0.45) / 0.4)));
    image.data[i * 4] = shade;
    image.data[i * 4 + 1] = shade;
    image.data[i * 4 + 2] = shade;
    image.data[i * 4 + 3] = Math.round(cover * cover * (3 - 2 * cover) * 255);
  }
  ctx.putImageData(image, 0, 0);
  const texture = new CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = RepeatWrapping;
  return texture;
}

/** A soft, lumpy cloud puff for billboards: a few overlapping blurred circles. */
function puffTexture(random: () => number): CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  for (let i = 0; i < 7; i++) {
    const x = 34 + random() * 60;
    const y = 50 + random() * 30;
    const r = 18 + random() * 22;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(255,255,255,0.55)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return new CanvasTexture(canvas);
}

export function buildCloudSea(env: CloudSeaEnvironment, resolved: ResolvedTheme): EnvironmentInstance {
  const random = seeded(7);
  const root = new Group();
  root.name = 'CloudSea';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(thing: T) => (disposables.push(thing), thing);
  const sunDir = sunDirection(env);

  // Sky and sun.
  const sky = buildSky(env, sunDir);
  track(sky.geometry);
  track(sky.material as MeshBasicMaterial);
  const sun = new Sprite(
    track(
      new SpriteMaterial({
        map: track(
          radialTexture([
            [0, '#ffffff'],
            [0.1, env.sun.color],
            [0.14, 'rgba(255,230,190,0.45)'],
            [0.45, 'rgba(255,200,150,0.1)'],
            [1, 'rgba(0,0,0,0)'],
          ]),
        ),
        blending: AdditiveBlending,
        depthWrite: false,
        fog: false,
      }),
    ),
  );
  sun.position.copy(sunDir).multiplyScalar(120);
  sun.scale.setScalar(26);
  sun.renderOrder = -98;
  root.add(sky, sun);

  // The cloud sea: a solid floor of cloud, with two drifting textured layers above it.
  const lit = new Color(env.clouds.lit);
  const shade = new Color(env.clouds.shade);
  const cover = track(cloudTexture(random));
  const floor = new Mesh(
    track(new CircleGeometry(SEA_RADIUS, 64)),
    track(new MeshBasicMaterial({ color: shade.clone().lerp(lit, 0.25) })),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -18;
  floor.renderOrder = -90;
  const lowerMap = cover.clone();
  const upperMap = cover.clone();
  track(lowerMap);
  track(upperMap);
  lowerMap.repeat.set(9, 9);
  upperMap.repeat.set(14, 14);
  lowerMap.needsUpdate = upperMap.needsUpdate = true;
  const lower = new Mesh(
    floor.geometry,
    track(new MeshBasicMaterial({ color: shade, map: lowerMap, transparent: true, depthWrite: false })),
  );
  lower.rotation.x = -Math.PI / 2;
  lower.position.y = -15;
  lower.renderOrder = -89;
  const upper = new Mesh(
    floor.geometry,
    track(new MeshBasicMaterial({ color: lit, map: upperMap, transparent: true, depthWrite: false, opacity: 0.92 })),
  );
  upper.rotation.x = -Math.PI / 2;
  upper.position.y = -12;
  upper.renderOrder = -88;
  root.add(floor, lower, upper);

  // Cloud puffs drifting a little below the terrace, and a few tall ones far off.
  const puff = track(puffTexture(random));
  const makePuffs = (count: number, size: number, minR: number, maxR: number, minY: number, maxY: number, color: Color) => {
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const angle = random() * Math.PI * 2;
      const r = minR + random() * (maxR - minR);
      positions[i * 3] = Math.cos(angle) * r;
      positions[i * 3 + 1] = minY + random() * (maxY - minY);
      positions[i * 3 + 2] = Math.sin(angle) * r;
    }
    const geometry = track(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(positions, 3));
    const points = new Points(
      geometry,
      track(
        new PointsMaterial({
          color,
          map: puff,
          size,
          sizeAttenuation: true,
          transparent: true,
          depthWrite: false,
        }),
      ),
    );
    points.frustumCulled = false;
    points.renderOrder = -87;
    return points;
  };
  const puffs = new Group();
  puffs.add(makePuffs(36, 16, 14, 70, -10, -4, lit));
  const towers = makePuffs(10, 55, 95, 115, 2, 16, lit.clone().lerp(shade, 0.35));
  root.add(puffs, towers);

  // The terrace: pale stone floor, a tapered underside, and a balustrade.
  const stone = track(
    new MeshStandardMaterial({ color: new Color(env.terrace.color), roughness: 0.85, envMapIntensity: 0.7 }),
  );
  const radius = env.terrace.radiusM;
  tiled(resolved, env.terrace.texture, radius / 0.9, true).then((t) => {
    if (!t) return;
    track(t);
    stone.map = t;
    stone.needsUpdate = true;
  });
  tiled(resolved, env.terrace.normal, radius / 0.9, false).then((t) => {
    if (!t) return;
    track(t);
    stone.normalMap = t;
    stone.needsUpdate = true;
  });
  const deck = new Mesh(track(new CircleGeometry(radius, 72)), stone);
  deck.rotation.x = -Math.PI / 2;
  deck.name = 'CloudSeaTerrace';
  const rim = new Mesh(track(new CylinderGeometry(radius, radius, 0.25, 72, 1, true)), stone);
  rim.position.y = -0.125;
  const underside = new Mesh(track(new ConeGeometry(radius, 1.6, 48, 1, true)), stone);
  underside.rotation.x = Math.PI;
  underside.position.y = -0.25 - 0.8;
  root.add(deck, rim, underside);

  const rail = track(new MeshStandardMaterial({ color: new Color(env.terrace.railColor), roughness: 0.75 }));
  const railRadius = radius - 0.08;
  const postCount = Math.round((Math.PI * 2 * railRadius) / 0.24);
  const posts = new InstancedMesh(track(new CylinderGeometry(0.028, 0.036, 0.84, 8)), rail, postCount);
  const matrix = new Matrix4();
  for (let i = 0; i < postCount; i++) {
    const angle = (i / postCount) * Math.PI * 2;
    matrix.makeTranslation(Math.cos(angle) * railRadius, 0.42, Math.sin(angle) * railRadius);
    posts.setMatrixAt(i, matrix);
  }
  posts.instanceMatrix.needsUpdate = true;
  const topRail = new Mesh(track(new TorusGeometry(railRadius, 0.04, 8, 120)), rail);
  topRail.rotation.x = Math.PI / 2;
  topRail.position.y = 0.88;
  const footRail = new Mesh(track(new TorusGeometry(railRadius, 0.03, 6, 120)), rail);
  footRail.rotation.x = Math.PI / 2;
  footRail.position.y = 0.04;
  root.add(posts, topRail, footRail);

  // Birds circling far off: each is two wing strokes meeting at the body.
  let birds: LineSegments | null = null;
  const birdSeeds: number[] = [];
  if (env.birds && env.birds.count > 0) {
    const count = env.birds.count;
    for (let i = 0; i < count; i++) birdSeeds.push(random(), random(), random());
    const geometry = track(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 4 * 3), 3));
    birds = new LineSegments(geometry, track(new LineBasicMaterial({ color: new Color(env.birds.color) })));
    birds.frustumCulled = false;
    root.add(birds);
  }

  let drift = 0;
  return {
    root,
    stoneMaterial: stone,
    update(delta, time) {
      drift += delta * env.clouds.speed;
      lowerMap.offset.set(drift * 0.03, drift * 0.012);
      upperMap.offset.set(drift * 0.05, -drift * 0.02);
      puffs.rotation.y += delta * env.clouds.speed * 0.02;

      if (birds) {
        const array = birds.geometry.attributes.position.array as Float32Array;
        const count = birdSeeds.length / 3;
        for (let i = 0; i < count; i++) {
          const a = birdSeeds[i * 3];
          const b = birdSeeds[i * 3 + 1];
          const c = birdSeeds[i * 3 + 2];
          const r = 32 + a * 22;
          const angle = a * Math.PI * 2 + time * (0.03 + b * 0.02);
          const x = Math.cos(angle) * r;
          const z = Math.sin(angle) * r;
          const y = 6 + c * 9 + Math.sin(time * 0.3 + a * 10) * 0.8;
          // Wings point across the flight path; tips rise and fall as it flaps.
          const wx = -Math.sin(angle);
          const wz = Math.cos(angle);
          const span = 0.9;
          const flap = Math.sin(time * (5 + c * 2) + a * 20) * 0.45;
          const o = i * 12;
          array[o] = x - wx * span;
          array[o + 1] = y + flap;
          array[o + 2] = z - wz * span;
          array[o + 3] = x;
          array[o + 4] = y;
          array[o + 5] = z;
          array[o + 6] = x;
          array[o + 7] = y;
          array[o + 8] = z;
          array[o + 9] = x + wx * span;
          array[o + 10] = y + flap;
          array[o + 11] = z + wz * span;
        }
        birds.geometry.attributes.position.needsUpdate = true;
      }
    },
    dispose() {
      for (const thing of disposables) thing.dispose();
    },
  };
}
