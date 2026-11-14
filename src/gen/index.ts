/**
 * Procedural course generator. Builds the course in a canonical frame (flow toward +y)
 * and rotates everything at the end to match the configured gravity direction.
 * Deterministic for (config, seed); only uses the seeded Rng.
 */
import type { GameConfig, WallReaction } from '../core/config';
import { DEG, cumulativeLengths, dirFromAngle, rotate } from '../core/math';
import { Rng } from '../core/rng';
import type { MapDef, Monster, StaticShape, Vec } from '../core/types';
import { LIBRARY, maybeSwitch, type SegmentDef } from './segments';
import { galtonAvailable, laneLog, lanesAvailable } from './boards';
import {
  MONSTER_SEED_SALT,
  type SegRec,
  buildOctopusArena,
  buildSnakePit,
  makeWorld,
  mechReach,
  monsterY,
  placeMonsters,
  planArenas,
  planKinds,
} from './monsters';
import { BOUNDARY_THICK, type Ctx, chicane, extend, makeCtx, nid, pathTo, addWall } from './util';

const THEMES = [
  { background: '#10131c', wall: '#c9d1e0', accent: '#ffcc33' },
  { background: '#0f1a1a', wall: '#b6d6cf', accent: '#ff6b6b' },
  { background: '#1a1126', wall: '#d4c4ee', accent: '#4de2c5' },
  { background: '#1b1410', wall: '#e3cfae', accent: '#6bc1ff' },
  { background: '#0c1624', wall: '#a9c6e8', accent: '#ff9f43' },
  { background: '#14181f', wall: '#cfd6d3', accent: '#c6ff4d' },
];

function buildStart(ctx: Ctx): { area: Vec[]; spawn: Vec[] } {
  const { cfg, r, hw, cx } = ctx;
  const count = cfg.marbles.count;
  const sp = 2.35 * r;
  const dy = sp * 0.87;
  const usable = 2 * (hw - BOUNDARY_THICK / 2 - r - 0.05);
  const perRow = Math.max(2, Math.floor(usable / sp) + 1);
  const gateY = 0;
  const spawn: Vec[] = [];
  let row = 0;
  while (spawn.length < count) {
    const slots = row % 2 === 0 ? perRow : perRow - 1;
    const n = Math.min(count - spawn.length, slots);
    const y = gateY - r - 0.05 - row * dy;
    const first = Math.floor((slots - n) / 2);
    for (let i = 0; i < n; i++) spawn.push({ x: cx + (first + i - (slots - 1) / 2) * sp, y });
    row++;
  }
  const topY = gateY - r - 0.05 - (row - 1) * dy;
  const lidY = topY - r - 0.6;
  ctx.left.push({ x: cx - hw, y: lidY }, { x: cx - hw, y: gateY + 0.4 });
  ctx.right.push({ x: cx + hw, y: lidY }, { x: cx + hw, y: gateY + 0.4 });
  ctx.gates.push({
    id: 'startGate',
    role: 'start',
    shape: {
      type: 'polygon',
      points: [
        { x: cx - hw, y: gateY },
        { x: cx + hw, y: gateY },
        { x: cx + hw, y: gateY + 0.4 },
        { x: cx - hw, y: gateY + 0.4 },
      ],
    },
  });
  ctx.path.push({ x: cx, y: (lidY + gateY) / 2 });
  pathTo(ctx, cx, gateY + 1.5);
  ctx.y = gateY + 0.4;
  return {
    area: [
      { x: cx - hw, y: lidY },
      { x: cx + hw, y: lidY },
      { x: cx + hw, y: gateY + 0.4 },
      { x: cx - hw, y: gateY + 0.4 },
    ],
    spawn,
  };
}

