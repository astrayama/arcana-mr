/**
 * Reads what each hand is doing, once per frame: whether it's pinching (hand
 * pinch or controller trigger) or making a fist (curled hand or controller
 * grip), where the pinch and palm are, and the pose a held object should
 * follow. Table grabs are built on this, instead of IWSDK's grab pointer,
 * because IWSDK can't tell a pinch from a fist.
 */

import { Matrix4, Vector3, type World } from '@iwsdk/core';
import { config } from '../config.js';
import { createFistDetector, FIST_JOINTS, fingerRatios, JOINT, type FistDetector } from '../lib/handPose.js';

export type Hand = 'left' | 'right';
export const HANDS: readonly Hand[] = ['left', 'right'];

export class HandGesture {
  /** Tracked this frame (a controller or hand is connected on this side). */
  connected = false;
  /** A hand (true) or a controller (false). */
  isHand = false;
  pinch = false;
  pinchStarted = false;
  pinchEnded = false;
  fist = false;
  fistStarted = false;
  fistEnded = false;
  /** Where a pinch happens: between thumb and index tips, or the controller's tip. World space. */
  readonly pinchPoint = new Vector3();
  /** The middle of the palm, or the controller's grip. World space. */
  readonly palmPoint = new Vector3();
  /** The pose a held object follows (the grip pose), world space. */
  readonly hold = new Matrix4();
  /** This frame's finger curl ratios (index, middle, ring, little), for tuning. */
  readonly ratios = new Float32Array(4);

  readonly detector: FistDetector = createFistDetector(config.grab.fist);
  /** Hand pinch from the session's select events (real hands have no gamepad). */
  selectHeld = false;
  readonly jointSpaces: XRJointSpace[] = [];
  jointSource: XRInputSource | null = null;
  readonly jointMatrices = new Float32Array(FIST_JOINTS.length * 16);
  readonly jointPositions = new Float32Array(FIST_JOINTS.length * 3);

  constructor(readonly hand: Hand) {}
}

/** Keeps a `HandGesture` per hand up to date. Call `update()` once per frame. */
export class HandGestures {
  readonly left = new HandGesture('left');
  readonly right = new HandGesture('right');
  private session: XRSession | null = null;
  private readonly point = new Vector3();

  private readonly onSelectStart = (event: XRInputSourceEvent) => this.select(event, true);
  private readonly onSelectEnd = (event: XRInputSourceEvent) => this.select(event, false);

  constructor(private readonly world: World) {}

  get(hand: Hand): HandGesture {
    return hand === 'left' ? this.left : this.right;
  }

  update(): void {
    this.watchSession();
    for (const hand of HANDS) this.updateHand(this.get(hand));
  }

  dispose(): void {
    this.watchSession(null);
  }

  private select(event: XRInputSourceEvent, held: boolean): void {
    const source = event.inputSource;
    if (!source.hand || (source.handedness !== 'left' && source.handedness !== 'right')) return;
    this.get(source.handedness).selectHeld = held;
  }

  /** Follow the XR session so hand pinches are heard in every session. */
  private watchSession(next: XRSession | null = this.world.session ?? null): void {
    if (next === this.session) return;
    this.session?.removeEventListener('selectstart', this.onSelectStart);
    this.session?.removeEventListener('selectend', this.onSelectEnd);
    this.session = next;
    this.left.selectHeld = false;
    this.right.selectHeld = false;
    next?.addEventListener('selectstart', this.onSelectStart);
    next?.addEventListener('selectend', this.onSelectEnd);
  }

