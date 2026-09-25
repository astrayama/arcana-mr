import { createSystem, Quaternion, Vector3, VisibilityState } from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { ReadingMat } from '../components/table.js';

/**
 * Puts the reading mat in the room. For now this always uses the head-relative
 * fallback; table detection and nudging arrive with the placement checkpoint.
 */
export class PlacementSystem extends createSystem({
  mats: { required: [ReadingMat] },
}) {
  private pending = false;
  private readonly head = new Vector3();
  private readonly headQuat = new Quaternion();
  private readonly forward = new Vector3();

  init(): void {
    this.cleanupFuncs.push(
      this.world.visibilityState.subscribe((state) => {
        if (state === VisibilityState.Visible && app.machine.state === 'PLACING') {
          this.pending = true;
        }
      }),
      app.machine.subscribe((snapshot, event) => {
        if (event.type === 'REPLACE_MAT' && snapshot.state === 'PLACING') {
          this.pending = true;
        }
      }),
    );
  }

  update(): void {
    if (!this.pending) return;
    const mat = this.queries.mats.entities.values().next().value;
    if (!mat?.object3D) return;

    this.player.head.getWorldPosition(this.head);
    // Wait for a real head pose before placing anything.
    if (this.head.lengthSq() === 0) return;

    this.player.head.getWorldQuaternion(this.headQuat);
    this.forward.set(0, 0, -1).applyQuaternion(this.headQuat);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();

    const { belowEyeM, forwardM } = config.placement.fallback;
    const object = mat.object3D;
    object.position.set(
      this.head.x + this.forward.x * forwardM,
      this.head.y - belowEyeM,
      this.head.z + this.forward.z * forwardM,
    );
    // Turn the mat so its near edge (+Z) faces the reader.
    object.rotation.set(0, Math.atan2(-this.forward.x, -this.forward.z), 0);
    object.visible = true;

    this.pending = false;
    app.machine.send({ type: 'MAT_PLACED' });
  }
}
