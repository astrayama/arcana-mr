/**
 * Table finding and mat placement as plain math, independent of Three.js and
 * the ECS so it can be unit tested. World space is the XR local-floor space:
 * meters, +Y up, floor at y = 0.
 */

/** A horizontal rectangle in the room: a table top, desk, or other flat surface. */
export interface SurfaceRect {
  /** Center of the rectangle. */
  cx: number;
  cz: number;
  /** Height of the surface above the floor. */
  y: number;
  /** Rotation about +Y of the rectangle's local X axis, in radians. */
  yaw: number;
  /** Half extents along the rectangle's local X and Z axes. */
  halfW: number;
  halfD: number;
  /** Semantic label from Space Setup, if the platform gave one. */
  label: string;
  /** Where the rectangle came from, for logging and the confirm message. */
  source: 'mesh' | 'plane';
}

export interface MatPose {
  x: number;
  y: number;
  z: number;
  /** Rotation about +Y; the mat's near edge (+Z) faces the reader. */
  yaw: number;
}

export interface Viewer {
  x: number;
  y: number;
  z: number;
}

export interface TableRules {
  /** [min, max] surface height above the floor that counts as a table. */
  heightRange: readonly [number, number];
  /** Smallest surface edge that can hold the mat. */
  minEdge: number;
  /** Surfaces farther than this from the viewer are ignored. */
  maxDistance: number;
}

/** Labels that mean "a table you could read cards on". */
export const TABLE_LABELS = new Set(['table', 'desk']);
/** Labels that are flat and horizontal but never a reading table. */
export const EXCLUDED_LABELS = new Set([
  'floor',
  'ceiling',
  'wall',
  'bed',
  'couch',
  'chair',
  'screen',
  'door frame',
  'window frame',
  'global mesh',
]);

/** Express a world point in the rectangle's local (u along X, v along Z) coordinates. */
function toLocal(rect: SurfaceRect, x: number, z: number): { u: number; v: number } {
  const dx = x - rect.cx;
  const dz = z - rect.cz;
  const c = Math.cos(rect.yaw);
  const s = Math.sin(rect.yaw);
  // Local X axis in world is (cos, -sin) in (x, z) for a rotation about +Y.
  return { u: dx * c - dz * s, v: dx * s + dz * c };
}

function toWorld(rect: SurfaceRect, u: number, v: number): { x: number; z: number } {
  const c = Math.cos(rect.yaw);
  const s = Math.sin(rect.yaw);
  return { x: rect.cx + u * c + v * s, z: rect.cz - u * s + v * c };
}

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Horizontal distance from the viewer to the nearest point of the rectangle. */
export function distanceToRect(rect: SurfaceRect, viewer: Viewer): number {
  const { u, v } = toLocal(rect, viewer.x, viewer.z);
  const du = Math.max(Math.abs(u) - rect.halfW, 0);
  const dv = Math.max(Math.abs(v) - rect.halfD, 0);
  return Math.hypot(du, dv);
}

/**
 * Score a surface as a reading table, or return null if it can't be one.
 * Space Setup tables win outright; after that, closer is better.
 */
export function scoreSurface(rect: SurfaceRect, viewer: Viewer, rules: TableRules): number | null {
  const label = rect.label.toLowerCase();
  if (EXCLUDED_LABELS.has(label)) return null;
  if (rect.y < rules.heightRange[0] || rect.y > rules.heightRange[1]) return null;
  if (Math.min(rect.halfW, rect.halfD) * 2 < rules.minEdge) return null;
  const distance = distanceToRect(rect, viewer);
  if (distance > rules.maxDistance) return null;
  const labelBonus = TABLE_LABELS.has(label) ? 10 : 0;
  return labelBonus - distance;
}

export function pickTable(
  rects: readonly SurfaceRect[],
  viewer: Viewer,
  rules: TableRules,
): SurfaceRect | null {
  let best: SurfaceRect | null = null;
  let bestScore = -Infinity;
  for (const rect of rects) {
    const score = scoreSurface(rect, viewer, rules);
    if (score !== null && score > bestScore) {
      best = rect;
      bestScore = score;
    }
  }
  return best;
}

/**
 * Put the mat on the table at the edge nearest the reader, squared up with the
 * table's sides and turned to face them, and kept on the surface when it fits.
 */
export function placeMatOnSurface(
  rect: SurfaceRect,
  viewer: Viewer,
  mat: { width: number; depth: number; margin: number; surfaceOffset: number },
): MatPose {
  const { u: vu, v: vv } = toLocal(rect, viewer.x, viewer.z);

  // The side of the table the reader is nearest: pick the axis they are farthest out along.
  const outU = Math.abs(vu) - rect.halfW;
  const outV = Math.abs(vv) - rect.halfD;
  const alongU = outU > outV;

  // Start at the nearest edge, then step inward so the mat's near edge sits a margin from it.
  const inset = mat.depth / 2 + mat.margin;
  let u = clamp(vu, -rect.halfW, rect.halfW);
  let v = clamp(vv, -rect.halfD, rect.halfD);
  if (alongU) {
    u = Math.sign(vu || 1) * (rect.halfW - inset);
  } else {
    v = Math.sign(vv || 1) * (rect.halfD - inset);
  }

  // Keep the whole mat on the table when it fits; otherwise center it on that axis.
  const reachU = alongU ? mat.depth / 2 : mat.width / 2;
  const reachV = alongU ? mat.width / 2 : mat.depth / 2;
  u = rect.halfW > reachU ? clamp(u, -rect.halfW + reachU, rect.halfW - reachU) : 0;
  v = rect.halfD > reachV ? clamp(v, -rect.halfD + reachV, rect.halfD - reachV) : 0;

  const center = toWorld(rect, u, v);

  // Face the reader, snapped to whichever table side they are sitting at.
  const facing = Math.atan2(viewer.x - center.x, viewer.z - center.z);
  const yaw = snapYaw(facing, rect.yaw);

  return { x: center.x, y: rect.y + mat.surfaceOffset, z: center.z, yaw };
}

/** Round `yaw` to the nearest of the four directions square to `baseYaw`. */
export function snapYaw(yaw: number, baseYaw: number): number {
  const quarter = Math.PI / 2;
  const snapped = baseYaw + Math.round((yaw - baseYaw) / quarter) * quarter;
  return Math.atan2(Math.sin(snapped), Math.cos(snapped));
}

/** The head-relative fallback when no table is found. */
export function fallbackPose(
  viewer: Viewer,
  forwardX: number,
  forwardZ: number,
  fallback: { belowEyeM: number; forwardM: number },
): MatPose {
  const length = Math.hypot(forwardX, forwardZ) || 1;
  const fx = forwardX / length;
  const fz = forwardZ / length;
  return {
    x: viewer.x + fx * fallback.forwardM,
    y: viewer.y - fallback.belowEyeM,
    z: viewer.z + fz * fallback.forwardM,
    yaw: Math.atan2(-fx, -fz),
  };
}
