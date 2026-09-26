import {
  BoxGeometry,
  Color,
  createSystem,
  CylinderGeometry,
  FogExp2,
  Group,
  Mesh,
  Quaternion,
  Vector3,
  VisibilityState,
  type Material,
  type Object3D,
} from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { buildEnvironment } from '../environments/registry.js';
import type { EnvironmentInstance } from '../environments/types.js';
import type { ThemeEnvironment } from '../themes/theme.schema.js';
import { TableSystem } from './tableSystem.js';

/** Where an environment centers, as a share of the way from the mat toward the reader. */
const CENTER_TOWARD_READER = 0.35;
const SLAB_THICKNESS = 0.05;

interface Built {
  env: ThemeEnvironment;
  instance: EnvironmentInstance;
  fog: FogExp2;
}

/**
 * Shows one of the theme's VR surroundings in place of passthrough when the
 * reader chooses it. Each environment is built the first time it is chosen.
 * It covers the whole view (so the room is hidden) and centers on the reading
 * area; a pedestal in the environment's stone stands under the mat so it
 * doesn't float. Everything stays in the same XR session, so switching is
 * instant and the mat keeps its place on the real table.
 */
export class EnvironmentSystem extends createSystem({}) {
  private readonly built = new Map<string, Built>();
  private current: Built | null = null;
  private pedestal!: Group;
  private slab!: Mesh;
  private column!: Mesh;
  private mat!: Object3D;
  private time = 0;

  private readonly matPos = new Vector3();
  private readonly headPos = new Vector3();
  private readonly quat = new Quaternion();
  private readonly axis = new Vector3();

  init(): void {
    this.mat = this.world.getSystem(TableSystem)!.mat.object3D!;
    this.buildPedestal();
    this.cleanupFuncs.push(
      app.surroundings.subscribe(() => this.refresh()),
      this.world.visibilityState.subscribe(() => this.refresh()),
      app.machine.subscribe((_, event) => {
        // Re-center when the mat settles somewhere new.
        if (event.type === 'MAT_PLACED' && this.current) this.center(this.current.instance.root);
      }),
      () => {
        for (const { instance } of this.built.values()) instance.dispose();
      },
    );
  }

  update(delta: number): void {
    if (!this.current) return;
    this.time += delta;
    this.current.instance.update(delta, this.time);
    // The pedestal reaches from the floor to just under the mat, wherever the mat is.
    this.mat.getWorldPosition(this.matPos);
    const height = Math.max(this.matPos.y - SLAB_THICKNESS, 0.05);
    this.column.scale.y = height;
    this.column.position.y = -SLAB_THICKNESS - height / 2;
  }

  private refresh(): void {
    const id = app.surroundings.peek();
    const immersive = this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    const env = immersive ? app.theme.theme.environments.find((e) => e.id === id) : undefined;
    const next = env ? this.get(env) : null;
    if (next === this.current) return;

    if (this.current) this.current.instance.root.visible = false;
    this.current = next;
    this.scene.fog = next ? next.fog : null;
    this.pedestal.visible = next !== null;
    if (next) {
      this.setPedestalMaterial(next.instance.stoneMaterial);
      next.instance.root.visible = true;
      this.center(next.instance.root);
    }
  }

  /** Build an environment the first time it's chosen. */
  private get(env: ThemeEnvironment): Built {
    let built = this.built.get(env.id);
    if (!built) {
      const instance = buildEnvironment(env, app.theme);
      instance.root.visible = false;
      this.world.createTransformEntity(instance.root, { persistent: true });
      built = { env, instance, fog: new FogExp2(new Color(env.fog.color), env.fog.density) };
      this.built.set(env.id, built);
    }
    return built;
  }

  /** Center an environment between the mat and the reader, facing the reader. */
  private center(root: Object3D): void {
    this.mat.getWorldPosition(this.matPos);
    this.player.head.getWorldPosition(this.headPos);
    const x = this.matPos.x + (this.headPos.x - this.matPos.x) * CENTER_TOWARD_READER;
    const z = this.matPos.z + (this.headPos.z - this.matPos.z) * CENTER_TOWARD_READER;
    this.mat.getWorldQuaternion(this.quat);
    this.axis.set(0, 0, 1).applyQuaternion(this.quat);
    root.position.set(x, 0, z);
    root.rotation.set(0, Math.atan2(this.axis.x, this.axis.z), 0);
  }

  /** A slab and column under the mat, shown only in VR surroundings. */
  private buildPedestal(): void {
    const { matWidthM, matDepthM } = config.layout;
    this.pedestal = new Group();
    this.pedestal.name = 'Pedestal';
    this.slab = new Mesh(new BoxGeometry(matWidthM + 0.08, SLAB_THICKNESS, matDepthM + 0.08));
    this.slab.position.y = -SLAB_THICKNESS / 2 - 0.001;
    this.column = new Mesh(new CylinderGeometry(0.17, 0.22, 1, 16));
    this.pedestal.add(this.slab, this.column);
    this.pedestal.visible = false;
    this.world.createTransformEntity(this.pedestal, {
      parent: this.world.getSystem(TableSystem)!.mat,
    });
  }

  private setPedestalMaterial(material: Material): void {
    this.slab.material = material;
    this.column.material = material;
  }
}
