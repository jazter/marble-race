/**
 * Shared build context + helpers for the procedural generator.
 * Everything here works in the CANONICAL frame: the course flows toward +y.
 */
import type { EffectType, GameConfig, MechanismKind, SpecialWallReaction, WallReaction } from '../core/config';
import { clamp, dist, norm, sub } from '../core/math';
import { Rng } from '../core/rng';
import type { Gate, LocalShape, Mechanism, StaticShape, Switch, Vec, Wall, Zone } from '../core/types';

export interface Ramp {
  id: string;
  a: Vec;
  b: Vec;
  thick: number;
}

export interface Ctx {
  cfg: GameConfig;
  rng: Rng;
  /** base marble radius, max marble radius */
  r: number;
  R: number;
  W: number;
  hw: number;
  /** Cursor: current y and centre-line x. */
  y: number;
  cx: number;
  walls: Wall[];
  gates: Gate[];
  mechs: Mechanism[];
  zones: Zone[];
  switches: Switch[];
  left: Vec[];
  right: Vec[];
  path: Vec[];
  /** Ramps created by the segment being built (switch hosts). */
  ramps: Ramp[];
  /**
   * Gap side (-1 left / +1 right) of the last ramp placed anywhere in the course, or 0 when
   * something since then (pegs, funnel, mechanism...) already redirects the marbles. The next
   * ramp attaches to this side so that it catches whatever falls through that gap.
   */
  lastGap: number;
  /** Direction (-1 / +1) of the last chicane, 0 if none yet. */
  lastChicane: number;
  counters: Record<string, number>;
  kills: number;
  /** 'stun' pieces placed so far (capped higher than kills: they don't remove marbles). */
  stuns: number;
  destroys: number;
  /** 0..1 amount of "stuff" per segment. */
  t: number;
  diff: number;
}

export const BOUNDARY_THICK = 0.5;
/** Half thickness of the boundary: usable interior = hw - this. */
export const BH = BOUNDARY_THICK / 2;

export function makeCtx(cfg: GameConfig, rng: Rng): Ctx {
  const r = cfg.marbles.radius;
  const W = cfg.map.width;
  return {
    cfg,
    rng,
    r,
    R: r * Math.max(1, cfg.marbles.maxScale),
    W,
    hw: W / 2,
    y: 0,
    cx: 0,
    walls: [],
    gates: [],
    mechs: [],
    zones: [],
    switches: [],
    left: [],
    right: [],
    path: [],
    ramps: [],
    lastGap: 0,
    lastChicane: 0,
    counters: {},
    kills: 0,
    stuns: 0,
    destroys: 0,
    t: clamp(cfg.objects.density * 0.7 + cfg.map.difficulty * 0.3, 0, 1),
    diff: cfg.map.difficulty,
  };
}

export function nid(ctx: Ctx, prefix: string): string {
  const n = (ctx.counters[prefix] ?? 0) + 1;
  ctx.counters[prefix] = n;
  return `${prefix}${n}`;
}

/** Clearance mechanisms keep from walls / each other. */
export function mechClearance(ctx: Ctx): number {
  return Math.max(1.3, 2.6 * ctx.R);
}

/** Interior half width actually free for marbles. */
export function innerHalf(ctx: Ctx): number {
  return ctx.hw - BH;
}

/* ------------------------------------------------------- boundary / path */

/** Extend both boundary lines straight down to y (cursor moves). */
export function extend(ctx: Ctx, y: number): void {
  const lastY = ctx.left[ctx.left.length - 1].y;
  if (y > lastY + 1e-6) {
    ctx.left.push({ x: ctx.cx - ctx.hw, y });
    ctx.right.push({ x: ctx.cx + ctx.hw, y });
  }
  ctx.y = Math.max(ctx.y, y);
}

/** Add centre-line points toward (x, y), at most ~3 m apart, strictly increasing y. */
export function pathTo(ctx: Ctx, x: number, y: number): void {
  const last = ctx.path[ctx.path.length - 1];
  if (!last) {
    ctx.path.push({ x, y });
    return;
  }
  if (y <= last.y + 1e-4) return;
  const n = Math.max(1, Math.ceil(dist(last, { x, y }) / 3));
  for (let i = 1; i <= n; i++) {
    const t = i / n;
    ctx.path.push({ x: last.x + (x - last.x) * t, y: last.y + (y - last.y) * t });
  }
}