function buildFinish(ctx: Ctx): MapDef['finish'] {
  const { cx, hw, R, cfg } = ctx;
  const Wn = Math.min(Math.max(5.5, 6.5 * R), ctx.W * 0.7);
  const tan = Math.tan(35 * DEG);
  const top = ctx.y + 1.5;
  const xl = cx - hw - 0.2;
  const xr = cx + hw + 0.2;
  const nl = cx - Wn / 2;
  const nr = cx + Wn / 2;
  const endY = top + (nl - xl) * tan;
  const yf = endY + 0.8;
  const yb = yf + 2.5;
  addWall(ctx, { type: 'polyline', thickness: 0.4, points: [{ x: xl, y: top }, { x: nl, y: endY }, { x: nl, y: yb }] }, 'ramp', { reaction: 'solid' });
  addWall(ctx, { type: 'polyline', thickness: 0.4, points: [{ x: xr, y: top }, { x: nr, y: endY }, { x: nr, y: yb }] }, 'ramp', { reaction: 'solid' });
  const drop = (nl - xl) * 1.3;
  addWall(ctx, { type: 'polyline', thickness: 0.4, points: [{ x: nl, y: yb }, { x: xl, y: yb + drop }] }, 'wall', { reaction: 'solid' });
  addWall(ctx, { type: 'polyline', thickness: 0.4, points: [{ x: nr, y: yb }, { x: xr, y: yb + drop }] }, 'wall', { reaction: 'solid' });
  pathTo(ctx, cx, top);
  pathTo(ctx, cx, yf);
  const area = cfg.marbles.count * (2 * R) * (2 * R) * 1.6;
  const Hb = Math.max(8, area / (ctx.W - BOUNDARY_THICK) + 2);
  extend(ctx, yb + drop + Hb);
  return {
    a: { x: nl, y: yf },
    b: { x: nr, y: yf },
    sensor: [
      { x: nl - 0.1, y: yf - 0.2 },
      { x: nr + 0.1, y: yf - 0.2 },
      { x: nr + 0.1, y: yf + 0.2 },
      { x: nl - 0.1, y: yf + 0.2 },
    ],
  };
}

/** Segment types that reset the "gap side" tracking: something in them redirects the marbles. */
const REDIRECTING = new Set(['funnel', 'pegs', 'propellers', 'arms', 'saws', 'triangles', 'hammers', 'funnelGate', 'rotorChamber', 'galton', 'lanes']);
const SPECIAL = new Set(['galton', 'lanes']);

function pickSegment(ctx: Ctx, prev: string | null, first: boolean, used: Record<string, number>, maxSpecial: number): SegmentDef {
  let cands = LIBRARY.filter((d) => !d.regroup && d.available(ctx) && d.type !== prev && !(SPECIAL.has(d.type) && (used[d.type] ?? 0) >= maxSpecial));
  if (first) {
    const soft = cands.filter((d) => d.type === 'zigzag' || d.type === 'funnel' || d.type === 'pegs');
    if (soft.length) cands = soft;
  }
  if (cands.length === 0) cands = LIBRARY.filter((d) => d.type === 'zigzag');
  return ctx.rng.weighted(cands, cands.map((d) => d.weight));
}

/** 0-based segment indices (never 0) that become regroup segments, spread over the course. */
export function planRegroups(count: number, nSeg: number): Set<number> {
  const k = Math.max(0, Math.min(Math.floor(count), nSeg - 1));
  const out = new Set<number>();
  for (let j = 0; j < k; j++) {
    let idx = Math.round(((j + 1) / (k + 1)) * nSeg);
    idx = Math.min(Math.max(idx, 1), nSeg - 1);
    // resolve collisions: nearest free slot (prefer later)
    for (let d = 0; out.has(idx) && d < nSeg; d++) {
      const c = idx + d;
      const b = idx - d;
      if (c <= nSeg - 1 && !out.has(c)) idx = c;
      else if (b >= 1 && !out.has(b)) idx = b;
    }
    out.add(idx);
  }
  return out;
}

