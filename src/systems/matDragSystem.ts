import {
  BoxGeometry,
  Color,
  createSystem,
  DistanceGrabbable,
  Grabbed,
  GrabSystem,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  MovementMode,
  OneHandGrabbable,
  Quaternion,
  Vector3,
  type Entity,
  type Object3D,
} from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { MatHandle } from '../components/table.js';
import { snapYaw, type MatPose, type SurfaceRect } from '../placement/tableMath.js';
import { PLACEMENT_STATUS, PlacementSystem } from './placementSystem.js';
import { TableSystem } from './tableSystem.js';

/** Handles sit this far above the mat's origin so hands and rays find them easily. */
const HANDLE_LIFT = 0.03;
/** On release, the mat settles onto a surface within this height. */
const SNAP_HEIGHT_M = 0.12;
/** On release, the mat squares up to the table if it is within this angle. */
const SNAP_YAW = (10 * Math.PI) / 180;
const MAX_DRAG_DISTANCE_M = 4;

/**
 * Lets the reader move the mat directly while placing it:
 *   - reach out and grab it (hand pinch or fist, controller grip), and it
 *     follows the hand, turning only around the vertical
 *   - point at it and hold trigger or pinch, and it slides along its own
 *     height to wherever the ray points
 * On release it settles onto the table underneath and squares up to it.
 * Only active while placing, so it never competes with cards or panels.
 */
