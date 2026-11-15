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

/** Length of the merge funnel at the end of a galton / lanes segment where a spider may hang. */
const SPIDER_TAIL = 11;

export interface SegRec {
  /** spiders placed here must stop above this y (the next segment is a protected board / table) */
  cap?: number;
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
export function buildOctopusArena(ctx: Ctx, rng: Rng, id: string, centring = false): { rec: SegRec; monster: Monster } {
  const y0 = ctx.y;
  if (centring) {
    // V funnel feeding the stream to the middle, so tentacles meet marbles that left a ramp gap hugging a wall
    const O = Math.max(3.2, 5 * ctx.R) + 0.5;
    const top = y0 + 0.5;
    const xl = ctx.cx - ctx.hw - 0.2;
    const xr = ctx.cx + ctx.hw + 0.2;
    const tan = Math.tan(38 * DEG);
    const yl = top + (ctx.cx - O / 2 - xl) * tan;
    const yr = top + (xr - (ctx.cx + O / 2)) * tan;
    const neck = Math.max(yl, yr) + 2;
    addWall(ctx, { type: 'polyline', thickness: 0.4, points: [{ x: xl, y: top }, { x: ctx.cx - O / 2, y: yl }, { x: ctx.cx - O / 2, y: neck }] }, 'ramp', { surface: true, dir: { x: ctx.cx - O / 2 - xl, y: yl - top } });
    addWall(ctx, { type: 'polyline', thickness: 0.4, points: [{ x: xr, y: top }, { x: ctx.cx + O / 2, y: yr }, { x: ctx.cx + O / 2, y: neck }] }, 'ramp', { surface: true, dir: { x: ctx.cx + O / 2 - xr, y: yr - top } });
    extend(ctx, neck + 0.5);
    pathTo(ctx, ctx.cx, ctx.y);
  }
  const yTop = ctx.y;
  const maxBody = Math.min(1.5, innerHalf(ctx) - Math.max(3, 4 * ctx.R));
  const bodyRadius = Math.max(1.2, Math.min(rng.range(1.2, 1.5), maxBody));
  const cx = ctx.cx;
  const roofY = yTop + 3.2;
  const centerY = roofY + 1.0 + bodyRadius;
  const span = bodyRadius + 0.9;
  // Solid "hat" hugging the head so marbles never rest on top of it. It used to be a thin
  // roof with a gap above the head, and a marble could get wedged in that gap, be released
  // and re-grabbed forever. A convex block from the apex down into the body leaves no pocket.
  void span;
  addWall(
    ctx,
    {
      type: 'polygon',
      points: [
        { x: cx, y: roofY },
        { x: cx + bodyRadius * 1.05, y: centerY - bodyRadius * 0.25 },
        { x: cx + bodyRadius * 0.5, y: centerY },
        { x: cx - bodyRadius * 0.5, y: centerY },
        { x: cx - bodyRadius * 1.05, y: centerY - bodyRadius * 0.25 },
      ],
    },
    'ramp',
    { reaction: 'solid' },
  );
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

function placeSnake(ctx: Ctx, world: World, rec: SegRec, rng: Rng, id: string, k = 1): Monster[] {
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
  if (passes.length < 4) return [];
  // nest: every member shares the pit and its passes; phases are spread over the pass + rest cycle
  const rest = rng.range(1, 2.5);
  const speed = rng.range(2.5, 4);
  const length = rng.range(3, 5);
  const phase0 = rng.range(0, 2);
  const cycle = rest + (length + 8) / speed;
  const out: Monster[] = [];
  for (let i = 0; i < k; i++) {
    const v = i === 0 ? 0 : 1;
    out.push({
      id: i === 0 ? id : `${id}${String.fromCharCode(97 + i)}`,
      kind: 'snake',
      passes: passes.map((p) => ({ a: { ...p.a }, b: { ...p.b } })),
      length: length * (1 + v * rng.range(-0.15, 0.15)),
      speed: speed * (1 + v * rng.range(-0.12, 0.12)),
      rest: rest * (1 + v * rng.range(-0.15, 0.15)),
      phase: phase0 + (i * cycle) / k + v * rng.range(0, 0.4),
      size: size * (1 + v * rng.range(-0.1, 0.1)),
    });
  }
  return out;
}

function placeSpider(world: World, rec: SegRec, rng: Rng, id: string, k = 1): Monster[] {
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
      if (rec.cap !== undefined && y + t + 0.2 > rec.cap) continue;
      // the blocker must be a ramp surface (not a peg / rotor)
      if (world.rampClear({ x, y: y + t + 0.2 }) > stop + 0.15) continue;
      cands.push({ p, len: t });
    }
  }
  if (cands.length === 0) return [];
  const good = cands.filter((c) => c.len >= 4);
  const pool = good.length ? good : cands;
  const pick = pool[Math.floor(rng.next() * pool.length)];
  const leader: Monster = {
    id,
    kind: 'spider',
    anchor: pick.p,
    down: { x: 0, y: 1 },
    restLength,
    maxLength: pick.len,
    huntWidth: rng.range(1, 1.6),
    size,
  };
  const out: Monster[] = [leader];
  const hws: number[] = [leader.huntWidth];
  // colony: hang side by side over the same ramp, columns never overlapping
  const picks = [pick];
  for (let i = 1; i < k; i++) {
    const hw = rng.range(1, 1.6);
    const ok = (c: { p: Vec }): boolean => picks.every((q, j) => Math.abs(c.p.x - q.p.x) >= 2 * Math.max(hw, hws[j]) + 0.1);
    const near = cands.filter((c) => ok(c) && Math.abs(c.p.y - pick.p.y) <= 3 && c.len >= 3);
    const alt = near.length ? near : cands.filter((c) => ok(c) && Math.abs(c.p.y - pick.p.y) <= 6);
    if (alt.length === 0) break;
    const c = alt[Math.floor(rng.next() * alt.length)];
    picks.push(c);
    hws.push(hw);
    const rl = Math.min(restLength * rng.range(0.7, 1.3), c.len - 1.5);
    out.push({
      id: `${id}${String.fromCharCode(97 + i)}`,
      kind: 'spider',
      anchor: c.p,
      down: { x: 0, y: 1 },
      restLength: Math.max(0.8, rl),
      maxLength: c.len,
      huntWidth: hw,
      size: size * rng.range(0.88, 1.12),
    });
  }
  return out;
}

