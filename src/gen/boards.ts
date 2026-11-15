/**
 * "Board" segments: the Galton board (bean machine) and the split-paths segment (lanes).
 * Canonical frame, flow toward +y. Both are fully solid / protected and never contain switches.
 */
import { DEG, clamp } from '../core/math';
import type { Mechanism, Vec } from '../core/types';
import { type Ctx, BH, mechClearance, addWall, applyEffect, extend, innerHalf, kindEnabled, nid, pathTo, propellerShapes } from './util';

export const finishSeg = (ctx: Ctx, yEnd: number): void => {
  extend(ctx, yEnd);
  pathTo(ctx, ctx.cx, yEnd);
};

const lerpInt = (ctx: Ctx, lo: number, hi: number): number => clamp(Math.round(lo + ctx.t * (hi - lo) + ctx.rng.range(-0.6, 0.6)), lo, hi);

/** Radius used for the "gap" rules (same as the pegs segment): marbles grow at most 1.5x there. */
const gapRadius = (ctx: Ctx): number => ctx.r * Math.min(ctx.cfg.marbles.maxScale, 1.5);

/**
 * Two ramps closing the whole corridor to a neck `O` wide centred on `nx` (solid, so the
 * flow stays predictable). Returns the y where the straight neck ends.
 */
export function neckFunnel(ctx: Ctx, top: number, nx: number, O: number, tanA: number, neckLen: number): number {
  const { cx, hw } = ctx;
  const xl = cx - hw - 0.2;
  const xr = cx + hw + 0.2;
  const lEnd = { x: nx - O / 2, y: top + (nx - O / 2 - xl) * tanA };
  const rEnd = { x: nx + O / 2, y: top + (xr - (nx + O / 2)) * tanA };
  const neckBottom = Math.max(lEnd.y, rEnd.y) + neckLen;
  addWall(ctx, { type: 'polyline', thickness: 0.4, points: [{ x: xl, y: top }, lEnd, { x: lEnd.x, y: neckBottom }] }, 'ramp', { reaction: 'solid' });
  addWall(ctx, { type: 'polyline', thickness: 0.4, points: [{ x: xr, y: top }, rEnd, { x: rEnd.x, y: neckBottom }] }, 'ramp', { reaction: 'solid' });
  pathTo(ctx, cx, top);
  pathTo(ctx, nx, Math.max(lEnd.y, rEnd.y));
  pathTo(ctx, nx, neckBottom);
  return neckBottom;
}

/** Thin vertical divider with a pointed top (so marbles never perch on it). Convex pentagon. */
export function addSlat(ctx: Ctx, x: number, yTop: number, yBot: number, half: number, cap: number): void {
  addWall(
    ctx,
    {
      type: 'polygon',
      points: [
        { x, y: yTop },
        { x: x + half, y: yTop + cap },
        { x: x + half, y: yBot },
        { x: x - half, y: yBot },
        { x: x - half, y: yTop + cap },
      ],
    },
    'wall',
    { reaction: 'solid' },
  );
}

/* ------------------------------------------------------------------ galton */

export interface GaltonLayout {
  /** pegs per full row minus one (number of gaps in a full row) */
  m: number;
  /** horizontal peg spacing */
  s: number;
}

/** Peg lattice that fills the corridor width with every gap >= 2.2 * (2 R'). null if it cannot fit. */
export function galtonLayout(ctx: Ctx): GaltonLayout | null {
  const pr = 0.25;
  const sMin = 2.2 * 2 * gapRadius(ctx) + 2 * pr;
  const span = 2 * innerHalf(ctx);
  const m = Math.min(8, Math.floor(span / sMin));
  if (m < 2) return null;
  return { m, s: span / m };
}

export const galtonAvailable = (ctx: Ctx): boolean => galtonLayout(ctx) !== null;

