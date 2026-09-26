/**
 * An invisible near-grab target that moves a table object (the deck or a
 * card) without being its parent. IWSDK grabbables block rays for everything
 * beneath them, so the handle sits beside the object under the same parent
 * (the mat) and the object copies the handle's pose while it is held.
 */

import {
  BoxGeometry,
  Grabbed,
  GrabSystem,
  Mesh,
  MeshBasicMaterial,
  OneHandGrabbable,
  Vector3,
  type Entity,
  type Object3D,
  type World,
} from '@iwsdk/core';
import { TableHandle } from '../components/table.js';
import { isGrabTap } from '../visuals/layout.js';

/** Invisible but hit-testable: raycasts ignore material visibility. */
const hiddenMaterial = new MeshBasicMaterial({ visible: false });

export class GrabHandle {
  readonly entity: Entity;
  readonly mesh: Mesh;
  private enabled = true;
  private grabTime = 0;
  private readonly grabPosition = new Vector3();

  constructor(
    private readonly world: World,
    parent: Entity,
    size: { width: number; height: number; depth: number },
    kind: 'deck' | 'card',
    key = -1,
    /** How far above the object's origin the handle's center sits. */
    private readonly lift = size.height / 2,
  ) {
    this.mesh = new Mesh(new BoxGeometry(size.width, size.height, size.depth), hiddenMaterial);
    this.mesh.name = `TableHandle-${kind}${key >= 0 ? `-${key}` : ''}`;
    this.entity = world.createTransformEntity(this.mesh, { parent });
    this.entity.addComponent(TableHandle, { kind, key });
    this.entity.addComponent(OneHandGrabbable, {
      translate: true,
      rotate: true,
      // Level at all times: turn only around the vertical, never below the cloth.
      rotateMin: [0, -Infinity, 0],
      rotateMax: [0, Infinity, 0],
      translateMin: [-Infinity, 0, -Infinity],
    });
  }

  get held(): boolean {
    return this.entity.hasComponent(Grabbed);
  }

  /** Turning off hides the target from every pointer and drops any grab in progress. */
  setEnabled(on: boolean): void {
    if (on === this.enabled) return;
    this.enabled = on;
    this.mesh.visible = on;
    if (!on && this.held) this.world.getSystem(GrabSystem)?.forceRelease(this.entity);
  }

  get isEnabled(): boolean {
    return this.enabled;
  }

  /** Put the handle on the object (call while it isn't held). */
  syncFrom(object: Object3D): void {
    this.mesh.position.copy(object.position);
    this.mesh.position.y += this.lift;
    this.mesh.quaternion.copy(object.quaternion);
  }

  /** Move the object to the handle (call every frame while held). */
  readInto(object: Object3D): void {
    object.position.copy(this.mesh.position);
    object.position.y -= this.lift;
    object.quaternion.copy(this.mesh.quaternion);
  }

  /** Remember where and when the grab started, for telling taps from drags. */
  markGrabStart(time: number): void {
    this.grabTime = time;
    this.grabPosition.copy(this.mesh.position);
  }

  /** True when the grab that just ended was quick and still enough to count as a tap. */
  wasTap(time: number): boolean {
    return isGrabTap(time - this.grabTime, this.mesh.position.distanceTo(this.grabPosition));
  }

  dispose(): void {
    this.setEnabled(false);
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
    this.entity.destroy();
  }
}
