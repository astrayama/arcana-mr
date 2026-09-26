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
  type Object3D,
} from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { environmentBuilders } from '../environments/registry.js';
import type { EnvironmentInstance } from '../environments/types.js';
import { TableSystem } from './tableSystem.js';

/** Where the environment centers, as a share of the way from the mat toward the reader. */
const CENTER_TOWARD_READER = 0.35;
const SLAB_THICKNESS = 0.05;

/**
 * Shows the theme's VR surroundings in place of passthrough when the reader
 * chooses them. The environment covers the whole view (so the room is hidden)
 * and centers on the reading area; a pedestal stands under the mat so it
 * doesn't float. Everything stays in the same XR session, so switching is
 * instant and the mat keeps its place on the real table.
 */
export class EnvironmentSystem extends createSystem({}) {
  private env: EnvironmentInstance | null = null;
  private root: Object3D | null = null;
  private pedestal: Group | null = null;
  private column: Mesh | null = null;
  private mat!: Object3D;
  private fog: FogExp2 | null = null;
  private visible = false;
  private time = 0;

  private readonly matPos = new Vector3();
  private readonly headPos = new Vector3();
  private readonly quat = new Quaternion();
  private readonly axis = new Vector3();

  init(): void {
    this.mat = this.world.getSystem(TableSystem)!.mat.object3D!;
    const environment = app.theme.theme.environment;
    if (!environment) return;

    this.env = environmentBuilders[environment.kind](environment, app.theme);
    this.root = this.env.root;
    this.root.visible = false;
    this.world.createTransformEntity(this.root, { persistent: true });
    this.fog = new FogExp2(new Color(environment.fog.color), environment.fog.density);
    this.buildPedestal();

    this.cleanupFuncs.push(
      app.surroundings.subscribe(() => this.refresh()),
      this.world.visibilityState.subscribe(() => this.refresh()),
      app.machine.subscribe((_, event) => {
        // Re-center when the mat settles somewhere new.
        if (event.type === 'MAT_PLACED' && this.visible) this.center();
      }),
      () => this.env?.dispose(),
    );
  }

  update(delta: number): void {
    if (!this.visible || !this.env) return;
    this.time += delta;
    this.env.update(delta, this.time);
    // The pedestal reaches from the floor to just under the mat, wherever the mat is.
    this.mat.getWorldPosition(this.matPos);
    const height = Math.max(this.matPos.y - SLAB_THICKNESS, 0.05);
    this.column!.scale.y = height;
    this.column!.position.y = -SLAB_THICKNESS - height / 2;
  }

  private refresh(): void {
    const show =
      this.env !== null &&
      app.surroundings.peek() === 'vr' &&
      this.world.visibilityState.peek() !== VisibilityState.NonImmersive;
    if (show === this.visible) return;
    this.visible = show;
    this.root!.visible = show;
    this.pedestal!.visible = show;
    this.scene.fog = show ? this.fog : null;
    if (show) this.center();
  }

  /** Center the environment between the mat and the reader, facing the reader. */
  private center(): void {
    this.mat.getWorldPosition(this.matPos);
    this.player.head.getWorldPosition(this.headPos);
    const x = this.matPos.x + (this.headPos.x - this.matPos.x) * CENTER_TOWARD_READER;
    const z = this.matPos.z + (this.headPos.z - this.matPos.z) * CENTER_TOWARD_READER;
    this.mat.getWorldQuaternion(this.quat);
    this.axis.set(0, 0, 1).applyQuaternion(this.quat);
    this.root!.position.set(x, 0, z);
    this.root!.rotation.set(0, Math.atan2(this.axis.x, this.axis.z), 0);
  }

  /** A stone slab and column under the mat, shown only in the VR surroundings. */
  private buildPedestal(): void {
    const { matWidthM, matDepthM } = config.layout;
    const material = this.env!.stoneMaterial;
    this.pedestal = new Group();
    this.pedestal.name = 'Pedestal';
    const slab = new Mesh(new BoxGeometry(matWidthM + 0.08, SLAB_THICKNESS, matDepthM + 0.08), material);
    slab.position.y = -SLAB_THICKNESS / 2 - 0.001;
    this.column = new Mesh(new CylinderGeometry(0.17, 0.22, 1, 16), material);
    this.pedestal.add(slab, this.column);
    this.pedestal.visible = false;
    this.world.createTransformEntity(this.pedestal, {
      parent: this.world.getSystem(TableSystem)!.mat,
    });
  }
}