/** Segment index -> 'galton' | 'lanes': one of each (seeded slots, never first, never adjacent to each other, never a regroup). */
export function planSpecials(nSeg: number, regroupAt: Set<number>, rng: Rng, want: ('galton' | 'lanes')[]): Map<number, 'galton' | 'lanes'> {
  const out = new Map<number, 'galton' | 'lanes'>();
  if (nSeg < 6) return out;
  const order = rng.shuffle(want.slice());
  for (const kind of order) {
    const free: number[] = [];
    for (let i = 1; i < nSeg; i++) if (!regroupAt.has(i) && !out.has(i) && ![...out.keys()].some((k) => Math.abs(k - i) <= 1)) free.push(i);
    const pick = free.length ? free[Math.floor(rng.next() * free.length)] : -1;
    if (pick >= 0) out.set(pick, kind);
  }
  return out;
}

function pickRegroup(ctx: Ctx, prev: string | null): SegmentDef | null {
  const c = LIBRARY.filter((d) => d.regroup && d.available(ctx));
  if (c.length === 0) return null;
  const alt = c.filter((d) => d.type !== prev);
  const pool = alt.length ? alt : c;
  return pool[Math.floor(ctx.rng.next() * pool.length)];
}

/**
 * Segments whose outer walls stay lethal with a 'kill' boundary. Ramp-based
 * segments (zigzag, funnel, switch, pads), the start box, chicanes and the
 * finish force marbles to roll along the sides, so with a 'kill' boundary they
 * get protected solid walls; otherwise no marble could ever finish.
 */
const LETHAL_SIDE_SEGMENTS = new Set(['pegs', 'propellers', 'arms', 'saws', 'triangles', 'hammers']);
/** Segments that throw marbles against the sides constantly (least preferred as lethal). */
const BOUNCY_SEGMENTS = new Set(['pegs', 'hammers']);

/**
 * Emit the boundary chain as polyline walls of at most CH points. With
 * `lethalRanges` (only for a 'kill' boundary) edges outside those canonical
 * y-ranges become plain solid walls instead of boundary walls.
 */
function emitBoundary(ctx: Ctx, chain: Vec[], lethalRanges: [number, number][] | null): void {
  const CH = 10;
  const isLethal = (y: number): boolean => !lethalRanges || lethalRanges.some(([y0, y1]) => y > y0 + 1e-6 && y < y1 - 1e-6);
  const edges: { a: Vec; b: Vec; lethal: boolean }[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    const ts = [0, 1];
    if (lethalRanges) {
      for (const [y0, y1] of lethalRanges) {
        for (const yc of [y0, y1]) if ((a.y - yc) * (b.y - yc) < 0) ts.push((yc - a.y) / (b.y - a.y));
      }
      ts.sort((p, q) => p - q);
    }
    for (let k = 0; k < ts.length - 1; k++) {
      if (ts[k + 1] - ts[k] < 1e-9) continue;
      const p = { x: a.x + (b.x - a.x) * ts[k], y: a.y + (b.y - a.y) * ts[k] };
      const q = { x: a.x + (b.x - a.x) * ts[k + 1], y: a.y + (b.y - a.y) * ts[k + 1] };
      edges.push({ a: p, b: q, lethal: isLethal((p.y + q.y) / 2) });
    }
  }
  let i = 0;
  while (i < edges.length) {
    const lethal = edges[i].lethal;
    const pts: Vec[] = [edges[i].a];
    while (i < edges.length && edges[i].lethal === lethal && pts.length < CH) {
      pts.push(edges[i].b);
      i++;
    }
    const shape: StaticShape = { type: 'polyline', points: pts, thickness: BOUNDARY_THICK };
    if (lethal) ctx.walls.push({ id: nid(ctx, 'b'), shape, reaction: 'solid', boundary: true, style: 'wall' });
    else ctx.walls.push({ id: nid(ctx, 'b'), shape, reaction: 'solid', style: 'wall' });
  }
}

/** Canonical-frame y-ranges whose outer walls stay plain solid in 'mixed' mode. */
type Range = [number, number];