function placeFish(ctx: Ctx, world: World, rec: SegRec, rng: Rng, id: string, k = 1): Monster[] {
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
    // prefer leader rows that leave room for the most school lanes
    const laneYs = (y0: number, ax: number, bx: number, d: number): number[] => {
      const res: number[] = [];
      for (let t = 0; res.length < k - 1 && t < 2 * k + 2; t++) {
        const ly = y0 + (t % 2 === 0 ? 1 : -1) * d * Math.ceil((t + 1) / 2);
        if (ly < rec.y0 + 0.3 || ly > rec.y1 - 0.1) continue;
        let fits = world.clear({ x: bx, y: ly }) >= margin - 0.01;
        for (let x = ax; fits && x <= bx + 1e-6; x += 0.3) fits = world.clear({ x, y: ly }) >= margin - 0.01;
        if (fits) res.push(ly);
      }
      return res;
    };
    const d = rng.range(1, 1.3);
    const score = ys.map((yy) => {
      const cc = world.corridor(yy);
      return laneYs(yy, cc.l + BH + margin + 0.1, cc.r - BH - margin - 0.1, d).length;
    });
    const best = Math.max(...score);
    const bestYs = ys.filter((_, i) => score[i] === best);
    const y = bestYs[Math.floor(rng.next() * bestYs.length)];
    const c = world.corridor(y);
    const ax = c.l + BH + margin + 0.1;
    const bx = c.r - BH - margin - 0.1;
    const speed = rng.range(3, 5);
    const rest = rng.range(1, 2.5);
    const phase0 = rng.range(0, 2);
    const out: Monster[] = [{ id, kind: 'fish', a: { x: ax, y }, b: { x: bx, y }, speed, rest, phase: phase0, size }];
    // school: same span / speed / rest, lanes alternating above / below the leader's
    for (const ly of laneYs(y, ax, bx, d)) {
      out.push({
        id: `${id}${String.fromCharCode(96 + out.length)}`,
        kind: 'fish',
        a: { x: ax, y: ly },
        b: { x: bx, y: ly },
        speed,
        rest,
        phase: phase0 + rng.range(0, 0.5),
        size: size * rng.range(0.85, 1.15),
      });
    }
    // Members that found no parallel lane swim in the leader's lane, trailing it with a
    // small sideways jitter (a school passing in a loose file) so narrow rows still get a school.
    const jit = [0.3, -0.3, 0.15, -0.15, 0];
    for (let j = 0; out.length < k && j < k; j++) {
      const ly = y + jit[j % jit.length];
      let fits = world.clear({ x: bx, y: ly }) >= margin - 0.36;
      for (let x = ax; fits && x <= bx + 1e-6; x += 0.3) fits = world.clear({ x, y: ly }) >= margin - 0.36;
      if (!fits) continue;
      out.push({
        id: `${id}${String.fromCharCode(96 + out.length)}`,
        kind: 'fish',
        a: { x: ax, y: ly },
        b: { x: bx, y: ly },
        speed,
        rest,
        phase: phase0 + 0.45 * (j + 1) + rng.range(0, 0.15),
        size: size * rng.range(0.8, 1.05),
      });
    }
    return out;
  }
  return [];
}

