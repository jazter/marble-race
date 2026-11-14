/** MapDef -> planck static geometry helpers. */
import { Box, Circle, Polygon, Vec2, type Body, type Shape } from 'planck';
import { polygonArea } from '../core/math';
import type { LocalShape, StaticShape, Vec } from '../core/types';

/** Fixture userData kinds. */
export const K_MARBLE = 0;
export const K_WALL = 1;
export const K_MECH = 2;
export const K_ZONE = 3;
export const K_SWITCH = 4;
export const K_GATE = 5;

export interface FixTag {
  k: number;
  i: number;
}

/** Convex polygon from points (any winding). Returns null if degenerate. */
export function makePolygon(points: Vec[]): Shape | null {
  if (points.length < 3) return null;
  if (Math.abs(polygonArea(points)) < 1e-6) return null;
  return new Polygon(points.slice(0, 12).map((p) => new Vec2(p.x, p.y)));
}

/** Planck shapes for a world-space static shape. */
export function staticShapes(shape: StaticShape): Shape[] {
  const out: Shape[] = [];
  switch (shape.type) {
    case 'circle':
      out.push(new Circle(new Vec2(shape.center.x, shape.center.y), shape.radius));
      break;
    case 'polygon': {
      const p = makePolygon(shape.points);
      if (p) out.push(p);
      break;
    }
    case 'polyline': {
      const pts = shape.points;
      const ht = shape.thickness / 2;
      for (let i = 0; i + 1 < pts.length; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const l = Math.hypot(dx, dy);
        if (l < 1e-6) continue;
        out.push(new Box(l / 2, ht, new Vec2((a.x + b.x) / 2, (a.y + b.y) / 2), Math.atan2(dy, dx)));
        if (i > 0) out.push(new Circle(new Vec2(a.x, a.y), ht));
      }
      break;
    }
  }
  return out;
}

export function localShape(s: LocalShape): Shape | null {
  switch (s.type) {
    case 'box':
      return new Box(s.hw, s.hh, new Vec2(s.cx, s.cy), s.angle);
    case 'circle':
      return new Circle(new Vec2(s.cx, s.cy), s.r);
    case 'polygon':
      return makePolygon(s.points);
  }
}

export function addFixtures(body: Body, shapes: Shape[], opts: { restitution?: number; friction?: number; isSensor?: boolean; userData: FixTag }): void {
  for (const shape of shapes) {
    body.createFixture({
      shape,
      density: 0,
      friction: opts.friction ?? 0.2,
      restitution: opts.restitution ?? 0,
      isSensor: opts.isSensor ?? false,
      userData: opts.userData,
    });
  }
}

export function polygonCentroidRadius(points: Vec[]): { cx: number; cy: number; r: number } {
  let cx = 0;
  let cy = 0;
  for (const p of points) {
    cx += p.x;
    cy += p.y;
  }
  cx /= points.length || 1;
  cy /= points.length || 1;
  let r = 0;
  for (const p of points) r = Math.max(r, Math.hypot(p.x - cx, p.y - cy));
  return { cx, cy, r };
}