export class MatDragSystem extends createSystem({
  held: { required: [MatHandle, Grabbed] },
}) {
  private placement!: PlacementSystem;
  private mat!: Object3D;
  private near!: Entity;
  private ray!: Entity;
  private trim: MeshStandardMaterial | null = null;
  private active = false;
  private dragging: Entity | null = null;

  private readonly handleYaw = new Quaternion();
  private readonly pos = new Vector3();
  private readonly quat = new Quaternion();
  private readonly dir = new Vector3();
  private readonly axis = new Vector3();
  private readonly up = new Vector3(0, 1, 0);
  private readonly rayOffset = new Vector3();
  private readonly glow = new Color();

  init(): void {
    this.placement = this.world.getSystem(PlacementSystem)!;
    const table = this.world.getSystem(TableSystem)!;
    this.mat = table.mat.object3D!;
    const trim = this.mat.getObjectByName('MatTrim') as Mesh<BoxGeometry, MeshStandardMaterial> | undefined;
    this.trim = trim?.material ?? null;
    this.glow.set(app.theme.theme.cardHighlight.color);

    const { matWidthM, matDepthM } = config.layout;
    const geometry = new BoxGeometry(matWidthM + 0.04, 0.08, matDepthM + 0.04);
    // Invisible but hit-testable: raycasts ignore material visibility.
    const material = new MeshBasicMaterial({ visible: false });
    const makeHandle = (kind: 'near' | 'ray') => {
      const mesh = new Mesh(geometry, material);
      mesh.name = `MatHandle-${kind}`;
      const entity = this.world.createTransformEntity(mesh, { persistent: true });
      entity.addComponent(MatHandle, { kind });
      return entity;
    };
    this.near = makeHandle('near');
    this.ray = makeHandle('ray');

    this.cleanupFuncs.push(
      app.machine.subscribe((snapshot) => this.setActive(snapshot.state === 'PLACING')),
      this.queries.held.subscribe('qualify', (entity) => this.startDrag(entity)),
      this.queries.held.subscribe('disqualify', (entity) => this.endDrag(entity)),
      () => {
        geometry.dispose();
        material.dispose();
      },
    );
    this.setActive(app.machine.state === 'PLACING');
  }

  update(): void {
    if (!this.active || !this.mat.visible) return;
    if (this.dragging === this.near) {
      this.followNearHandle();
    } else if (this.dragging === this.ray) {
      this.followRay();
    } else {
      this.syncHandles();
    }
  }

  private setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (active) {
      this.near.addComponent(OneHandGrabbable, {
        translate: true,
        rotate: true,
        // Turn only around the vertical, so the mat always stays level.
        rotateMin: [0, -Infinity, 0],
        rotateMax: [0, Infinity, 0],
      });
      this.ray.addComponent(DistanceGrabbable, {
        movementMode: MovementMode.MoveFromTarget,
        translate: true,
        rotate: false,
        scale: false,
        returnToOrigin: false,
      });
      this.syncHandles();
    } else {
      if (this.dragging) this.world.getSystem(GrabSystem)?.forceRelease(this.dragging);
      this.dragging = null;
      this.near.removeComponent(OneHandGrabbable);
      this.ray.removeComponent(DistanceGrabbable);
      this.setGlow(false);
    }
  }

  /** Keep both handles on top of the mat while nobody is holding it. */
  private syncHandles(): void {
    const pose = this.placement.currentPose();
    this.handleYaw.setFromAxisAngle(this.up, pose.yaw);
    for (const handle of [this.near, this.ray]) {
      const object = handle.object3D!;
      object.position.set(pose.x, pose.y + HANDLE_LIFT, pose.z);
      object.quaternion.copy(this.handleYaw);
    }
  }

  private startDrag(handle: Entity): void {
    if (!this.active || this.dragging) return;
    this.dragging = handle;
    this.setGlow(true);
    if (handle === this.ray) {
      // Remember where on the mat the ray grabbed, so the mat doesn't jump to the ray.
      const pose = this.placement.currentPose();
      const hit = this.rayHit(pose.y);
      if (hit) this.rayOffset.set(pose.x - hit.x, 0, pose.z - hit.z);
      else this.rayOffset.set(0, 0, 0);
    }
  }

  private endDrag(handle: Entity): void {
    if (handle !== this.dragging) return;
    this.dragging = null;
    this.setGlow(false);
    this.settle();
    this.syncHandles();
    this.placement.setStatus(PLACEMENT_STATUS.moved);
  }

  private followNearHandle(): void {
    const object = this.near.object3D!;
    object.getWorldPosition(this.pos);
    object.getWorldQuaternion(this.quat);
    this.axis.set(0, 0, 1).applyQuaternion(this.quat);
    this.placement.applyPose({
      x: this.pos.x,
      y: this.pos.y - HANDLE_LIFT,
      z: this.pos.z,
      yaw: Math.atan2(this.axis.x, this.axis.z),
    });
  }

  /** Slide the mat along its own height to where the holding ray points. */
  private followRay(): void {
    const pose = this.placement.currentPose();
    const hit = this.rayHit(pose.y);
    if (!hit) return;
    this.placement.applyPose({ ...pose, x: hit.x + this.rayOffset.x, z: hit.z + this.rayOffset.z });
  }

  /** Where the holding hand's ray meets the horizontal plane at `height`, or null. */
  private rayHit(height: number): Vector3 | null {
    const hand = this.world.getSystem(GrabSystem)?.getHolderHand(this.ray);
    const space = hand ? this.player.raySpaces[hand] : null;
    if (!space) return null;
    space.getWorldPosition(this.pos);
    space.getWorldQuaternion(this.quat);
    this.dir.set(0, 0, -1).applyQuaternion(this.quat);
    // Only rays pointing down toward the table can drag it.
    if (this.dir.y > -0.02) return null;
    const t = (height - this.pos.y) / this.dir.y;
    if (t <= 0 || t > MAX_DRAG_DISTANCE_M) return null;
    return this.pos.addScaledVector(this.dir, t);
  }

  /** Settle onto a table under the mat and square up to it, if one is close. */
  private settle(): void {
    const pose = this.placement.currentPose();
    const surfaceY = pose.y - config.layout.surfaceOffsetM;
    let best: SurfaceRect | null = null;
    for (const rect of this.placement.collectSurfaces()) {
      if (Math.abs(rect.y - surfaceY) > SNAP_HEIGHT_M) continue;
      if (!this.contains(rect, pose)) continue;
      if (!best || Math.abs(rect.y - surfaceY) < Math.abs(best.y - surfaceY)) best = rect;
    }
    if (!best) return;
    const snapped = snapYaw(pose.yaw, best.yaw);
    const delta = Math.atan2(Math.sin(snapped - pose.yaw), Math.cos(snapped - pose.yaw));
    this.placement.applyPose({
      ...pose,
      y: best.y + config.layout.surfaceOffsetM,
      yaw: Math.abs(delta) < SNAP_YAW ? snapped : pose.yaw,
    });
  }

  private contains(rect: SurfaceRect, pose: MatPose): boolean {
    const dx = pose.x - rect.cx;
    const dz = pose.z - rect.cz;
    const c = Math.cos(rect.yaw);
    const s = Math.sin(rect.yaw);
    return Math.abs(dx * c - dz * s) <= rect.halfW && Math.abs(dx * s + dz * c) <= rect.halfD;
  }

  /** Light the mat's trim while it is held, so it's clear it's in hand. */
  private setGlow(on: boolean): void {
    if (!this.trim) return;
    this.trim.emissive.copy(this.glow);
    this.trim.emissiveIntensity = on ? 0.6 : 0;
  }
}