/** Members of one spider / fish / snake group: seeded integer in [ceil(g/2), g]. */
export function groupCount(ctx: Ctx, rng: Rng): number {
  const g = Math.max(1, Math.min(6, Math.floor(ctx.cfg.monsters.groupSize ?? 1)));
  return g === 1 ? 1 : rng.int(Math.ceil(g / 2), g);
}

/**
 * Place the spider / fish / snake monsters. `recs` are all segments (canonical y-ranges);
 * `fixed` already holds the octopus monsters built with their arenas.
 */
export function placeMonsters(ctx: Ctx, rng: Rng, kinds: MonsterKind[], recs: SegRec[], fixed: Monster[], world: World): Monster[] {
  const out: Monster[] = [...fixed];
  const free = recs.filter((r) => !r.regroup && !r.arena && r.type !== 'start' && r.type !== 'finish' && r.type !== 'pinball' && r.type !== 'gableSplit');
  // galton / lanes have no free horizontal line (fish) and no room for the others except the merge funnel at their end: a spider may hang there
  const isBoard = (r: SegRec): boolean => r.type === 'galton' || r.type === 'lanes';
  const protectedNext = (r: SegRec): boolean => {
    const n = recs[recs.indexOf(r) + 1];
    return !!n && (n.type === 'galton' || n.type === 'lanes' || n.type === 'pinball' || n.type === 'gableSplit');
  };
  const spiderZone = (r: SegRec): SegRec => {
    const z = isBoard(r) ? { ...r, y0: Math.max(r.y0, r.y1 - SPIDER_TAIL) } : r;
    return protectedNext(r) ? { ...z, cap: r.y1 } : z;
  };
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
      if (kind === 'fish' && isBoard(r)) continue;
      const id = `m${nid}`;
      const k = groupCount(ctx, rng);
      const ms = kind === 'spider' ? placeSpider(world, spiderZone(r), rng, id, k) : placeFish(ctx, world, r, rng, id, k);
      if (ms.length) {
        used.add(r);
        out.push(...ms);
        nid++;
        break;
      }
    }
  });
  for (const r of recs) {
    if (r.arena !== 'snake') continue;
    const ms = placeSnake(ctx, world, r, rng, `m${nid}`, groupCount(ctx, rng));
    if (ms.length) {
      out.push(...ms);
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
