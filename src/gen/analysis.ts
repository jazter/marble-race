/**
 * Geometry-only analysis of a generated map (canonical frame: use gravityAngle 0).
 * Used by tests and scripts/gen-alignment.ts to audit ramp / chicane layout.
 */
import type { MapDef, Vec } from '../core/types';

export interface RampInfo {
  /** ids of the wall pieces forming the ramp */
  ids: string[];
  attach: Vec;
  free: Vec;
  /** Side the ramp's free end points to: the side of the gap (-1 left, +1 right). */
  gap: -1 | 1;
  /** y of the upper / lower end. */
  top: number;
  low: number;
}

export interface Chain {
  left: Vec[];
  right: Vec[];
}

/** Rebuild the left / right boundary centre-lines from the boundary pieces. */
export function boundaryChains(map: MapDef): Chain {
  const pts: Vec[] = [];
  for (const w of map.walls) {
    if (!/^b\d+$/.test(w.id) || w.shape.type !== 'polyline') continue;
    for (const p of w.shape.points) {
      const l = pts[pts.length - 1];
      if (!l || Math.hypot(l.x - p.x, l.y - p.y) > 1e-9) pts.push(p);
    }
  }
  let maxY = -Infinity;
  for (const p of pts) maxY = Math.max(maxY, p.y);
  const i0 = pts.findIndex((p) => p.y >= maxY - 1e-9);
  const left = pts.slice(0, i0 + 1);
  const rest = pts.slice(i0 + 1);
  const j0 = rest.findIndex((p) => p.y >= maxY - 1e-9);
  const right = rest.slice(j0 < 0 ? 0 : j0).reverse();
  // the lid goes back to the start: drop its last points (y decreasing past the start)
  return { left, right };
}

function xAt(chain: Vec[], y: number): number {
  if (chain.length === 0) return 0;
  if (y <= chain[0].y) return chain[0].x;
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    if (y <= b.y) return b.y - a.y < 1e-9 ? b.x : a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
  }
  return chain[chain.length - 1].x;
}

export function extractRamps(map: MapDef): RampInfo[] {
  const ch = boundaryChains(map);
  // merge trapdoor halves (w12a / w12b) back into the original ramp
  const pieces = new Map<string, { pts: Vec[]; id: string }[]>();
  for (const w of map.walls) {
    if (w.boundary || /^b\d+$/.test(w.id) || w.style !== 'ramp' || w.shape.type !== 'polyline' || w.shape.points.length !== 2) continue;
    const base = w.id.replace(/[ab]$/, '');
    const arr = pieces.get(base) ?? [];
    arr.push({ pts: w.shape.points, id: w.id });
    pieces.set(base, arr);
  }
  const out: RampInfo[] = [];
  for (const arr of pieces.values()) {
    const pts = arr.flatMap((a) => a.pts);
    // end points = the two extreme points along the dominant direction
    const sorted = [...pts].sort((p, q) => p.x - q.x);
    const p = sorted[0];
    const q = sorted[sorted.length - 1];
    const len = Math.hypot(q.x - p.x, q.y - p.y);
    if (len < 4) continue;
    const slope = Math.abs(q.y - p.y) / Math.max(1e-9, Math.abs(q.x - p.x));
    if (slope > Math.tan((35 * Math.PI) / 180)) continue;
    const dl = Math.abs(p.x - xAt(ch.left, p.y));
    const dr = Math.abs(q.x - xAt(ch.right, q.y));
    let attach: Vec;
    let free: Vec;
    let gap: -1 | 1;
    if (dl < 0.6 && dr >= 0.6) [attach, free, gap] = [p, q, 1];
    else if (dr < 0.6 && dl >= 0.6) [attach, free, gap] = [q, p, -1];
    else continue;
    out.push({ ids: arr.map((a) => a.id), attach, free, gap, top: Math.min(p.y, q.y), low: Math.max(p.y, q.y) });
  }
  return out.sort((a, b) => a.top - b.top);
}

/** y of interior obstacles that redirect marbles (everything except boundary walls and the ramps themselves). */
function blockerYs(map: MapDef, ramps: RampInfo[]): number[] {
  const rampIds = new Set(ramps.flatMap((r) => r.ids));
  const ys: number[] = [];
  for (const w of map.walls) {
    if (w.boundary || /^b\d+$/.test(w.id) || rampIds.has(w.id)) continue;
    const s = w.shape;
    if (s.type === 'circle') ys.push(s.center.y);
    else {
      let a = Infinity;
      let b = -Infinity;
      for (const p of s.points) (a = Math.min(a, p.y)), (b = Math.max(b, p.y));
      ys.push((a + b) / 2);
    }
  }
  for (const m of map.mechanisms) ys.push(m.pivot.y);
  return ys.sort((a, b) => a - b);
}

export interface AlignmentReport {
  ramps: number;
  /** consecutive ramp pairs with the same gap side and no redirecting obstacle in between */
  aligned: { a: RampInfo; b: RampInfo }[];
  chicanes: number;
  /** consecutive chicanes (in order) that shift to the same side */
  sameDirChicanes: number;
}

export function analyzeAlignment(map: MapDef): AlignmentReport {
  const ramps = extractRamps(map);
  const blockers = blockerYs(map, ramps);
  const aligned: AlignmentReport['aligned'] = [];
  for (let i = 0; i + 1 < ramps.length; i++) {
    const a = ramps[i];
    const b = ramps[i + 1];
    if (a.gap !== b.gap) continue;
    const y0 = a.low;
    const y1 = b.top;
    if (blockers.some((y) => y > y0 + 0.05 && y < y1 - 0.05)) continue;
    aligned.push({ a, b });
  }
  const ch = boundaryChains(map);
  const dirs: number[] = [];
  let cur = 0;
  for (let i = 0; i + 1 < ch.left.length; i++) {
    const dx = ch.left[i + 1].x - ch.left[i].x;
    const d = Math.abs(dx) > 0.3 && ch.left[i + 1].y > ch.left[i].y + 0.5 ? Math.sign(dx) : 0;
    if (d !== 0 && d !== cur) dirs.push(d);
    cur = d;
  }
  let same = 0;
  for (let i = 1; i < dirs.length; i++) if (dirs[i] === dirs[i - 1]) same++;
  return { ramps: ramps.length, aligned, chicanes: dirs.length, sameDirChicanes: same };
}

/** Canonical y-range of every segment (use with gravityAngle 0): arc-length ranges mapped onto the path. */
export function segmentYRanges(map: MapDef): { type: string; y0: number; y1: number }[] {
  const cum: number[] = [0];
  for (let i = 1; i < map.path.length; i++) cum.push(cum[i - 1] + Math.hypot(map.path[i].x - map.path[i - 1].x, map.path[i].y - map.path[i - 1].y));
  const yAt = (s: number): number => {
    for (let i = 0; i < cum.length - 1; i++) if (s <= cum[i + 1]) return map.path[i].y + ((map.path[i + 1].y - map.path[i].y) * (s - cum[i])) / Math.max(1e-9, cum[i + 1] - cum[i]);
    return map.path[map.path.length - 1].y;
  };
  return map.segments.map((s) => ({ type: s.type, y0: yAt(s.from), y1: yAt(s.to) }));
}
