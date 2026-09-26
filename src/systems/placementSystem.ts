import {
  createSystem,
  PanelDocument,
  Quaternion,
  Vector3,
  VisibilityState,
  XRAnchor,
  XRMesh,
  XRPlane,
  type Entity,
  type Object3D,
} from '@iwsdk/core';
import { app } from '../app/context.js';
import { config } from '../config.js';
import { UiPanel } from '../components/ui.js';
import {
  fallbackPose,
  pickTable,
  placeMatOnSurface,
  TABLE_LABELS,
  type MatPose,
  type SurfaceRect,
} from '../placement/tableMath.js';
import placementTemplate from '../ui/placement.uikitml?raw';
import { bindClicks, createPanel, panelDocument, setPanelActive, setText } from '../ui/panels.js';
import { TableSystem } from './tableSystem.js';

/** How long to wait for Space Setup data before settling for what we have. */
const SEARCH_SECONDS = 2.5;
/** How often to re-evaluate surfaces while searching. */
const SEARCH_INTERVAL = 0.25;
const NUDGE_M = 0.03;
const NUDGE_HEIGHT_M = 0.01;
const NUDGE_TURN = Math.PI / 12;
const UP_DOT = 0.9;

export const PLACEMENT_STATUS = {
  searching: 'Looking for your table...',
  table: 'Found your table. Grab the mat to move it, or use the arrows, then tap Looks good.',
  surface: 'Found a flat surface. If it is not your table, grab the mat and slide it, or tap Find my table.',
  fallback:
    "No table found, so the mat is floating in front of you. For a better fit, run Space Setup in your headset's settings, then tap Find my table.",
  adjusting: 'Grab the mat and move it wherever you like, then tap Looks good.',
  moved: 'Tap Looks good when it feels right.',
} as const;

type Mode = 'waiting' | 'searching' | 'adjusting';

/**
 * Puts the reading mat on the reader's real table.
 *
 *   1. A Space Setup table (from scene meshes or plane labels) wins.
 *   2. Otherwise the nearest flat surface at table height that fits the mat.
 *   3. Otherwise the head-relative fallback, with a hint about Space Setup.
 *
 * The reader confirms or nudges it on a small panel. Once confirmed, the mat
 * is anchored so it stays put on the table even if the headset recenters.
 */