function galton(ctx: Ctx): void {
  const lay = galtonLayout(ctx) as GaltonLayout;
  const { cx, rng, cfg } = ctx;
  const { m, s } = lay;
  const K = m + 1;
  const v = 0.9 * s;
  const y0 = ctx.y;
  // rows: 7..10 (parity chosen so the last row is a full one and the bins sit under its pegs)
  let N = Math.max(K, lerpInt(ctx, 7, 10));
  if ((N - K) % 2 !== 0) N += N < 10 ? 1 : -1;
  const bumperOk = cfg.walls.special.bounce && cfg.walls.specialRatio > 0;

  // entry funnel: everything leaves through a single neck at the top centre
  const O = Math.max(3.0, 3.6 * ctx.R);
  const neckBottom = neckFunnel(ctx, y0 + 1, cx, O, Math.tan(rng.range(34, 40) * DEG), 3.5);

  // peg pyramid: rows 1, 2, 3, ... widening to the full corridor, then alternating full / shifted rows
  let y = neckBottom + 2 * ctx.R + 1;
  const rowXs = (k: number): number[] => {
    const cnt = k <= K ? k : (k - K) % 2 === 1 ? K - 1 : K;
    const xs: number[] = [];
    for (let j = 0; j < cnt; j++) xs.push(cx + (j - (cnt - 1) / 2) * s);
    // a peg a bit off the wall leaves a slot a big marble wedges into: drop it (full rows are embedded in the wall)
    return xs.filter((x) => cnt === K || innerHalf(ctx) - Math.abs(x - cx) - 0.25 >= 2 * ctx.R + 0.3);
  };
  for (let k = 1; k <= N; k++) {
    for (const x of rowXs(k)) {
      const isBumper = rng.bool(0.12);
      if (isBumper) addWall(ctx, { type: 'circle', center: { x, y }, radius: 0.4 }, 'bumper', { reaction: bumperOk ? 'bounce' : 'solid' });
      else addWall(ctx, { type: 'circle', center: { x, y }, radius: 0.25 }, 'peg', { surface: true });
    }
    pathTo(ctx, cx, y);
    if (k < N) y += v;
  }
  const yLast = y;

  // bins: vertical slats under the pegs of the last (full) row, open at the bottom
  const slatTop = yLast + 0.55 * v;
  const slatBot = slatTop + 4.2;
  for (let j = 1; j < m; j++) addSlat(ctx, cx + (j - m / 2) * s, slatTop, slatBot, 0.15, 0.6);
  pathTo(ctx, cx, slatBot);

  // merge back into the corridor
  const top = slatBot + 0.3;
  const O2 = Math.max(3.2, 5 * ctx.R) + 0.5;
  const nb = neckFunnel(ctx, top, cx, O2, Math.tan(rng.range(34, 40) * DEG), 2);
  finishSeg(ctx, nb + 3);
}

/* ------------------------------------------------------------------- lanes */

export const DIV_HALF = 0.12;

/** Smallest clear lane width: 2.8 m and 3.2 R for the biggest marble. */
export const laneMin = (ctx: Ctx): number => Math.max(2.8, 3.2 * ctx.R);
/** Passage that must stay free next to any lane obstacle. */
export const passMin = (ctx: Ctx): number => Math.max(2.0, 2 * ctx.R + 0.4);

export function lanesMax(ctx: Ctx): number {
  const span = 2 * innerHalf(ctx);
  return Math.min(5, Math.floor((span + 2 * DIV_HALF) / (laneMin(ctx) + 2 * DIV_HALF)));
}

export const lanesAvailable = (ctx: Ctx): boolean => lanesMax(ctx) >= 2;

/** Styles of the lanes built by the most recent generateMap call (diagnostics only; never read by the generator). */
export const laneLog: LaneStyle[][] = [];

export type LaneStyle = 'rapido' | 'clavos' | 'escalones' | 'miel' | 'rebote' | 'helice';

export interface Lane {
  /** inner faces */
  xa: number;
  xb: number;
  /** vertical range for obstacles */
  ya: number;
  yb: number;
}

export function ledge(ctx: Ctx, lane: Lane, side: number, y: number, e: number, deg: number, reaction: 'solid' | 'launch' | 'slow'): void {
  const face = side < 0 ? lane.xa : lane.xb;
  e = Math.max(0.3, e - 0.2); // the 0.4 thick ledge sticks out half its thickness past the tip
  const tipX = face - side * e;
  const a = { x: face + side * 0.12, y };
  const b = { x: tipX, y: y + e * Math.tan(deg * DEG) };
  const w = addWall(ctx, { type: 'polyline', thickness: 0.4, points: [a, b] }, 'ramp', { reaction });
  if (reaction === 'launch') {
    const dx = -side * 0.35;
    const L = Math.hypot(dx, 1);
    w.launchDir = { x: dx / L, y: 1 / L };
  }
}