/**
 * 'mixed' outer walls: the chain is cut into pieces of roughly 4-8 m, each with its own reaction drawn from a
 * separate Rng (so the course itself never depends on the boundary mode). Never kill; launch pieces push along the
 * flow tilted toward the centre; the start box, finish, regroups, galton and lanes stay solid.
 */
function emitMixed(ctx: Ctx, chain: Vec[], protect: Range[], rng: Rng): void {
  const L = ctx.left.length;
  const sp = ctx.cfg.walls.special;
  const ok: Record<'bounce' | 'slow' | 'launch', boolean> = { bounce: sp.bounce, slow: sp.slow, launch: sp.launch };
  // y where ramps hang from each wall (a slow piece there would hold marbles back)
  const attachYs: Record<'left' | 'right', number[]> = { left: [], right: [] };
  const xAt = (arr: Vec[], y: number): number => {
    if (y <= arr[0].y) return arr[0].x;
    for (let i = 0; i < arr.length - 1; i++) if (y <= arr[i + 1].y) return arr[i + 1].y - arr[i].y < 1e-9 ? arr[i + 1].x : arr[i].x + ((arr[i + 1].x - arr[i].x) * (y - arr[i].y)) / (arr[i + 1].y - arr[i].y);
    return arr[arr.length - 1].x;
  };
  for (const w of ctx.walls) {
    if (w.style !== 'ramp' || w.shape.type !== 'polyline') continue;
    for (const p of w.shape.points) {
      if (Math.abs(p.x - xAt(ctx.left, p.y)) < 0.6) attachYs.left.push(p.y);
      else if (Math.abs(p.x - xAt(ctx.right, p.y)) < 0.6) attachYs.right.push(p.y);
    }
  }
  const isProt = (y: number): boolean => protect.some(([a, b]) => y > a - 1e-6 && y < b + 1e-6);
  type Sub = { a: Vec; b: Vec; side: 'left' | 'right' | 'cap'; prot: boolean };
  const subs: Sub[] = [];
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    const side: Sub['side'] = i < L - 1 ? 'left' : i >= L && i < 2 * L - 1 ? 'right' : 'cap';
    const ts = [0, 1];
    for (const [y0, y1] of protect) for (const yc of [y0, y1]) if ((a.y - yc) * (b.y - yc) < 0) ts.push((yc - a.y) / (b.y - a.y));
    ts.sort((p, q) => p - q);
    for (let k = 0; k < ts.length - 1; k++) {
      if (ts[k + 1] - ts[k] < 1e-9) continue;
      const pa = { x: a.x + (b.x - a.x) * ts[k], y: a.y + (b.y - a.y) * ts[k] };
      const pb = { x: a.x + (b.x - a.x) * ts[k + 1], y: a.y + (b.y - a.y) * ts[k + 1] };
      const n = Math.max(1, Math.ceil(Math.hypot(pb.x - pa.x, pb.y - pa.y) / 2));
      for (let q = 0; q < n; q++) {
        const f0 = q / n;
        const f1 = (q + 1) / n;
        const qa = { x: pa.x + (pb.x - pa.x) * f0, y: pa.y + (pb.y - pa.y) * f0 };
        const qb = { x: pa.x + (pb.x - pa.x) * f1, y: pa.y + (pb.y - pa.y) * f1 };
        subs.push({ a: qa, b: qb, side, prot: side === 'cap' || isProt((qa.y + qb.y) / 2) });
      }
    }
  }
  const tilt = 25 * DEG;
  const last: Record<string, { r: WallReaction; sinceSlow: number }> = {
    left: { r: 'solid', sinceSlow: 9 },
    right: { r: 'solid', sinceSlow: 9 },
  };
  let i = 0;
  while (i < subs.length) {
    const first = subs[i];
    const pts: Vec[] = [first.a];
    let len = 0;
    const target = rng.range(3.5, 6.5);
    const roll = rng.next();
    while (i < subs.length && subs[i].side === first.side && subs[i].prot === first.prot && (len < target || pts.length < 2) && pts.length < 10) {
      pts.push(subs[i].b);
      len += Math.hypot(subs[i].b.x - subs[i].a.x, subs[i].b.y - subs[i].a.y);
      i++;
    }
    let reaction: WallReaction = 'solid';
    let launchDir: Vec | undefined;
    if (first.prot) {
      if (first.side !== 'cap') last[first.side] = { r: 'solid', sinceSlow: 9 };
    } else {
      const st = last[first.side];
      let want: WallReaction = roll < 0.45 ? 'solid' : roll < 0.75 ? 'bounce' : roll < 0.9 ? 'slow' : 'launch';
      if (want !== 'solid' && !ok[want]) want = 'solid';
      const y0 = Math.min(...pts.map((p) => p.y)) - 1.5;
      const y1 = Math.max(...pts.map((p) => p.y)) + 1.5;
      if (want === 'slow' && (st.sinceSlow < 3 || st.r === 'launch' || attachYs[first.side as 'left' | 'right'].some((y) => y > y0 && y < y1))) want = 'solid';
      if (want === 'launch' && (st.r === 'launch' || st.r === 'slow')) want = 'solid';
      reaction = want;
      st.sinceSlow = want === 'slow' ? 0 : st.sinceSlow + 1;
      st.r = want;
      if (want === 'launch') {
        const inward = first.side === 'left' ? 1 : -1;
        launchDir = { x: Math.sin(tilt) * inward, y: Math.cos(tilt) };
      }
    }
    const shape: StaticShape = { type: 'polyline', points: pts, thickness: BOUNDARY_THICK };
    ctx.walls.push({ id: nid(ctx, 'b'), shape, reaction, boundary: true, style: 'wall', ...(launchDir ? { launchDir } : {}) });
  }
}

