/**
 * Staircase lift ("escalera elevadora"): a flight of stairs climbing across the corridor; every
 * step has a flipper lying on it. A marble landing on a step rolls back to the flipper's tip
 * (against the small lip at the back of the step), the flipper fires and flicks it up and forward
 * over the next step's lip. A weak flick just drops it back on the same step and the flipper fires
 * again, so every marble climbs; from the top step it is flicked into the channel beside the
 * stairs and drops on down. Marbles can land on any step: each one sends them upward. Canonical
 * frame (y down, flow +y).
 */
import { DEG } from '../core/math';
import type { Mechanism, Vec } from '../core/types';
import { BH, type Ctx, addWall, finishSeg, kindEnabled, nid, pathTo } from './util';

const STEP_L = 2.0; // tread length (= flipper length)
const RISE = 1.2; // height between the backs of two treads
const TREAD_TILT = 10 * DEG; // treads slope down toward their back, where marbles gather
const LIP = 0.4;

/** Gap between the low-side wall and the back of the first step (a marble resting against the
 *  wall would be flicked straight up along it). */
const WALL_GAP = 0.9;

function steps(ctx: Ctx): number {
  const width = 2 * (ctx.hw - BH);
  const channel = 2 * ctx.R + 1.4;
  const n = Math.floor((width - channel - WALL_GAP - 0.4) / STEP_L);
  return n >= 3 ? Math.min(n, 5) : 0;
}

export const liftAvailable = (ctx: Ctx): boolean => kindEnabled(ctx, 'lift') && steps(ctx) > 0;

export function lift(ctx: Ctx): void {
  const n = steps(ctx);
  if (!n) return;
  const { cx, hw, rng } = ctx;
  const dir = rng.sign(); // +1: the stairs climb toward +x
  const near = dir > 0 ? cx - hw + BH : cx + hw - BH; // inner face of the low-side wall
  const X = (u: number): number => near + dir * (u + WALL_GAP);
  const width = 2 * (hw - BH) - WALL_GAP; // u is measured from the first step's back
  const L = STEP_L;
  const drop = L * Math.tan(TREAD_TILT);
  const g = Math.max(2, ctx.cfg.physics.gravity);
  // flick strong enough to clear the next lip with margin; scales with gravity (same arc)
  const apex = RISE + LIP + 0.5;
  const v = (1.15 * Math.sqrt(2 * g * apex)) / Math.sin(65 * DEG);
  const upSpeed = v / (L - ctx.r - 0.15); // tip speed for a marble resting at the tip

  // relative y: back of tread 0 = 0; tread k back at -k·RISE, front higher by `drop`
  const top = ctx.y + 1.5 + n * RISE + 2.6; // room above the top step for the flicks
  const yb = (k: number): number => top - k * RISE;
  const P = (u: number, y: number): Vec => ({ x: X(u), y });

  // the staircase outline: lip, tread, riser up to the next lip... then down the channel wall
  // from the low-side wall a short slope onto the first step's lip (nothing falls behind it)
  const pts: Vec[] = [P(-WALL_GAP - 0.2, yb(0) - LIP - 0.9)];
  for (let k = 0; k < n; k++) {
    const ub = k * L; // back of tread k
    pts.push(P(ub, yb(k) - LIP)); // lip top
    pts.push(P(ub, yb(k) + 0.25)); // down to the floor under the flipper
    pts.push(P(ub + L, yb(k) - drop + 0.25)); // floor (just under the resting flipper)
  }
  const uTop = n * L;
  const bottom = yb(0) + 1.5;
  pts.push(P(uTop, yb(n - 1) - drop - 0.5)); // a short guard at the top front
  pts.push(P(uTop, bottom)); // channel wall down past the stairs
  for (let i = 0; i < pts.length - 1; i += 7) {
    const piece = pts.slice(i, Math.min(pts.length, i + 8));
    if (piece.length >= 2) addWall(ctx, { type: 'polyline', thickness: 0.3, points: piece }, 'ramp', { reaction: 'solid' });
  }

  // one flipper per step: pivot at the front, tip at the back, resting along the tread
  const base = dir > 0 ? Math.PI : 0; // bar points back (toward -dir)
  const rest = base - dir * TREAD_TILT; // tip lower (toward the back)
  const up = base + dir * 65 * DEG; // tip raised well above horizontal (tuned in races: marbles roll inward on the bar)
  for (let k = 0; k < n; k++) {
    const pivot = P(k * L + L - 0.12, yb(k) - drop);
    const m: Mechanism = {
      id: nid(ctx, 'lift'),
      kind: 'lift',
      pivot,
      links: [
        {
          shapes: [
            { type: 'polygon', points: [{ x: 0, y: -0.2 }, { x: L - 0.25, y: -0.09 }, { x: L - 0.25, y: 0.09 }, { x: 0, y: 0.2 }] },
            { type: 'circle', cx: 0, cy: 0, r: 0.2 },
            { type: 'circle', cx: L - 0.25, cy: 0, r: 0.09 },
          ],
          motion: { type: 'flipper', rest, up, upSpeed, downSpeed: 3, hold: 0.1, cooldown: 0.7 },
        },
      ],
      effect: null,
      flipLimit: 30,
    };
    ctx.mechs.push(m);
    pathTo(ctx, X(k * L + L * 0.5), yb(k) - 1.2);
  }
  // the channel beside the stairs: flicked off the top step, marbles drop down here
  const uCh = (uTop + width) / 2;
  pathTo(ctx, X(uCh), yb(n - 1) - 1);
  pathTo(ctx, X(uCh), bottom + 1);
  ctx.dropSpots.push(P(uCh, bottom + 0.4));
  finishSeg(ctx, bottom + 2.2);
}