function nub(ctx: Ctx, lane: Lane, side: number, y: number, rad: number, bumper: boolean): void {
  const face = side < 0 ? lane.xa : lane.xb;
  const c: Vec = { x: face, y };
  if (bumper) addWall(ctx, { type: 'circle', center: c, radius: rad }, 'bumper', { reaction: ctx.cfg.walls.special.bounce ? 'bounce' : 'solid' });
  else addWall(ctx, { type: 'circle', center: c, radius: rad }, 'peg', { surface: true });
}

export function fillLane(ctx: Ctx, lane: Lane, style: LaneStyle, variant: number): void {
  const c = lane.xb - lane.xa;
  const room = c - passMin(ctx); // how far an obstacle may stick into the lane
  const sp = variant > 0 ? 0.8 : 1; // duplicate styles: denser
  const first = variant % 2 === 0 ? -1 : 1;
  const len = lane.yb - lane.ya;
  const { cfg } = ctx;
  const sp0 = (d: number): number => d * sp;
  switch (style) {
    case 'rapido': {
      const reaction = cfg.walls.special.launch ? 'launch' : 'solid';
      const e = clamp(Math.min(room, c * 0.5), 0.5, 2);
      const n = Math.max(2, Math.floor(len / 6));
      for (let i = 0; i < n; i++) ledge(ctx, lane, first * (i % 2 === 0 ? 1 : -1), lane.ya + ((i + 0.5) / n) * len, e, 14, reaction);
      break;
    }
    case 'clavos':
    case 'rebote': {
      if (c >= 6) {
        // wide lane: staggered free-standing pegs / bumpers (rows of m and m-1) between the wall nubs
        const m = Math.floor(c / 3.4);
        const bump = style === 'rebote';
        for (let y = lane.ya, i = 0; y <= lane.yb; y += sp0(bump ? 2.6 : 2.0), i++) {
          const cnt = i % 2 === 0 ? m : m - 1;
          for (let j = 0; j < cnt; j++) {
            const x = (lane.xa + lane.xb) / 2 + (j - (cnt - 1) / 2) * (c / m);
            if (bump) nub(ctx, { ...lane, xa: x, xb: x }, -1, y, 0.65, true);
            else nub(ctx, { ...lane, xa: x, xb: x }, -1, y, 0.35, false);
          }
        }
        break;
      }
      if (style === 'rebote') {
        const rad = clamp(Math.min(room, 0.85), 0.45, 0.85);
        for (let y = lane.ya, i = 0; y <= lane.yb; y += sp0(2.3), i++) nub(ctx, lane, first * (i % 2 === 0 ? 1 : -1), y, rad, true);
        break;
      }
      const rad = clamp(Math.min(room, 0.6), 0.3, 0.6);
      for (let y = lane.ya, i = 0; y <= lane.yb; y += sp0(1.7), i++) nub(ctx, lane, first * (i % 2 === 0 ? 1 : -1), y, rad, false);
      break;
    }
    case 'escalones': {
      const e = clamp(Math.min(room, c * 0.6), 0.8, 3);
      for (let y = lane.ya, i = 0; y <= lane.yb - 1; y += sp0(3.0), i++) ledge(ctx, lane, first * (i % 2 === 0 ? 1 : -1), y, e, 20, 'solid');
      break;
    }
    case 'miel': {
      const e = clamp(Math.min(room, c * 0.7), 0.8, 3.4);
      for (let y = lane.ya, i = 0; y <= lane.yb - 1; y += sp0(3.2), i++) ledge(ctx, lane, first * (i % 2 === 0 ? 1 : -1), y, e, 12, 'slow');
      break;
    }
    case 'helice': {
      const L = clamp(c / 2 - 1.7, 0.8, 2);
      const y = lane.ya + len / 2;
      const m: Mechanism = {
        id: nid(ctx, 'prop'),
        kind: 'propeller',
        pivot: { x: (lane.xa + lane.xb) / 2, y },
        links: [{ shapes: propellerShapes(2, L, 0.4), motion: { type: 'rotate', speed: first * 0.9, phase: ctx.rng.range(0, Math.PI * 2) } }],
        effect: null,
      };
      applyEffect(ctx, m, { x: L * 0.92, y: 0 });
      ctx.mechs.push(m);
      break;
    }
  }
}