export function generateMap(config: GameConfig, seed: number): MapDef {
  const rng = new Rng(seed);
  laneLog.length = 0;
  const ctx = makeCtx(config, rng);
  const start = buildStart(ctx);
  const marks: { type: string; idx: number }[] = [{ type: 'start', idx: 0 }];
  extend(ctx, ctx.y + 1.5);
  ctx.y += 0;

  let prev: string | null = null;
  /** Canonical y-ranges of obstacle segments that may get lethal outer walls (walls.boundary === 'kill'). */
  const lethalRanges: [number, number, number][] = [];
  const nSeg = Math.max(0, Math.floor(config.map.segments));
  const regroupAt = planRegroups(config.map.regroups ?? 0, nSeg);
  const wantSpecial: ('galton' | 'lanes')[] = [];
  if (galtonAvailable(ctx)) wantSpecial.push('galton');
  if (lanesAvailable(ctx)) wantSpecial.push('lanes');
  const specialAt = planSpecials(nSeg, regroupAt, new Rng((seed ^ 0x47414c54) >>> 0), wantSpecial);
  const usedType: Record<string, number> = {};
  const maxSpecial = nSeg >= 12 ? 2 : 1;
  let lastRegroup: string | null = null;
  // monsters: separate Rng so the rest of the course never depends on monster settings
  const mrng = new Rng((seed ^ MONSTER_SEED_SALT) >>> 0);
  const monsterKinds = planKinds(config, mrng);
  const arenas = planArenas(monsterKinds, nSeg, mrng);
  const segRecs: SegRec[] = [];
  const fixedMonsters: Monster[] = [];
  for (let i = 0; i < nSeg; i++) {
    let def: SegmentDef | null = regroupAt.has(i) ? pickRegroup(ctx, lastRegroup) : null;
    if (def) lastRegroup = def.type;
    else if (specialAt.has(i)) def = LIBRARY.find((d) => d.type === specialAt.get(i)) as SegmentDef;
    else def = pickSegment(ctx, prev, i === 0, usedType, maxSpecial);
    usedType[def.type] = (usedType[def.type] ?? 0) + 1;
    marks.push({ type: def.type, idx: ctx.path.length - 1 });
    ctx.ramps = [];
    const segStartY = ctx.y;
    def.run(ctx);
    if (REDIRECTING.has(def.type)) ctx.lastGap = 0;
    if (!def.ownSwitch) maybeSwitch(ctx, false);
    segRecs.push({ type: def.type, y0: segStartY, y1: ctx.y, regroup: !!def.regroup });
    if (LETHAL_SIDE_SEGMENTS.has(def.type)) lethalRanges.push([segStartY, ctx.y, BOUNCY_SEGMENTS.has(def.type) ? 1 : 0]);
    prev = def.type;
    for (const ak of arenas.get(i) ?? []) {
      marks.push({ type: ak === 'octopus' ? 'octopus' : 'snakePit', idx: ctx.path.length - 1 });
      if (ak === 'octopus') ctx.lastGap = 0;
      if (ak === 'octopus') {
        const o = buildOctopusArena(ctx, mrng, 'mo');
        segRecs.push(o.rec);
        fixedMonsters.push(o.monster);
      } else segRecs.push(buildSnakePit(ctx));
    }
    // chicanes always alternate direction (never two in a row to the same side), within |cx| <= 6
    const doChicane = rng.bool(0.5);
    const mag = rng.range(2, 4.5);
    const sg = rng.sign();
    if (i < nSeg - 1 && doChicane) {
      const dir = ctx.lastChicane !== 0 ? -ctx.lastChicane : sg;
      const dx = Math.min(mag, 6 - dir * ctx.cx);
      if (dx >= 2) {
        chicane(ctx, dir * dx);
        ctx.lastChicane = dir;
      }
    }
  }
  marks.push({ type: 'finish', idx: ctx.path.length - 1 });
  const finishY0 = ctx.y;
  const finish = buildFinish(ctx);
  const endIdx = ctx.path.length - 1;
  let monstersCanon: Monster[] = [];
  if (monsterKinds.length > 0) {
    const world = makeWorld(ctx, ctx.walls, ctx.gates, ctx.mechs, ctx.switches);
    monstersCanon = placeMonsters(ctx, mrng, monsterKinds, segRecs, fixedMonsters, world)
      .sort((a, b) => monsterY(a) - monsterY(b))
      .map((m, k) => ({ ...m, id: `m${k + 1}` }));
  }
  const bottomY = ctx.left[ctx.left.length - 1].y;

  // boundary chain: left (down), floor, right (up), lid back to start
  const chain: Vec[] = [...ctx.left, ...[...ctx.right].reverse(), ctx.left[0]];
  void bottomY;
  let killRanges: [number, number][] | null = null;
  if (config.walls.boundary === 'kill') {
    // Only a few obstacle sections get lethal side walls ("lava" sections); more
    // than that and no marble survives. Separate RNG keeps the rest of the map
    // identical to the same seed with another boundary reaction.
    const krng = new Rng((seed ^ 0x6b1d5a3f) >>> 0);
    const k = Math.min(lethalRanges.length, config.map.difficulty >= 0.75 ? 2 : 1);
    // pegs/hammers bounce marbles sideways all the time: use them last
    const ordered = krng.shuffle([...lethalRanges]).sort((a, b) => a[2] - b[2]);
    killRanges = ordered.slice(0, k).map(([y0, y1]) => [y0, y1] as [number, number]);
  }
  if (config.walls.boundary === 'mixed') {
    const protect: Range[] = [[-Infinity, 2], [finishY0, Infinity]];
    for (const rec of segRecs) if (rec.regroup || rec.type === 'galton' || rec.type === 'lanes') protect.push([rec.y0, rec.y1]);
    emitMixed(ctx, chain, protect, new Rng((seed ^ 0x6d697864) >>> 0));
  } else emitBoundary(ctx, chain, killRanges);

  // segment info
  const cum = cumulativeLengths(ctx.path);
  const segments = marks.map((m, i) => ({
    type: m.type,
    from: cum[m.idx],
    to: cum[i + 1 < marks.length ? marks[i + 1].idx : endIdx],
  }));
  segments[0].to = segments.length > 1 ? segments[1].from : segments[0].to;

  /* ---- rotate to gravity direction ---- */
  const phi = -config.physics.gravityAngle * DEG;
  const rp = (p: Vec): Vec => rotate(p, phi);
  const rshape = (s: StaticShape): StaticShape =>
    s.type === 'circle'
      ? { ...s, center: rp(s.center) }
      : s.type === 'polygon'
        ? { type: 'polygon', points: s.points.map(rp) }
        : { ...s, points: s.points.map(rp) };

  const walls = ctx.walls.map((w) => ({ ...w, shape: rshape(w.shape), ...(w.launchDir ? { launchDir: rotate(w.launchDir, phi) } : {}) }));
  const gates = ctx.gates.map((g) => ({ ...g, shape: rshape(g.shape) }));
  const mechanisms = ctx.mechs.map((m) => {
    const links = m.links.map((l, i) => {
      if (i !== 0) return l;
      const mo = l.motion;
      return { ...l, motion: mo.type === 'rotate' ? { ...mo, phase: mo.phase + phi } : { ...mo, center: mo.center + phi } };
    });
    return { ...m, pivot: rp(m.pivot), links };
  });
  const zones = ctx.zones.map((z) => ({
    ...z,
    shape: z.shape.type === 'circle' ? { ...z.shape, center: rp(z.shape.center) } : { type: 'polygon' as const, points: z.shape.points.map(rp) },
  }));
  const switches = ctx.switches.map((s) => ({ ...s, position: rp(s.position), angle: s.angle + phi }));
  const monsters = monstersCanon.map((m): Monster => {
    switch (m.kind) {
      case 'spider':
        return { ...m, anchor: rp(m.anchor), down: rp(m.down) };
      case 'octopus':
        return { ...m, center: rp(m.center), facing: m.facing + phi };
      case 'fish':
        return { ...m, a: rp(m.a), b: rp(m.b) };
      case 'snake':
        return { ...m, passes: m.passes.map((q) => ({ a: rp(q.a), b: rp(q.b) })) };
    }
  });
  const spawnPoints = start.spawn.map(rp);
  const path = ctx.path.map(rp);

  const all: Vec[] = [...spawnPoints, ...path];
  for (const w of walls) {
    if (w.shape.type === 'circle') all.push({ x: w.shape.center.x - w.shape.radius, y: w.shape.center.y - w.shape.radius }, { x: w.shape.center.x + w.shape.radius, y: w.shape.center.y + w.shape.radius });
    else all.push(...w.shape.points);
  }
  for (const g of gates) if (g.shape.type === 'polygon') all.push(...g.shape.points);
  for (const m of mechanisms) {
    const rr = mechReach(m);
    all.push({ x: m.pivot.x - rr, y: m.pivot.y - rr }, { x: m.pivot.x + rr, y: m.pivot.y + rr });
  }
  for (const z of zones) {
    if (z.shape.type === 'circle') all.push({ x: z.shape.center.x - z.shape.radius, y: z.shape.center.y - z.shape.radius }, { x: z.shape.center.x + z.shape.radius, y: z.shape.center.y + z.shape.radius });
    else all.push(...z.shape.points);
  }
  for (const s of switches) all.push(s.position);
  const margin = 15;
  const bounds = {
    minX: Math.min(...all.map((p) => p.x)) - margin,
    minY: Math.min(...all.map((p) => p.y)) - margin,
    maxX: Math.max(...all.map((p) => p.x)) + margin,
    maxY: Math.max(...all.map((p) => p.y)) + margin,
  };

  return {
    seed,
    bounds,
    path,
    flowDir: dirFromAngle(config.physics.gravityAngle),
    walls,
    gates,
    mechanisms,
    zones,
    switches,
    ...(monsters.length ? { monsters } : {}),
    start: { spawnPoints, area: start.area.map(rp) },
    finish: { a: rp(finish.a), b: rp(finish.b), sensor: finish.sensor.map(rp) },
    segments,
    theme: THEMES[Math.floor(rng.next() * THEMES.length)],
  };
}