/** Lateral shift of the whole corridor via diagonal boundary pieces. */
export function chicane(ctx: Ctx, dx: number): void {
  const dy = Math.max(3.5, Math.abs(dx) * 1.6);
  extend(ctx, ctx.y);
  const nx = ctx.cx + dx;
  const ny = ctx.y + dy;
  ctx.left.push({ x: nx - ctx.hw, y: ny });
  ctx.right.push({ x: nx + ctx.hw, y: ny });
  pathTo(ctx, nx, ny);
  ctx.cx = nx;
  ctx.y = ny;
}

/* ------------------------------------------------------------- reactions */

/** 'kill' and 'stun' are "harmful": never on surfaces marbles must roll on, and capped per map. */
function enabledSpecials(ctx: Ctx, allowHarm: boolean): SpecialWallReaction[] {
  const sp = ctx.cfg.walls.special;
  const out: SpecialWallReaction[] = [];
  (['bounce', 'slow', 'launch', 'kill', 'stun'] as SpecialWallReaction[]).forEach((k) => {
    if (!sp[k]) return;
    if (k === 'kill' && !(allowHarm && ctx.kills < 3)) return;
    if (k === 'stun' && !(allowHarm && ctx.stuns < 8)) return;
    out.push(k);
  });
  return out;
}

export interface ReactionOpts {
  /** Marbles must roll/land on it: never 'kill' / 'stun'. */
  surface?: boolean;
  /** Preferred launch direction (unit). Default along flow, slightly diagonal. */
  dir?: Vec;
  /** Force a decision roll even if ratio is 0 (never used to bypass config). */
  noSlow?: boolean;
}

/** Decide reaction (+ launchDir) of an interior wall. Always consumes the same rng draws. */
export function pickReaction(ctx: Ctx, opts: ReactionOpts = {}): { reaction: WallReaction; launchDir?: Vec } {
  const rng = ctx.rng;
  const roll = rng.next();
  const pickRoll = rng.next();
  const lateral = rng.range(-0.5, 0.5);
  if (roll >= ctx.cfg.walls.specialRatio) return { reaction: 'solid' };
  let list = enabledSpecials(ctx, !opts.surface);
  if (opts.noSlow || opts.surface) list = list.filter((k) => k !== 'slow');
  if (list.length === 0) return { reaction: 'solid' };
  const choice = list[Math.floor(pickRoll * list.length)];
  if (choice === 'kill') ctx.kills++;
  if (choice === 'stun') ctx.stuns++;
  if (choice === 'launch') {
    const base = opts.dir ?? { x: lateral, y: 1 };
    const d = norm(base);
    // never backwards
    if (d.y < 0.2) return { reaction: 'launch', launchDir: norm({ x: d.x, y: 0.5 }) };
    return { reaction: 'launch', launchDir: d };
  }
  return { reaction: choice };
}

/* ---------------------------------------------------------------- walls */

export function addWall(ctx: Ctx, shape: StaticShape, style: Wall['style'], opts: ReactionOpts & { reaction?: WallReaction } = {}): Wall {
  const rr = opts.reaction ? { reaction: opts.reaction } : pickReaction(ctx, opts);
  const w: Wall = { id: nid(ctx, 'w'), shape, reaction: rr.reaction, style };
  if (rr.launchDir) w.launchDir = rr.launchDir;
  ctx.walls.push(w);
  return w;
}

/**
 * Side (-1 = left wall, +1 = right wall) a new wall-attached ramp should hang from: the gap side of
 * the previous ramp (it catches what falls through that gap), else `fallback`.
 */
export function rampSide(ctx: Ctx, fallback: number): number {
  return ctx.lastGap !== 0 ? ctx.lastGap : fallback;
}

/** Straight ramp wall (never 'kill'). Records its gap side in ctx.lastGap. */
export function addRamp(ctx: Ctx, a: Vec, b: Vec, thick = 0.4): Ramp {
  // the end that is farther from the centre line is attached to the wall; the gap is on the other side
  const attach = Math.abs(a.x - ctx.cx) >= Math.abs(b.x - ctx.cx) ? a : b;
  ctx.lastGap = attach.x < ctx.cx ? 1 : -1;
  const down = b.y >= a.y ? sub(b, a) : sub(a, b);
  const w = addWall(ctx, { type: 'polyline', points: [a, b], thickness: thick }, 'ramp', { surface: true, dir: down });
  const ramp: Ramp = { id: w.id, a, b, thick };
  ctx.ramps.push(ramp);
  return ramp;
}