function pickStyles(ctx: Ctx, n: number, c: number): LaneStyle[] {
  const room = c - passMin(ctx);
  const pool: LaneStyle[] = ['rapido', 'clavos', 'rebote'];
  if (room >= 1.4) pool.push('escalones');
  if (ctx.cfg.walls.special.slow) pool.push('miel');
  if (kindEnabled(ctx, 'propeller') && c >= 5.8) pool.push('helice');
  const sh = ctx.rng.shuffle([...pool]);
  const out: LaneStyle[] = [];
  for (let i = 0; i < n; i++) out.push(sh[i % sh.length]);
  // a fast lane must exist
  if (!out.includes('rapido')) out[ctx.rng.int(0, n - 1)] = 'rapido';
  return out;
}

function lanes(ctx: Ctx): void {
  const { cx, rng, cfg } = ctx;
  const n = Math.min(rng.int(2, 5), lanesMax(ctx));
  const span = 2 * innerHalf(ctx);
  const td = 2 * DIV_HALF;
  const c = (span - (n - 1) * td) / n;
  const pitch = c + td;
  const xL = cx - span / 2;
  const y0 = ctx.y;
  const bumperOk = cfg.walls.special.bounce && cfg.walls.specialRatio > 0;

  // entry funnel: all marbles leave through one neck on the centre line, then the peg pyramid splits them
  const O0 = Math.max(3.0, 3.6 * ctx.R);
  const nbTop = neckFunnel(ctx, y0 + 1, cx, O0, Math.tan(rng.range(34, 40) * DEG), 3.5);
  // splitter: a slowly turning propeller tosses the stream left / right, then staggered peg rows spread it over every mouth
  let y = nbTop + 2 * ctx.R + 1;
  const half = innerHalf(ctx);
  if (false as boolean) {
    const L = clamp(half - mechClearance(ctx) + 0.4, 2, 5);
    y += L;
    const m: Mechanism = {
      id: nid(ctx, 'prop'),
      kind: 'propeller',
      pivot: { x: cx, y },
      links: [{ shapes: propellerShapes(2, L, 0.4), motion: { type: 'rotate', speed: rng.sign() * rng.range(0.8, 1.2), phase: rng.range(0, Math.PI * 2) } }],
      effect: null,
    };
    ctx.mechs.push(m);
    pathTo(ctx, cx, y);
    y += L + 1.6;
  }
  const vS = Math.max(2.6, 0.9 * pitch);
  const rowsN = clamp(n, 3, 4);
  for (let k = 0; k < rowsN; k++) {
    // lane-pitch lattice: the last row sits on the dividers, the one above it on the lane centres, and so on
    const onDiv = (rowsN - 1 - k) % 2 === 0;
    const cnt = onDiv ? n - 1 : n;
    for (let j = 0; j < cnt; j++) {
      const x = cx + (j - (cnt - 1) / 2) * pitch;
      if (rng.bool(0.2)) addWall(ctx, { type: 'circle', center: { x, y }, radius: 0.4 }, 'bumper', { reaction: bumperOk ? 'bounce' : 'solid' });
      else addWall(ctx, { type: 'circle', center: { x, y }, radius: 0.3 }, 'peg', { reaction: 'solid' });
    }
    pathTo(ctx, cx, y);
    y += vS;
  }
  y -= vS;
  const yDiv0 = y + 1.6;
  const yDiv1 = yDiv0 + rng.range(14, 20);

  // dividers
  for (let j = 1; j < n; j++) addSlat(ctx, xL + j * c + (j - 0.5) * td, yDiv0, yDiv1, DIV_HALF, 1.0);

  // lanes
  const styles = pickStyles(ctx, n, c);
  laneLog.push(styles.slice());
  const seen: Partial<Record<LaneStyle, number>> = {};
  for (let k = 0; k < n; k++) {
    const xa = xL + k * pitch;
    const variant = seen[styles[k]] ?? 0;
    seen[styles[k]] = variant + 1;
    fillLane(ctx, { xa, xb: xa + c, ya: yDiv0 + 2.2, yb: yDiv1 - 1.4 }, styles[k], variant);
  }
  pathTo(ctx, cx, yDiv1);

  // merge
  const top = yDiv1 + 0.3;
  const O = Math.max(3.2, 5 * ctx.R) + 0.5;
  const nb = neckFunnel(ctx, top, cx, O, Math.tan(rng.range(34, 40) * DEG), 2);
  finishSeg(ctx, nb + 3);
}

export { galton, lanes };
void BH;
