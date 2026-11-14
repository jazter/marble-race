import type { Vec } from './types';

export const DEG = Math.PI / 180;

export const v = (x: number, y: number): Vec => ({ x, y });
export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec, b: Vec): Vec => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec, s: number): Vec => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec, b: Vec): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec, b: Vec): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec): number => Math.hypot(a.x, a.y);
export const dist = (a: Vec, b: Vec): number => Math.hypot(a.x - b.x, a.y - b.y);
export const norm = (a: Vec): Vec => {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-12 ? { x: a.x / l, y: a.y / l } : { x: 0, y: 0 };
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpVec = (a: Vec, b: Vec, t: number): Vec => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);

/** Rotate `p` by `angle` radians around `origin` (default 0,0). */
export function rotate(p: Vec, angle: number, origin: Vec = { x: 0, y: 0 }): Vec {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const dx = p.x - origin.x;
  const dy = p.y - origin.y;
  return { x: origin.x + dx * c - dy * s, y: origin.y + dx * s + dy * c };
}

/**
 * Unit vector for a "direction angle" in degrees: 0 = down (+y), 90 = right (+x),
 * -90 = left, 180 = up. Used for gravity and wind.
 */
export function dirFromAngle(deg: number): Vec {
  const r = deg * DEG;
  return { x: Math.sin(r), y: Math.cos(r) };
}

/** Inverse of dirFromAngle. */
export function angleFromDir(d: Vec): number {
  return Math.atan2(d.x, d.y) / DEG;
}

/** Closest point on segment ab to p, with parameter t in [0,1]. */
export function closestOnSegment(p: Vec, a: Vec, b: Vec): { point: Vec; t: number } {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 > 0 ? clamp(dot(sub(p, a), ab) / l2, 0, 1) : 0;
  return { point: { x: a.x + ab.x * t, y: a.y + ab.y * t }, t };
}

/** Cumulative arc lengths of a polyline (same length as points, first = 0). */
export function cumulativeLengths(points: Vec[]): number[] {
  const out = [0];
  for (let i = 1; i < points.length; i++) out.push(out[i - 1] + dist(points[i - 1], points[i]));
  return out;
}

/** Point at arc length `s` along a polyline (clamped). `cum` from cumulativeLengths. */
export function pointAtLength(points: Vec[], cum: number[], s: number): Vec {
  if (points.length === 0) return { x: 0, y: 0 };
  if (s <= 0) return { ...points[0] };
  const total = cum[cum.length - 1];
  if (s >= total) return { ...points[points.length - 1] };
  let lo = 0;
  let hi = cum.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const segLen = cum[hi] - cum[lo];
  const t = segLen > 0 ? (s - cum[lo]) / segLen : 0;
  return lerpVec(points[lo], points[hi], t);
}

/** Signed area (positive = counter-clockwise in y-up math coordinates). */
export function polygonArea(points: Vec[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    a += p.x * q.y - q.x * p.y;
  }
  return a / 2;
}

export function pointInPolygon(p: Vec, poly: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