/** Convert a ramp into piece + trapdoor gate + piece. Returns the gate id. */
export function makeTrapdoor(ctx: Ctx, ramp: Ramp, t0: number, holeLen: number): string {
  const idx = ctx.walls.findIndex((w) => w.id === ramp.id);
  const orig = ctx.walls[idx];
  const L = dist(ramp.a, ramp.b);
  const d = { x: (ramp.b.x - ramp.a.x) / L, y: (ramp.b.y - ramp.a.y) / L };
  const p0 = { x: ramp.a.x + d.x * t0 * L, y: ramp.a.y + d.y * t0 * L };
  const p1 = { x: p0.x + d.x * holeLen, y: p0.y + d.y * holeLen };
  const nrm = { x: -d.y, y: d.x };
  const h = ramp.thick / 2;
  const mk = (a: Vec, b: Vec, suffix: string): Wall => ({
    ...orig,
    id: orig.id + suffix,
    shape: { type: 'polyline', points: [a, b], thickness: ramp.thick },
  });
  const pieces: Wall[] = [mk(ramp.a, p0, 'a'), mk(p1, ramp.b, 'b')];
  ctx.walls.splice(idx, 1, ...pieces);
  const gid = nid(ctx, 'gate');
  ctx.gates.push({
    id: gid,
    role: 'switch',
    shape: {
      type: 'polygon',
      points: [
        { x: p0.x + nrm.x * h, y: p0.y + nrm.y * h },
        { x: p1.x + nrm.x * h, y: p1.y + nrm.y * h },
        { x: p1.x - nrm.x * h, y: p1.y - nrm.y * h },
        { x: p0.x - nrm.x * h, y: p0.y - nrm.y * h },
      ],
    },
  });
  return gid;
}

/* ------------------------------------------------------------ mechanisms */

export function kindEnabled(ctx: Ctx, k: MechanismKind): boolean {
  return ctx.cfg.objects.kinds[k];
}

export function baseSpeed(ctx: Ctx): number {
  return ctx.rng.range(0.8, 2.5) * (0.7 + ctx.diff * 0.6);
}

function enabledEffects(ctx: Ctx): EffectType[] {
  const e = ctx.cfg.objects.effects;
  return (['grow', 'shrink', 'destroy', 'attract', 'repel'] as EffectType[]).filter((k) => e[k]);
}

export function pickEffect(ctx: Ctx, kind: MechanismKind): EffectType | null {
  const rng = ctx.rng;
  const roll = rng.next();
  const pr = rng.next();
  const list = enabledEffects(ctx);
  if (list.length === 0 || roll >= ctx.cfg.objects.effectChance) return null;
  const weights = list.map((e) => (e === 'destroy' ? (kind === 'saw' ? 4 : kind === 'triangle' ? 0.3 : 0.1) : 1));
  let total = 0;
  for (const w of weights) total += w;
  let x = pr * total;
  let pick = list[list.length - 1];
  for (let i = 0; i < list.length; i++) {
    x -= weights[i];
    if (x < 0) {
      pick = list[i];
      break;
    }
  }
  // destroy kills marbles for good: keep it rare so the race stays winnable
  if (pick === 'destroy') {
    if (ctx.destroys >= 2) return null;
    ctx.destroys++;
  }
  return pick;
}

/** Attach the effect (and field data) to a mechanism. `anchor` = local point on the last link. */
export function applyEffect(ctx: Ctx, m: Mechanism, anchor: Vec): void {
  const eff = pickEffect(ctx, m.kind);
  m.effect = eff;
  if (eff === 'attract' || eff === 'repel') {
    m.fieldAnchor = anchor;
    m.fieldRadius = ctx.rng.range(2.5, 4.5);
    m.fieldStrength = eff === 'attract' ? ctx.rng.range(8, 14) : ctx.rng.range(8, 20);
    const last = m.links[m.links.length - 1];
    last.shapes.push({ type: 'circle', cx: anchor.x, cy: anchor.y, r: 0.28 });
  }
}

export function sawShapes(radius: number, teeth: number): LocalShape[] {
  const shapes: LocalShape[] = [{ type: 'circle', cx: 0, cy: 0, r: radius }];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const p = (ang: number, rr: number): Vec => ({ x: Math.cos(ang) * rr, y: Math.sin(ang) * rr });
    shapes.push({
      type: 'polygon',
      points: [p(a - 0.22, radius * 0.95), p(a + 0.22, radius * 0.95), p(a + 0.12, radius * 1.35)],
    });
  }
  return shapes;
}

