/**
 * Procedural course generator. Builds the course in a canonical frame (flow toward +y)
 * and rotates everything at the end to match the configured gravity direction.
 * Deterministic for (config, seed); only uses the seeded Rng.
 */
import type { GameConfig } from '../core/config';
import { DEG, cumulativeLengths, dirFromAngle, rotate } from '../core/math';
import { Rng } from '../core/rng';
import type { LocalShape, MapDef, Mechanism, StaticShape, Vec } from '../core/types';
import { LIBRARY, maybeSwitch, type SegmentDef } from './segments';
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

function pickSegment(ctx: Ctx, prev: string | null, first: boolean): SegmentDef {
  let cands = LIBRARY.filter((d) => d.available(ctx) && d.type !== prev);
  if (first) {
    const soft = cands.filter((d) => d.type === 'zigzag' || d.type === 'funnel' || d.type === 'pegs');
    if (soft.length) cands = soft;
  }
  if (cands.length === 0) cands = LIBRARY.filter((d) => d.type === 'zigzag');
  return ctx.rng.weighted(cands, cands.map((d) => d.weight));
}

function mechReach(m: Mechanism): number {
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

export function generateMap(config: GameConfig, seed: number): MapDef {
  const rng = new Rng(seed);
  const ctx = makeCtx(config, rng);
  const start = buildStart(ctx);
  const marks: { type: string; idx: number }[] = [{ type: 'start', idx: 0 }];
  extend(ctx, ctx.y + 1.5);
  ctx.y += 0;

  let prev: string | null = null;
  const nSeg = Math.max(0, Math.floor(config.map.segments));
  for (let i = 0; i < nSeg; i++) {
    const def = pickSegment(ctx, prev, i === 0);
    marks.push({ type: def.type, idx: ctx.path.length - 1 });
    ctx.ramps = [];
    def.run(ctx);
    if (!def.ownSwitch) maybeSwitch(ctx, false);
    prev = def.type;
    if (i < nSeg - 1 && rng.bool(0.5)) {
      let dx = rng.range(2, 4.5) * rng.sign();
      if (Math.abs(ctx.cx + dx) > 6) dx = -dx;
      chicane(ctx, dx);
    }
  }
  marks.push({ type: 'finish', idx: ctx.path.length - 1 });
  const finish = buildFinish(ctx);
  const endIdx = ctx.path.length - 1;
  const bottomY = ctx.left[ctx.left.length - 1].y;

  // boundary chain: left (down), floor, right (up), lid back to start
  const chain: Vec[] = [...ctx.left, ...[...ctx.right].reverse(), ctx.left[0]];
  void bottomY;
  const CH = 10;
  for (let i = 0; i < chain.length - 1; i += CH - 1) {
    const pts = chain.slice(i, Math.min(chain.length, i + CH));
    if (pts.length < 2) break;
    ctx.walls.push({
      id: nid(ctx, 'b'),
      shape: { type: 'polyline', points: pts, thickness: BOUNDARY_THICK },
      reaction: 'solid',
      boundary: true,
      style: 'wall',
    });
  }

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
    start: { spawnPoints, area: start.area.map(rp) },
    finish: { a: rp(finish.a), b: rp(finish.b), sensor: finish.sensor.map(rp) },
    segments,
    theme: THEMES[Math.floor(rng.next() * THEMES.length)],
  };
}