  private updateHand(g: HandGesture): void {
    const input = this.world.input.xr;
    const player = this.world.player;
    const source = input.getPrimaryInputSource(g.hand);
    const wasPinch = g.pinch;
    const wasFist = g.fist;
    g.connected = !!source;
    g.isHand = !!source?.hand;

    const grip = player.gripSpaces[g.hand];
    grip.updateWorldMatrix(true, false);
    g.hold.copy(grip.matrixWorld);

    if (!source) {
      g.pinch = false;
      g.fist = false;
      g.detector.reset();
    } else if (source.hand) {
      const pad = input.gamepads[g.hand];
      // Same rule as IWSDK: a hand that exposes a gamepad reports select there.
      g.pinch = pad ? pad.getSelecting() : g.selectHeld;
      // A curled hand often hides its own fingers from the cameras; while the
      // joints are lost, keep whatever the hand was doing rather than letting go.
      g.fist = this.readJoints(g, source) ? g.detector.update(g.ratios) : g.detector.active;
      const p = g.jointPositions;
      const thumb = JOINT['thumb-tip'] * 3;
      const index = JOINT['index-finger-tip'] * 3;
      const wrist = JOINT.wrist * 3;
      const knuckle = JOINT['middle-finger-phalanx-proximal'] * 3;
      g.pinchPoint.set((p[thumb] + p[index]) / 2, (p[thumb + 1] + p[index + 1]) / 2, (p[thumb + 2] + p[index + 2]) / 2);
      g.palmPoint.set((p[wrist] + p[knuckle]) / 2, (p[wrist + 1] + p[knuckle + 1]) / 2, (p[wrist + 2] + p[knuckle + 2]) / 2);
    } else {
      const pad = input.gamepads[g.hand];
      g.pinch = !!pad?.getSelecting();
      g.fist = !!pad?.getButtonPressed('xr-standard-squeeze');
      const ray = player.raySpaces[g.hand];
      ray.updateWorldMatrix(true, false);
      g.pinchPoint.setFromMatrixPosition(ray.matrixWorld);
      g.palmPoint.setFromMatrixPosition(grip.matrixWorld);
    }

    // A fist wins: curling the hand around the deck can brush thumb to finger.
    if (g.fist) g.pinch = false;
    g.pinchStarted = g.pinch && !wasPinch;
    g.pinchEnded = !g.pinch && wasPinch;
    g.fistStarted = g.fist && !wasFist;
    g.fistEnded = !g.fist && wasFist;

    if (import.meta.env.DEV && g.isHand && (g.fistStarted || g.fistEnded)) {
      const r = Array.from(g.ratios, (v) => v.toFixed(2)).join(' ');
      console.info(`[arcana] ${g.hand} fist ${g.fist ? 'on' : 'off'} ratios ${r}`);
    }
  }

  /** Read this frame's joint positions (world space) and finger ratios. False if the hand isn't fully tracked. */
  private readJoints(g: HandGesture, source: XRInputSource): boolean {
    const frame = this.world.xrFrame;
    const space = this.world.xrReferenceSpace;
    const hand = source.hand;
    if (!frame || !space || !hand) return false;
    if (g.jointSource !== source) {
      g.jointSource = source;
      g.jointSpaces.length = 0;
      for (const name of FIST_JOINTS) {
        const joint = hand.get(name);
        if (joint) g.jointSpaces.push(joint);
      }
    }
    if (g.jointSpaces.length !== FIST_JOINTS.length || !this.fillPoses(frame, g, space)) return false;

    // Joint poses are in the reference space, which the player rig maps into the world.
    const player = this.world.player;
    player.updateWorldMatrix(true, false);
    for (let i = 0; i < FIST_JOINTS.length; i++) {
      const m = g.jointMatrices;
      this.point.set(m[i * 16 + 12], m[i * 16 + 13], m[i * 16 + 14]).applyMatrix4(player.matrixWorld);
      g.jointPositions[i * 3] = this.point.x;
      g.jointPositions[i * 3 + 1] = this.point.y;
      g.jointPositions[i * 3 + 2] = this.point.z;
    }
    fingerRatios(g.jointPositions, g.ratios);
    return true;
  }

  private fillPoses(frame: XRFrame, g: HandGesture, space: XRReferenceSpace): boolean {
    const fill = (
      frame as XRFrame & {
        fillPoses?: (spaces: XRSpace[], base: XRSpace, transforms: Float32Array) => boolean;
      }
    ).fillPoses;
    if (fill) return fill.call(frame, g.jointSpaces, space, g.jointMatrices);
    for (let i = 0; i < g.jointSpaces.length; i++) {
      const pose = frame.getJointPose?.(g.jointSpaces[i], space);
      if (!pose) return false;
      g.jointMatrices.set(pose.transform.matrix, i * 16);
    }
    return true;
  }
}