export function propellerShapes(blades: number, length: number, width: number): LocalShape[] {
  const shapes: LocalShape[] = [{ type: 'circle', cx: 0, cy: 0, r: 0.4 }];
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    shapes.push({
      type: 'box',
      cx: (Math.cos(a) * length) / 2,
      cy: (Math.sin(a) * length) / 2,
      hw: length / 2,
      hh: width / 2,
      angle: a,
    });
  }
  return shapes;
}

/* -------------------------------------------------------- local geometry */

/** Radius available for n sweepers (radius L each) across the interior with clearance c. */
export function maxSweepRadius(ctx: Ctx, n: number): number {
  const c = mechClearance(ctx);
  const A = 2 * innerHalf(ctx);
  return (A - (n + 1) * c) / (2 * n);
}

/** X positions (absolute) for n sweepers of radius L, evenly spread around cx. */
export function sweeperXs(ctx: Ctx, n: number, L: number): number[] {
  const c = mechClearance(ctx);
  const A = 2 * innerHalf(ctx);
  const gap = c + Math.max(0, A - (n * 2 * L + (n + 1) * c)) / (n + 1);
  const xs: number[] = [];
  const left = ctx.cx - innerHalf(ctx);
  for (let i = 0; i < n; i++) xs.push(left + gap * (i + 1) + L * (2 * i + 1));
  return xs;
}

export interface Sweeper {
  x: number;
  L: number;
}

/** Minimum dy between two rows of sweepers so no sweep circles come closer than c. */
export function rowGap(prev: Sweeper[], next: Sweeper[], c: number): number {
  let dy = 0;
  for (const a of prev)
    for (const b of next) {
      const need = a.L + b.L + c;
      const dx = Math.abs(a.x - b.x);
      if (dx < need) dy = Math.max(dy, Math.sqrt(need * need - dx * dx));
    }
  return dy;
}

export function addSwitchObj(ctx: Ctx, s: Omit<Switch, 'id'>): Switch {
  const sw: Switch = { id: nid(ctx, 'sw'), ...s };
  ctx.switches.push(sw);
  return sw;
}

/* -------------------------------------------------------------- flippers */

export const FLIPPER_TILT = 0.5;
const FLIPPER_SWING = 1.0;

/** Resting slope (rad below horizontal) of the flippers in this course, kept in one place. */
export interface FlipperOpts {
  /** length of the bar (pivot to tip) */
  L: number;
  /** +1: the bar extends toward +x (pivot on the left end), -1: toward -x (pivot on the right end) */
  dir: 1 | -1;
  /** resting slope below horizontal (rad); the flipper swings up to FLIPPER_SWING - tilt above it */
  tilt?: number;
  /** swing speed up (rad/s): 5-6 for ~12 m rise, ~4 for ramp flippers */
  upSpeed?: number;
}

/**
 * Pinball flipper: one link, pivot at one end, tapered bar. Rests sloping DOWN away from the pivot
 * (toward the drain) and swings UP when a marble touches it. Canonical frame (y down, angle clockwise-positive).
 */
export function makeFlipper(ctx: Ctx, pivot: Vec, o: FlipperOpts): Mechanism {
  const tilt = o.tilt ?? FLIPPER_TILT;
  const L = o.L;
  const base = o.dir > 0 ? 0 : Math.PI;
  const m: Mechanism = {
    id: nid(ctx, 'flip'),
    kind: 'flipper',
    pivot,
    links: [
      {
        shapes: [
          { type: 'polygon', points: [{ x: 0, y: -0.22 }, { x: L, y: -0.1 }, { x: L, y: 0.1 }, { x: 0, y: 0.22 }] },
          { type: 'circle', cx: 0, cy: 0, r: 0.22 },
          { type: 'circle', cx: L, cy: 0, r: 0.1 },
        ],
        motion: { type: 'flipper', rest: base + o.dir * tilt, up: base - o.dir * (FLIPPER_SWING - tilt), upSpeed: o.upSpeed ?? 4.5, downSpeed: 4, hold: 0.12, cooldown: 1.0 },
      },
    ],
    effect: null,
  };
  ctx.mechs.push(m);
  return m;
}
