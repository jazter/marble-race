/**
 * Monster placement (canonical frame, flow toward +y). Uses its OWN Rng so the
 * rest of the course is identical whatever the monster settings are.
 *
 * - octopus / snake get dedicated open segments ("octopus", "snakePit") inserted
 *   between the regular ones (they are extra segments: the course gets ~16 / ~12 m longer).
 * - spider / fish are placed afterwards into free space of regular, non-regroup segments.
 */
import type { GameConfig, MonsterKind } from '../core/config';
import { DEG } from '../core/math';
import type { Rng } from '../core/rng';
import type { Gate, LocalShape, Mechanism, Monster, StaticShape, Switch, Vec, Wall } from '../core/types';
import { BH, type Ctx, addWall, extend, innerHalf, pathTo } from './util';

export const MONSTER_KINDS: MonsterKind[] = ['spider', 'octopus', 'fish', 'snake'];
export const MONSTER_SEED_SALT = 0x4d4f4e53;

/** Octopus/snake each add a dedicated segment; spider/fish need a free regular segment (<= one per segment). */
export const ARENA_KINDS: ReadonlySet<MonsterKind> = new Set<MonsterKind>(['octopus', 'snake']);

export interface SegRec {
  type: string;
  y0: number;
  y1: number;
  regroup: boolean;
  arena?: MonsterKind;
}

/* --------------------------------------------------------------- planning */

export function octopusFits(cfg: GameConfig): boolean {
  const R = cfg.marbles.radius * Math.max(1, cfg.marbles.maxScale);
  const inner = cfg.map.width / 2 - BH;
  return inner - 1.2 >= Math.max(3, 4 * R);
}

/** Kinds of the `count` monsters: every enabled kind once before any repeats (shuffled rounds). */
export function planKinds(cfg: GameConfig, rng: Rng): MonsterKind[] {
  const n = Math.max(0, Math.min(8, Math.floor(cfg.monsters.count)));
  let enabled = MONSTER_KINDS.filter((k) => cfg.monsters.kinds[k]);
  if (!octopusFits(cfg)) enabled = enabled.filter((k) => k !== 'octopus');
  const out: MonsterKind[] = [];
  if (enabled.length === 0) return out;
  while (out.length < n) out.push(...rng.shuffle([...enabled]).slice(0, n - out.length));
  return out;
}

/** Loop-segment index -> arena kinds to insert after that segment. */
export function planArenas(kinds: MonsterKind[], nSeg: number, rng: Rng): Map<number, MonsterKind[]> {
  const arenas = kinds.filter((k) => ARENA_KINDS.has(k));
  const out = new Map<number, MonsterKind[]>();
  if (nSeg < 1) return out;
  arenas.forEach((k, j) => {
    // stratified over the course, never after the very first segment unless it is the only one
    const t = (j + 0.25 + rng.next() * 0.5) / arenas.length;
    const idx = Math.min(nSeg - 1, Math.max(nSeg > 2 ? 1 : 0, Math.floor(t * 0.7 * nSeg)));
    out.set(idx, [...(out.get(idx) ?? []), k]);
  });
  return out;
}

/* ------------------------------------------------------------ free space */

export function mechReach(m: Mechanism): number {
  const ext = (s: LocalShape): number => {
    if (s.type === 'circle') return Math.hypot(s.cx, s.cy) + s.r;
    if (s.type === 'box') return Math.hypot(s.cx, s.cy) + Math.hypot(s.hw, s.hh);
    return Math.max(...s.points.map((p) => Math.hypot(p.x, p.y)));
  };
  let total = 0;
  for (const l of m.links) {
    let e = 0;
    for (const s of l.shapes) e = Math.max(e, ext(s));
    if (l.tip) e = Math.max(e, Math.hypot(l.tip.x, l.tip.y));
    total += e;
  }
  return total;
}