export class PlacementSystem extends createSystem({
  planes: { required: [XRPlane] },
  meshes: { required: [XRMesh] },
  panels: { required: [UiPanel, PanelDocument] },
}) {
  mode: Mode = 'waiting';
  private searchElapsed = 0;
  private sinceLastLook = 0;
  private mat!: Object3D;
  private matEntity!: Entity;
  private panel!: Entity;
  private status: string = PLACEMENT_STATUS.searching;
  private forceFallback = false;

  private readonly head = new Vector3();
  private readonly headQuat = new Quaternion();
  private readonly forward = new Vector3();
  private readonly tmpVec = new Vector3();
  private readonly tmpQuat = new Quaternion();
  private readonly parentQuat = new Quaternion();
  private readonly worldPos = new Vector3();
  private readonly axis = new Vector3();
  private readonly yAxis = new Vector3(0, 1, 0);
  private readonly rects: SurfaceRect[] = [];
  private readonly points: Vector3[] = [];

  init(): void {
    const table = this.world.getSystem(TableSystem)!;
    this.matEntity = table.mat;
    this.mat = table.mat.object3D!;
    this.forceFallback =
      new URLSearchParams(window.location.search).get(config.urlParams.placement) === 'fallback';

    const { matDepthM } = config.layout;
    this.panel = createPanel(this.world, {
      kind: 'placement',
      template: placementTemplate,
      parent: this.matEntity,
      name: 'PlacementPanel',
      scale: config.ui.panelScale,
    });
    // Stand the panel just past the far edge of the mat, tipped back toward the reader.
    // High enough that its bottom buttons sit well clear of the table.
    this.panel.object3D!.position.set(0, 0.27, -matDepthM / 2 - 0.05);
    this.panel.object3D!.rotation.x = -0.35;

    this.cleanupFuncs.push(
      this.queries.panels.subscribe('qualify', (entity) => {
        if (entity === this.panel) this.wirePanel();
      }),
      this.world.visibilityState.subscribe((state) => {
        if (state === VisibilityState.Visible && app.machine.state === 'PLACING' && this.mode === 'waiting') {
          this.startSearch();
        }
      }),
      app.machine.subscribe((snapshot, event) => {
        if (event.type === 'REPLACE_MAT') {
          this.mode = 'adjusting';
          this.setStatus(PLACEMENT_STATUS.adjusting);
          setPanelActive(this.panel, true);
        }
        if (snapshot.state !== 'PLACING') {
          setPanelActive(this.panel, false);
        }
      }),
    );
  }

  update(delta: number): void {
    if (this.mode !== 'searching') return;
    if (!this.readHead()) return;

    if (!this.mat.visible) {
      // Show something right away; move it once a table turns up.
      this.applyPose(fallbackPose(this.head, this.forward.x, this.forward.z, config.placement.fallback));
      this.mat.visible = true;
      setPanelActive(this.panel, true);
    }

    this.searchElapsed += delta;
    this.sinceLastLook += delta;
    if (this.sinceLastLook < SEARCH_INTERVAL && this.searchElapsed < SEARCH_SECONDS) return;
    this.sinceLastLook = 0;

    const best = this.forceFallback
      ? null
      : pickTable(this.collectSurfaces(), this.head, {
          heightRange: config.placement.tableHeightRangeM,
          minEdge: config.placement.minTableEdgeM,
          maxDistance: config.placement.maxTableDistanceM,
        });
    const isTable = best !== null && TABLE_LABELS.has(best.label.toLowerCase());

    // Settle as soon as a real table shows up, or when the search window ends.
    if (!isTable && this.searchElapsed < SEARCH_SECONDS) return;

    if (best) {
      const { matWidthM, matDepthM, surfaceOffsetM } = config.layout;
      this.applyPose(
        placeMatOnSurface(best, this.head, {
          width: matWidthM,
          depth: matDepthM,
          margin: 0.04,
          surfaceOffset: surfaceOffsetM,
        }),
      );
      this.setStatus(isTable ? PLACEMENT_STATUS.table : PLACEMENT_STATUS.surface);
      console.info(`[arcana] mat placed on ${best.source} "${best.label || 'unlabeled'}" at ${best.y.toFixed(2)} m`);
    } else {
      this.applyPose(fallbackPose(this.head, this.forward.x, this.forward.z, config.placement.fallback));
      this.setStatus(PLACEMENT_STATUS.fallback);
      console.info('[arcana] no table found; using the fallback mat position');
    }
    this.mode = 'adjusting';
  }

  /** Dev/test helper: what the headset reports and how it reads as surfaces. */
  debugSurfaces(): { planes: unknown[]; meshes: unknown[]; candidates: SurfaceRect[] } {
    const round = (n: number) => Math.round(n * 100) / 100;
    const planes = [...this.queries.planes.entities].map((entity) => {
      const plane = entity.getValue(XRPlane, '_plane') as globalThis.XRPlane & { semanticLabel?: string };
      const p = entity.object3D!.getWorldPosition(new Vector3());
      return { label: plane.semanticLabel ?? '', orientation: plane.orientation, verticalAxis: this.verticalAxis(entity.object3D!), at: [p.x, p.y, p.z].map(round) };
    });
    const meshes = [...this.queries.meshes.entities].map((entity) => ({
      label: entity.getValue(XRMesh, 'semanticLabel'),
      bounded: entity.getValue(XRMesh, 'isBounded3D'),
      verticalAxis: this.verticalAxis(entity.object3D!),
      min: [...entity.getVectorView(XRMesh, 'min')].map(round),
      max: [...entity.getVectorView(XRMesh, 'max')].map(round),
    }));
    return { planes, meshes, candidates: [...this.collectSurfaces()] };
  }

  private startSearch(): void {
    this.mode = 'searching';
    this.searchElapsed = 0;
    this.sinceLastLook = SEARCH_INTERVAL;
    this.setStatus(PLACEMENT_STATUS.searching);
  }

  /** Read the head pose and a level forward direction. False until tracking has a pose. */
  private readHead(): boolean {
    this.player.head.getWorldPosition(this.head);
    if (this.head.lengthSq() === 0) return false;
    this.player.head.getWorldQuaternion(this.headQuat);
    this.forward.set(0, 0, -1).applyQuaternion(this.headQuat);
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, -1);
    this.forward.normalize();
    return true;
  }

  /**
   * Turn detected planes and Space Setup meshes into candidate rectangles.
   * Platforms disagree on axis conventions (plane normals can point either way,
   * and scene meshes may stand on local Z instead of Y), so this works from
   * whichever local axis is vertical and measures footprints in world space.
   */
  collectSurfaces(): SurfaceRect[] {
    this.rects.length = 0;

    for (const entity of this.queries.planes.entities) {
      const plane = entity.getValue(XRPlane, '_plane') as
        | (globalThis.XRPlane & { semanticLabel?: string })
        | undefined;
      const object = entity.object3D;
      if (!plane || !object || plane.orientation !== 'horizontal') continue;
      if (this.verticalAxis(object) < 0) continue;
      object.updateWorldMatrix(true, false);
      this.points.length = 0;
      for (const point of plane.polygon) {
        this.points.push(object.localToWorld(new Vector3(point.x, point.y, point.z)));
      }
      this.pushFootprint(object, this.points, plane.semanticLabel ?? '', 'plane');
    }

    for (const entity of this.queries.meshes.entities) {
      const label = String(entity.getValue(XRMesh, 'semanticLabel') ?? '');
      const object = entity.object3D;
      if (!object || !entity.getValue(XRMesh, 'isBounded3D')) continue;
      if (!TABLE_LABELS.has(label.toLowerCase())) continue;
      const up = this.verticalAxis(object);
      if (up < 0) continue;
      const min = entity.getVectorView(XRMesh, 'min');
      const max = entity.getVectorView(XRMesh, 'max');
      object.updateWorldMatrix(true, false);
      // The four corners of whichever end of the box is higher in the world.
      this.points.length = 0;
      let topY = -Infinity;
      for (const end of [min[up], max[up]]) {
        const corners: Vector3[] = [];
        for (const a of [0, 1]) {
          for (const b of [0, 1]) {
            const local = [0, 0, 0];
            const [i, j] = [0, 1, 2].filter((k) => k !== up);
            local[i] = a ? max[i] : min[i];
            local[j] = b ? max[j] : min[j];
            local[up] = end;
            corners.push(object.localToWorld(new Vector3(local[0], local[1], local[2])));
          }
        }
        const y = corners.reduce((sum, c) => sum + c.y, 0) / corners.length;
        if (y > topY) {
          topY = y;
          this.points.splice(0, this.points.length, ...corners);
        }
      }
      this.pushFootprint(object, this.points, label, 'mesh');
    }

    return this.rects;
  }

  /** Index (0 = X, 1 = Y, 2 = Z) of the object's local axis that is vertical in the world, or -1. */
  private verticalAxis(object: Object3D): number {
    object.getWorldQuaternion(this.tmpQuat);
    for (let k = 0; k < 3; k++) {
      this.axis.set(k === 0 ? 1 : 0, k === 1 ? 1 : 0, k === 2 ? 1 : 0).applyQuaternion(this.tmpQuat);
      if (Math.abs(this.axis.dot(this.yAxis)) > UP_DOT) return k;
    }
    return -1;
  }

  /** Fit a rectangle, square to the object's horizontal axes, around world points. */
  private pushFootprint(object: Object3D, points: Vector3[], label: string, source: SurfaceRect['source']): void {
    if (points.length < 3) return;
    const up = this.verticalAxis(object);
    object.getWorldQuaternion(this.tmpQuat);
    // First horizontal local axis, flattened onto the floor plane.
    const k = up === 0 ? 1 : 0;
    this.axis.set(k === 0 ? 1 : 0, k === 1 ? 1 : 0, 0).applyQuaternion(this.tmpQuat);
    this.axis.y = 0;
    this.axis.normalize();
    const yaw = Math.atan2(-this.axis.z, this.axis.x);
    const ex = [Math.cos(yaw), -Math.sin(yaw)];
    const ez = [Math.sin(yaw), Math.cos(yaw)];

    let minU = Infinity;
    let maxU = -Infinity;
    let minV = Infinity;
    let maxV = -Infinity;
    let sumY = 0;
    for (const p of points) {
      const u = p.x * ex[0] + p.z * ex[1];
      const v = p.x * ez[0] + p.z * ez[1];
      minU = Math.min(minU, u);
      maxU = Math.max(maxU, u);
      minV = Math.min(minV, v);
      maxV = Math.max(maxV, v);
      sumY += p.y;
    }
    const cu = (minU + maxU) / 2;
    const cv = (minV + maxV) / 2;
    this.rects.push({
      cx: cu * ex[0] + cv * ez[0],
      cz: cu * ex[1] + cv * ez[1],
      y: sumY / points.length,
      yaw,
      halfW: (maxU - minU) / 2,
      halfD: (maxV - minV) / 2,
      label,
      source,
    });
  }

  /** Set the mat's world pose, whatever it is currently parented to. */
  applyPose(pose: MatPose): void {
    const parent = this.mat.parent;
    this.tmpVec.set(pose.x, pose.y, pose.z);
    this.tmpQuat.setFromAxisAngle(this.yAxis, pose.yaw);
    if (parent) {
      parent.updateWorldMatrix(true, false);
      parent.worldToLocal(this.tmpVec);
      parent.getWorldQuaternion(this.parentQuat);
      this.tmpQuat.premultiply(this.parentQuat.invert());
    }
    this.mat.position.copy(this.tmpVec);
    this.mat.quaternion.copy(this.tmpQuat);
  }

  currentPose(): MatPose {
    const position = this.mat.getWorldPosition(this.worldPos);
    this.mat.getWorldQuaternion(this.tmpQuat);
    this.axis.set(0, 0, 1).applyQuaternion(this.tmpQuat);
    return { x: position.x, y: position.y, z: position.z, yaw: Math.atan2(this.axis.x, this.axis.z) };
  }

  /** Move in the mat's own frame: +x to the reader's right, +z toward the reader. */
  private nudge(dx: number, dz: number, dy = 0, dYaw = 0): void {
    const pose = this.currentPose();
    const c = Math.cos(pose.yaw);
    const s = Math.sin(pose.yaw);
    this.applyPose({
      x: pose.x + dx * c + dz * s,
      y: pose.y + dy,
      z: pose.z - dx * s + dz * c,
      yaw: pose.yaw + dYaw,
    });
  }

  setStatus(text: string): void {
    this.status = text;
    const document = panelDocument(this.panel);
    if (document) setText(document, 'pl-status', text);
  }

  private wirePanel(): void {
    const document = panelDocument(this.panel)!;
    setText(document, 'pl-status', this.status);
    this.cleanupFuncs.push(
      bindClicks(document, {
        'pl-left': () => this.nudge(-NUDGE_M, 0),
        'pl-right': () => this.nudge(NUDGE_M, 0),
        'pl-farther': () => this.nudge(0, -NUDGE_M),
        'pl-closer': () => this.nudge(0, NUDGE_M),
        'pl-turn-left': () => this.nudge(0, 0, 0, NUDGE_TURN),
        'pl-turn-right': () => this.nudge(0, 0, 0, -NUDGE_TURN),
        'pl-lower': () => this.nudge(0, 0, -NUDGE_HEIGHT_M),
        'pl-higher': () => this.nudge(0, 0, NUDGE_HEIGHT_M),
        'pl-find': () => {
          this.forceFallback = false;
          this.startSearch();
        },
        'pl-here': () => {
          if (!this.readHead()) return;
          this.mode = 'adjusting';
          this.applyPose(fallbackPose(this.head, this.forward.x, this.forward.z, config.placement.fallback));
          this.setStatus(PLACEMENT_STATUS.adjusting);
        },
        'pl-confirm': () => this.confirm(),
      }),
    );
  }

  private confirm(): void {
    if (this.mode === 'searching') return;
    // Anchor the mat to the room so it stays on the table if the headset recenters.
    if (!this.matEntity.hasComponent(XRAnchor)) this.matEntity.addComponent(XRAnchor);
    this.mode = 'waiting';
    app.machine.send({ type: 'MAT_PLACED' });
  }
}
