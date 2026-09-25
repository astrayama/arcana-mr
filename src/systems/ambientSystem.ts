import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  createSystem,
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  PointLight,
  Points,
  PointsMaterial,
  Sprite,
  SpriteMaterial,
} from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { MAT_SURFACE_Y } from '../visuals/tableVisuals.js';
import { TableSystem } from './tableSystem.js';

const CANDLE_HEIGHT = 0.075;
const CANDLE_RADIUS = 0.012;
/** Volume above the mat where motes drift, in meters. */
const MOTE_BOX = { width: 0.5, height: 0.32, depth: 0.36 };

/** A soft round dot, drawn once, for flames and motes. */
function softDot(inner: string, outer: string): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, inner);
  gradient.addColorStop(0.35, outer);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 64);
  return new CanvasTexture(canvas);
}

interface Candle {
  flame: Sprite;
  light: PointLight;
  phase: number;
}

/**
 * The theme's atmosphere: candles at the far corners of the mat whose light
 * falls on the cards and cloth, and a few motes drifting in that light. Both
 * are optional per theme and live on the mat, so they move with it.
 */
export class AmbientSystem extends createSystem({}) {
  private candles: Candle[] = [];
  private motes: Points | null = null;
  private moteSeeds!: Float32Array;
  private time = 0;

  init(): void {
    const { candles, particles } = app.theme.theme.ambient;
    const mat = this.world.getSystem(TableSystem)!.mat;
    const root = new Group();
    root.name = 'Ambient';
    this.world.createTransformEntity(root, { parent: mat });

    if (candles && candles.count > 0) {
      const wax = new MeshStandardMaterial({ color: 0xefe3c8, roughness: 0.6 });
      const body = new CylinderGeometry(CANDLE_RADIUS * 0.94, CANDLE_RADIUS, CANDLE_HEIGHT, 20);
      const flameMaterial = new SpriteMaterial({
        map: softDot('rgba(255,250,230,1)', candles.color),
        blending: AdditiveBlending,
        depthWrite: false,
        transparent: true,
      });
      const { matWidthM, matDepthM } = config.layout;
      for (let i = 0; i < candles.count; i++) {
        // Spread along the far edge, starting from the corners.
        const t = candles.count === 1 ? 0.5 : i / (candles.count - 1);
        const x = (t - 0.5) * (matWidthM - 0.07);
        const z = -matDepthM / 2 + 0.04;
        const candle = new Mesh(body, wax);
        candle.position.set(x, MAT_SURFACE_Y + CANDLE_HEIGHT / 2, z);
        const flame = new Sprite(flameMaterial);
        flame.scale.set(0.02, 0.034, 1);
        flame.position.set(x, MAT_SURFACE_Y + CANDLE_HEIGHT + 0.016, z);
        const light = new PointLight(new Color(candles.color), candles.intensity, 0.9, 2);
        light.position.copy(flame.position);
        root.add(candle, flame, light);
        this.candles.push({ flame, light, phase: i * 1.7 });
      }
    }

    if (particles && particles.count > 0) {
      const positions = new Float32Array(particles.count * 3);
      this.moteSeeds = new Float32Array(particles.count * 3);
      for (let i = 0; i < particles.count; i++) {
        this.moteSeeds[i * 3] = Math.random();
        this.moteSeeds[i * 3 + 1] = Math.random();
        this.moteSeeds[i * 3 + 2] = Math.random();
      }
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(positions, 3));
      // Per-mote brightness so each one fades in and out over its loop.
      geometry.setAttribute('color', new BufferAttribute(new Float32Array(particles.count * 3), 3));
      this.motes = new Points(
        geometry,
        new PointsMaterial({
          color: new Color(particles.color),
          vertexColors: true,
          map: softDot('rgba(255,255,255,1)', 'rgba(255,255,255,0.4)'),
          size: particles.size,
          sizeAttenuation: true,
          transparent: true,
          opacity: 0.8,
          blending: AdditiveBlending,
          depthWrite: false,
        }),
      );
      this.motes.frustumCulled = false;
      this.motes.name = 'Motes';
      root.add(this.motes);
      this.updateMotes();
    }
  }

  update(delta: number): void {
    this.time += delta;
    const base = app.theme.theme.ambient.candles?.intensity ?? 0;
    for (const candle of this.candles) {
      // Two slow waves plus a faster one read as a living flame without random jitter.
      const t = this.time + candle.phase;
      const flicker = 0.82 + 0.1 * Math.sin(t * 7.3) + 0.06 * Math.sin(t * 13.1) + 0.04 * Math.sin(t * 2.1);
      candle.light.intensity = base * flicker;
      candle.flame.scale.set(0.02 * (0.95 + 0.05 * flicker), 0.034 * flicker, 1);
    }
    if (this.motes) this.updateMotes();
  }

  /** Each mote rises slowly on its own loop, swaying a little as it goes. */
  private updateMotes(): void {
    const positions = this.motes!.geometry.attributes.position as BufferAttribute;
    const colors = this.motes!.geometry.attributes.color as BufferAttribute;
    const array = positions.array as Float32Array;
    const shade = colors.array as Float32Array;
    const count = array.length / 3;
    for (let i = 0; i < count; i++) {
      const sx = this.moteSeeds[i * 3];
      const sy = this.moteSeeds[i * 3 + 1];
      const sz = this.moteSeeds[i * 3 + 2];
      const rise = (sy + this.time * (0.012 + sz * 0.01)) % 1;
      array[i * 3] = (sx - 0.5) * MOTE_BOX.width + Math.sin(this.time * 0.4 + sy * 9) * 0.012;
      array[i * 3 + 1] = MAT_SURFACE_Y + 0.02 + rise * MOTE_BOX.height;
      array[i * 3 + 2] = (sz - 0.5) * MOTE_BOX.depth + Math.cos(this.time * 0.33 + sx * 7) * 0.012;
      const glow = Math.sin(Math.PI * rise) * (0.6 + 0.4 * Math.sin(this.time * 1.3 + sx * 20));
      shade[i * 3] = shade[i * 3 + 1] = shade[i * 3 + 2] = Math.max(glow, 0);
    }
    positions.needsUpdate = true;
    colors.needsUpdate = true;
  }
}
