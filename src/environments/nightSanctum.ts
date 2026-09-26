/**
 * The night-sky sanctum: a round stone platform floating under a starry sky,
 * ringed by standing stones with small flames, soft fog, and a few fireflies.
 * Everything is generated here except the stone textures, which the theme
 * provides (CC0, see CREDITS.md). All of it is one small group of draw calls.
 */

import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  CylinderGeometry,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Points,
  PointsMaterial,
  Quaternion,
  RingGeometry,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  Vector3,
} from '@iwsdk/core';
import type { ResolvedTheme } from '../themes/registry.js';
import type { NightSanctumEnvironment } from '../themes/theme.schema.js';
import { radialTexture, seeded, tiled } from './common.js';
import type { EnvironmentInstance } from './types.js';

const SKY_RADIUS = 40;
const STAR_RADIUS = 36;

function buildSky(env: NightSanctumEnvironment): Mesh {
  const geometry = new SphereGeometry(SKY_RADIUS, 32, 20);
  const top = new Color(env.sky.top);
  const horizon = new Color(env.sky.horizon);
  const bottom = new Color(env.sky.bottom);
  const colors = new Float32Array(geometry.attributes.position.count * 3);
  const c = new Color();
  for (let i = 0; i < geometry.attributes.position.count; i++) {
    const y = geometry.attributes.position.getY(i) / SKY_RADIUS;
    if (y >= 0) c.lerpColors(horizon, top, Math.pow(y, 0.6));
    else c.lerpColors(horizon, bottom, Math.min(1, -y * 4));
    c.toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const sky = new Mesh(
    geometry,
    new MeshBasicMaterial({ vertexColors: true, side: BackSide, fog: false, depthWrite: false }),
  );
  sky.renderOrder = -100;
  sky.name = 'SanctumSky';
  return sky;
}

function buildStars(env: NightSanctumEnvironment, random: () => number): Points {
  const count = env.stars.count;
  const positions = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const base = new Color(env.stars.color);
  for (let i = 0; i < count; i++) {
    // Mostly above the horizon, thinning toward it.
    const elevation = Math.asin(Math.pow(random(), 0.8) * 0.98 + 0.02 - 0.06);
    const azimuth = random() * Math.PI * 2;
    positions[i * 3] = STAR_RADIUS * Math.cos(elevation) * Math.cos(azimuth);
    positions[i * 3 + 1] = STAR_RADIUS * Math.sin(elevation);
    positions[i * 3 + 2] = STAR_RADIUS * Math.cos(elevation) * Math.sin(azimuth);
    const brightness = 0.25 + Math.pow(random(), 3) * 0.75;
    colors[i * 3] = base.r * brightness;
    colors[i * 3 + 1] = base.g * brightness;
    colors[i * 3 + 2] = base.b * brightness;
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  geometry.setAttribute('color', new BufferAttribute(colors, 3));
  const stars = new Points(
    geometry,
    new PointsMaterial({
      size: 2.4,
      sizeAttenuation: false,
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  stars.renderOrder = -99;
  stars.frustumCulled = false;
  stars.name = 'SanctumStars';
  return stars;
}

function buildMoon(color: string): Sprite {
  const moon = new Sprite(
    new SpriteMaterial({
      map: radialTexture([
        [0, '#ffffff'],
        [0.18, color],
        [0.22, 'rgba(255,245,220,0.35)'],
        [0.5, 'rgba(255,240,210,0.08)'],
        [1, 'rgba(0,0,0,0)'],
      ]),
      blending: AdditiveBlending,
      depthWrite: false,
      fog: false,
    }),
  );
  // Ahead and up, a little to the right of the reader's view of the table.
  const elevation = (30 * Math.PI) / 180;
  const azimuth = (-60 * Math.PI) / 180;
  moon.position.set(
    30 * Math.cos(elevation) * Math.sin(azimuth),
    30 * Math.sin(elevation),
    -30 * Math.cos(elevation) * Math.cos(azimuth),
  );
  moon.scale.setScalar(6);
  moon.renderOrder = -98;
  moon.name = 'SanctumMoon';
  return moon;
}

export function buildNightSanctum(env: NightSanctumEnvironment, resolved: ResolvedTheme): EnvironmentInstance {
  const random = seeded(23);
  const root = new Group();
  root.name = 'NightSanctum';
  const disposables: { dispose(): void }[] = [];
  const track = <T extends { dispose(): void }>(thing: T) => (disposables.push(thing), thing);

  // Sky, stars, moon.
  const sky = buildSky(env);
  const stars = buildStars(env, random);
  root.add(sky, stars);
  if (env.moon) root.add(buildMoon(env.moon.color));

  // The platform: a stone disc with a short rim and a thin gold inlay ring.
  const floorMaterial = track(
    new MeshStandardMaterial({ color: new Color(env.floor.color), roughness: 0.92, envMapIntensity: 0.5 }),
  );
  const stoneMaterial = track(
    new MeshStandardMaterial({ color: new Color(env.stones.color), roughness: 0.95, envMapIntensity: 0.4 }),
  );
  tiled(resolved, env.floor.texture, env.floor.radiusM / 0.9, true).then((t) => {
    floorMaterial.map = t;
    floorMaterial.needsUpdate = true;
  });
  tiled(resolved, env.floor.normal, env.floor.radiusM / 0.9, false).then((t) => {
    floorMaterial.normalMap = t;
    floorMaterial.needsUpdate = true;
  });
  tiled(resolved, env.stones.texture, 1, true).then((t) => {
    stoneMaterial.map = t;
    stoneMaterial.needsUpdate = true;
  });
  tiled(resolved, env.stones.normal, 1, false).then((t) => {
    stoneMaterial.normalMap = t;
    stoneMaterial.needsUpdate = true;
  });

  const radius = env.floor.radiusM;
  const disc = new Mesh(track(new CircleGeometry(radius, 72)), floorMaterial);
  disc.rotation.x = -Math.PI / 2;
  disc.name = 'SanctumFloor';
  const rim = new Mesh(track(new CylinderGeometry(radius, radius * 0.97, 0.16, 72, 1, true)), stoneMaterial);
  rim.position.y = -0.08;
  const inlay = new Mesh(
    track(new RingGeometry(radius - 0.32, radius - 0.29, 96)),
    track(new MeshStandardMaterial({ color: new Color(resolved.theme.mat.edgeColor), metalness: 0.7, roughness: 0.4 })),
  );
  inlay.rotation.x = -Math.PI / 2;
  inlay.position.y = 0.002;
  root.add(disc, rim, inlay);

  // A ring of standing stones, each with a small flame on top.
  const count = env.stones.count;
  const stones = new InstancedMesh(track(new CylinderGeometry(0.19, 0.27, 1, 6, 1)), stoneMaterial, count);
  stones.name = 'SanctumStones';
  const flamePositions = new Float32Array(count * 3);
  const flameShade = new Float32Array(count * 3);
  const matrix = new Matrix4();
  const quat = new Quaternion();
  const lean = new Quaternion();
  const pos = new Vector3();
  const scale = new Vector3();
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2 + (random() - 0.5) * 0.25;
    const ring = env.stones.ringRadiusM + (random() - 0.5) * 0.3;
    const height = 1.25 + random() * 0.75;
    quat.setFromAxisAngle(new Vector3(0, 1, 0), random() * Math.PI);
    lean.setFromAxisAngle(new Vector3(1, 0, 0), (random() - 0.5) * 0.08);
    quat.multiply(lean);
    pos.set(Math.cos(angle) * ring, height / 2, Math.sin(angle) * ring);
    scale.set(1, height, 1);
    stones.setMatrixAt(i, matrix.compose(pos, quat, scale));
    flamePositions[i * 3] = pos.x;
    flamePositions[i * 3 + 1] = height + 0.1;
    flamePositions[i * 3 + 2] = pos.z;
  }
  stones.instanceMatrix.needsUpdate = true;
  root.add(stones);

  const flameColor = new Color(env.flameColor);
  const flameGeometry = track(new BufferGeometry());
  flameGeometry.setAttribute('position', new BufferAttribute(flamePositions, 3));
  flameGeometry.setAttribute('color', new BufferAttribute(flameShade, 3));
  const flames = new Points(
    flameGeometry,
    track(
      new PointsMaterial({
        size: 0.22,
        sizeAttenuation: true,
        vertexColors: true,
        map: radialTexture([
          [0, 'rgba(255,250,235,1)'],
          [0.25, 'rgba(255,190,110,0.9)'],
          [1, 'rgba(0,0,0,0)'],
        ]),
        transparent: true,
        blending: AdditiveBlending,
        depthWrite: false,
      }),
    ),
  );
  flames.name = 'SanctumFlames';
  flames.frustumCulled = false;
  root.add(flames);

  // Fireflies drifting over the platform.
  let fireflyPositions: Float32Array | null = null;
  let fireflyShade: Float32Array | null = null;
  let fireflySeeds: Float32Array | null = null;
  let fireflies: Points | null = null;
  if (env.fireflies && env.fireflies.count > 0) {
    const n = env.fireflies.count;
    fireflyPositions = new Float32Array(n * 3);
    fireflyShade = new Float32Array(n * 3);
    fireflySeeds = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) fireflySeeds[i] = random();
    const geometry = track(new BufferGeometry());
    geometry.setAttribute('position', new BufferAttribute(fireflyPositions, 3));
    geometry.setAttribute('color', new BufferAttribute(fireflyShade, 3));
    fireflies = new Points(
      geometry,
      track(
        new PointsMaterial({
          color: new Color(env.fireflies.color),
          size: 0.025,
          sizeAttenuation: true,
          vertexColors: true,
          map: radialTexture([
            [0, 'rgba(255,255,255,1)'],
            [0.3, 'rgba(255,255,255,0.5)'],
            [1, 'rgba(0,0,0,0)'],
          ]),
          transparent: true,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      ),
    );
    fireflies.name = 'SanctumFireflies';
    fireflies.frustumCulled = false;
    root.add(fireflies);
  }

  return {
    root,
    update(delta, time) {
      stars.rotation.y += delta * 0.0015;
      // Flames breathe on a few slow waves; no random jitter.
      for (let i = 0; i < count; i++) {
        const k = 0.75 + 0.15 * Math.sin(time * 6.1 + i * 1.7) + 0.1 * Math.sin(time * 11.3 + i * 0.6);
        flameShade[i * 3] = flameColor.r * k;
        flameShade[i * 3 + 1] = flameColor.g * k;
        flameShade[i * 3 + 2] = flameColor.b * k;
      }
      flameGeometry.attributes.color.needsUpdate = true;

      if (fireflies && fireflyPositions && fireflyShade && fireflySeeds) {
        const n = fireflyPositions.length / 3;
        for (let i = 0; i < n; i++) {
          const a = fireflySeeds[i * 4];
          const b = fireflySeeds[i * 4 + 1];
          const r = 0.9 + fireflySeeds[i * 4 + 2] * (radius + 0.4);
          const angle = a * Math.PI * 2 + time * (0.02 + b * 0.03);
          fireflyPositions[i * 3] = Math.cos(angle) * r;
          fireflyPositions[i * 3 + 1] = 0.3 + fireflySeeds[i * 4 + 3] * 2 + Math.sin(time * 0.5 + a * 20) * 0.15;
          fireflyPositions[i * 3 + 2] = Math.sin(angle) * r;
          const glow = Math.max(0, Math.sin(time * (0.6 + b) + a * 30));
          fireflyShade[i * 3] = fireflyShade[i * 3 + 1] = fireflyShade[i * 3 + 2] = glow;
        }
        fireflies.geometry.attributes.position.needsUpdate = true;
        fireflies.geometry.attributes.color.needsUpdate = true;
      }
    },
    dispose() {
      for (const thing of disposables) thing.dispose();
      sky.geometry.dispose();
      (sky.material as MeshBasicMaterial).dispose();
      stars.geometry.dispose();
      (stars.material as PointsMaterial).dispose();
    },
    stoneMaterial,
  };
}