function distSeg(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

function pointInPoly(p: Vec, pts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Signed-ish clearance from p to a static shape (negative inside). */
function shapeClear(p: Vec, s: StaticShape): number {
  if (s.type === 'circle') return Math.hypot(p.x - s.center.x, p.y - s.center.y) - s.radius;
  if (s.type === 'polyline') {
    let d = Infinity;
    for (let i = 0; i < s.points.length - 1; i++) d = Math.min(d, distSeg(p, s.points[i], s.points[i + 1]));
    return d - s.thickness / 2;
  }
  if (pointInPoly(p, s.points)) return -1;
  let d = Infinity;
  for (let i = 0; i < s.points.length; i++) d = Math.min(d, distSeg(p, s.points[i], s.points[(i + 1) % s.points.length]));
  return d;
}

export interface World {
  /** x of the boundary centre-lines at canonical y. */
  corridor(y: number): { l: number; r: number };
  /** Distance from p to the nearest obstacle / boundary (interior of the corridor edge included). */
  clear(p: Vec): number;
  /** Like clear() but only against ramps (surfaces marbles roll on). */
  rampClear(p: Vec): number;
}

export function makeWorld(ctx: Ctx, walls: Wall[], gates: Gate[], mechs: Mechanism[], switches: Switch[]): World {
  const items: { minY: number; maxY: number; f: (p: Vec) => number }[] = [];
  const rampItems: typeof items = [];
  const addShape = (s: StaticShape, ramp = false): void => {
    let minY = Infinity;
    let maxY = -Infinity;
    const pad = s.type === 'circle' ? s.radius : s.type === 'polyline' ? s.thickness / 2 : 0;
    const pts = s.type === 'circle' ? [{ x: s.center.x, y: s.center.y }] : s.points;
    for (const q of pts) {
      minY = Math.min(minY, q.y - pad);
      maxY = Math.max(maxY, q.y + pad);
    }
    const it = { minY, maxY, f: (p: Vec) => shapeClear(p, s) };
    items.push(it);
    if (ramp) rampItems.push(it);
  };
  for (const w of walls) addShape(w.shape, w.style === 'ramp');
  for (const g of gates) addShape(g.shape);
  for (const m of mechs) {
    const rr = mechReach(m);
    items.push({ minY: m.pivot.y - rr, maxY: m.pivot.y + rr, f: (p) => Math.hypot(p.x - m.pivot.x, p.y - m.pivot.y) - rr });
  }
  for (const s of switches) {
    const rr = Math.max(s.halfWidth, s.halfHeight) * 1.1;
    items.push({ minY: s.position.y - rr, maxY: s.position.y + rr, f: (p) => Math.hypot(p.x - s.position.x, p.y - s.position.y) - rr });
  }
  const left = ctx.left;
  const right = ctx.right;
  const at = (arr: Vec[], y: number): number => {
    if (y <= arr[0].y) return arr[0].x;
    for (let i = 0; i < arr.length - 1; i++) {
      const a = arr[i];
      const b = arr[i + 1];
      if (y <= b.y) return b.y - a.y < 1e-9 ? b.x : a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
    }
    return arr[arr.length - 1].x;
  };
  const corridor = (y: number): { l: number; r: number } => ({ l: at(left, y), r: at(right, y) });
  const clear = (p: Vec): number => {
    const c = corridor(p.y);
    let d = Math.min(p.x - (c.l + BH), c.r - BH - p.x);
    for (const it of items) {
      if (p.y < it.minY - d || p.y > it.maxY + d) continue;
      d = Math.min(d, it.f(p));
    }
    return d;
  };
  const rampClear = (p: Vec): number => {
    let d = Infinity;
    for (const it of rampItems) {
      if (p.y < it.minY - 20 || p.y > it.maxY + 20) continue;
      d = Math.min(d, it.f(p));
    }
    return d;
  };
  return { corridor, clear, rampClear };
}

/* -------------------------------------------------------------- arenas */

/** Straight open stretch with an octopus in the middle. Uses no Rng draws of the course. */
export function buildOctopusArena(ctx: Ctx, rng: Rng, id: string): { rec: SegRec; monster: Monster } {
  const y0 = ctx.y;
  const maxBody = Math.min(1.5, innerHalf(ctx) - Math.max(3, 4 * ctx.R));
  const bodyRadius = Math.max(1.2, Math.min(rng.range(1.2, 1.5), maxBody));
  const cx = ctx.cx;
  const roofY = y0 + 3.2;
  const centerY = roofY + 1.0 + bodyRadius;
  const span = bodyRadius + 0.9;
  // little "hat" so marbles never rest on top of the head
  addWall(ctx, { type: 'polyline', thickness: 0.3, points: [{ x: cx - span, y: roofY + 1.3 }, { x: cx, y: roofY }, { x: cx + span, y: roofY + 1.3 }] }, 'ramp', { reaction: 'solid' });
  const yEnd = centerY + bodyRadius + 5.5;
  extend(ctx, yEnd);
  pathTo(ctx, cx, yEnd);
  const monster: Monster = {
    id,
    kind: 'octopus',
    center: { x: cx, y: centerY },
    bodyRadius,
    reach: rng.range(4, 5.5),
    tentacles: 8,
    facing: -Math.PI / 2,
    size: 0.35,
  };
  return { rec: { type: 'octopus', y0, y1: ctx.y, regroup: false, arena: 'octopus' }, monster };
}

/** Straight open stretch for the snake lines (placed later in placeSnake). */
export function buildSnakePit(ctx: Ctx): SegRec {
  const y0 = ctx.y;
  extend(ctx, y0 + 12);
  pathTo(ctx, ctx.cx, ctx.y);
  return { type: 'snakePit', y0, y1: ctx.y, regroup: false, arena: 'snake' };
}

/* ------------------------------------------------------------ placement */

function placeSnake(ctx: Ctx, world: World, rec: SegRec, rng: Rng, id: string): Monster | null {
  const size = rng.range(0.4, 0.5);
  const margin = size + ctx.R;
  const n = rng.int(4, 6);
  const base: number[] = [];
  for (let i = 0; i < n; i++) base.push(-60 + (120 * i) / (n - 1) + rng.range(-6, 6));
  const angles = rng.shuffle(base.map((a) => Math.max(-60, Math.min(60, a))));
  const ylo = rec.y0 + 0.8;
  const yhi = rec.y1 - 0.8;
  const mid = { x: world.corridor((ylo + yhi) / 2), y: (ylo + yhi) / 2 };
  const passes: { a: Vec; b: Vec }[] = [];
  for (const deg of angles) {
    const d = { x: Math.cos(deg * DEG), y: Math.sin(deg * DEG) };
    for (let attempt = 0; attempt < 12; attempt++) {
      const cxm = (mid.x.l + mid.x.r) / 2;
      const c = { x: cxm + rng.range(-1.8, 1.8), y: mid.y + rng.range(-1.8, 1.8) };
      if (world.clear(c) < margin) continue;
      const march = (sgn: number): number => {
        let t = 0;
        while (t < 9) {
          const p = { x: c.x + d.x * (t + 0.15) * sgn, y: c.y + d.y * (t + 0.15) * sgn };
          if (p.y < ylo || p.y > yhi || world.clear(p) < margin) break;
          t += 0.15;
        }
        return t;
      };
      const tp = march(1);
      const tm = march(-1);
      if (tp + tm < 4.5) continue;
      passes.push({ a: { x: c.x - d.x * tm, y: c.y - d.y * tm }, b: { x: c.x + d.x * tp, y: c.y + d.y * tp } });
      break;
    }
  }
  if (passes.length < 4) return null;
  return { id, kind: 'snake', passes, length: rng.range(3, 5), speed: rng.range(2.5, 4), rest: rng.range(1, 2.5), phase: rng.range(0, 2), size };
}

function placeSpider(world: World, rec: SegRec, rng: Rng, id: string): Monster | null {
  // The spider drops fast, so it hangs above a ramp where marbles roll / slow down and
  // stops with its body about one marble diameter above that surface.
  const size = rng.range(0.55, 0.7);
  const restLength = rng.range(1, 2);
  const stop = size + 0.9;
  const cands: { p: Vec; len: number }[] = [];
  for (let y = rec.y0 + 0.4; y <= rec.y1 - 2; y += 0.4) {
    const c = world.corridor(y);
    for (let x = c.l + BH + 1.2; x <= c.r - BH - 1.2; x += 0.5) {
      const p = { x, y };
      if (world.clear(p) < size + 0.5) continue;
      let t = 0;
      while (t < 9.5 && world.clear({ x, y: y + t + 0.2 }) >= stop) t += 0.2;
      if (t >= 9.5 || t < restLength + 1.5) continue;
      // the blocker must be a ramp surface (not a peg / rotor)
      if (world.rampClear({ x, y: y + t + 0.2 }) > stop + 0.15) continue;
      cands.push({ p, len: t });
    }
  }
  if (cands.length === 0) return null;
  const good = cands.filter((c) => c.len >= 4);
  const pool = good.length ? good : cands;
  const pick = pool[Math.floor(rng.next() * pool.length)];
  return {
    id,
    kind: 'spider',
    anchor: pick.p,
    down: { x: 0, y: 1 },
    restLength,
    maxLength: pick.len,
    huntWidth: rng.range(1, 1.6),
    size,
  };
}

function placeFish(ctx: Ctx, world: World, rec: SegRec, rng: Rng, id: string): Monster | null {
  const size = rng.range(0.6, 0.8);
  for (const margin of [size + ctx.R, size + ctx.r]) {
    const ys: number[] = [];
    for (let y = rec.y0 + 0.5; y <= rec.y1 - 0.3; y += 0.25) {
      const c = world.corridor(y);
      const ax = c.l + BH + margin + 0.1;
      const bx = c.r - BH - margin - 0.1;
      if (bx - ax < 4) continue;
      let ok = true;
      for (let x = ax; x <= bx + 1e-6 && ok; x += 0.3) ok = world.clear({ x, y }) >= margin - 0.01;
      if (ok && world.clear({ x: bx, y }) >= margin - 0.01) ys.push(y);
    }
    if (ys.length === 0) continue;
    const y = ys[Math.floor(rng.next() * ys.length)];
    const c = world.corridor(y);
    return {
      id,
      kind: 'fish',
      a: { x: c.l + BH + margin + 0.1, y },
      b: { x: c.r - BH - margin - 0.1, y },
      speed: rng.range(3, 5),
      rest: rng.range(1, 2.5),
      phase: rng.range(0, 2),
      size,
    };
  }
  return null;
}

/**
 * Place the spider / fish / snake monsters. `recs` are all segments (canonical y-ranges);
 * `fixed` already holds the octopus monsters built with their arenas.
 */
export function placeMonsters(ctx: Ctx, rng: Rng, kinds: MonsterKind[], recs: SegRec[], fixed: Monster[], world: World): Monster[] {
  const out: Monster[] = [...fixed];
  const free = recs.filter((r) => !r.regroup && !r.arena && r.type !== 'start' && r.type !== 'finish');
  const used = new Set<SegRec>();
  const flexible = kinds.filter((k) => k === 'spider' || k === 'fish');
  let nid = 100;
  flexible.forEach((kind, j) => {
    const target = ((j + 0.5) / flexible.length) * free.length * 0.7;
    const order = free
      .map((r, i) => ({ r, d: Math.abs(i + 0.5 - target) + rng.next() * 0.3 }))
      .filter((o) => !used.has(o.r))
      .sort((a, b) => a.d - b.d);
    for (const { r } of order) {
      const id = `m${nid}`;
      const m = kind === 'spider' ? placeSpider(world, r, rng, id) : placeFish(ctx, world, r, rng, id);
      if (m) {
        used.add(r);
        out.push(m);
        nid++;
        break;
      }
    }
  });
  for (const r of recs) {
    if (r.arena !== 'snake') continue;
    const m = placeSnake(ctx, world, r, rng, `m${nid}`);
    if (m) {
      out.push(m);
      nid++;
    }
  }
  return out;
}

export function monsterY(m: Monster): number {
  switch (m.kind) {
    case 'spider':
      return m.anchor.y;
    case 'octopus':
      return m.center.y;
    case 'fish':
      return m.a.y;
    case 'snake':
      return m.passes[0].a.y;
  }
}
