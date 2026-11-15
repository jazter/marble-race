/**
 * "Pinball table" (pinball) and "two-pitch roof" (gableSplit) segments. Canonical frame, flow toward +y.
 * Both are fully solid / protected and never contain switches or monsters.
 */
import { DEG, clamp } from '../core/math';
import type { Mechanism } from '../core/types';
import { DIV_HALF, type Lane, type LaneStyle, addSlat, fillLane, finishSeg, neckFunnel, passMin } from './boards';
import { type Ctx, FLIPPER_TILT, addWall, applyEffect, innerHalf, kindEnabled, makeFlipper, nid, pathTo, sawShapes } from './util';

const bumperReaction = (ctx: Ctx): 'bounce' | 'solid' => (ctx.cfg.walls.special.bounce && ctx.cfg.walls.specialRatio > 0 ? 'bounce' : 'solid');

/* ----------------------------------------------------------------- pinball */

interface PinballLayout {
  /** drain width between the flipper tips at rest */
  g: number;
  /** flipper length */
  L: number;
}

export function pinballLayout(ctx: Ctx): PinballLayout | null {
  const g = Math.max(3.0, 3.3 * ctx.R);
  const half = innerHalf(ctx);
  // wall -> pivot must span at least 1.6 m of guide wall
  const L = Math.min(2.1, (half - g / 2 - 0.1 - 1.6) / Math.cos(FLIPPER_TILT));
  if (L < 1.4) return null;
  return { g, L };
}

export const pinballAvailable = (ctx: Ctx): boolean => kindEnabled(ctx, 'flipper') && pinballLayout(ctx) !== null;

function pinball(ctx: Ctx): void {
  const lay = pinballLayout(ctx) as PinballLayout;
  const { cx, rng } = ctx;
  const { g, L } = lay;
  const half = innerHalf(ctx);
  const R = ctx.R;
  const y0 = ctx.y;

  // 1. entry: shallow funnel into a neck, with a tilted baffle under it so a marble thrown back up
  // can never go straight out through the neck
  const O = Math.max(3.2, 3.8 * R);
  const neckBottom = neckFunnel(ctx, y0 + 1, cx, O, Math.tan(rng.range(24, 28) * DEG), 0.8);
  const s = rng.sign();
  const yb = neckBottom + 1.8;
  const pa = { x: cx - s * 2.2, y: yb };
  const pb = { x: cx + s * 3.4, y: yb + 5.6 * Math.tan(22 * DEG) };
  addWall(ctx, { type: 'polyline', thickness: 0.4, points: [pa, pb] }, 'wall', { reaction: 'solid' });
  addWall(ctx, { type: 'circle', center: pa, radius: 0.2 }, 'wall', { reaction: 'solid' });
  pathTo(ctx, cx, yb);

  // 2. playfield: staggered bumpers
  const rows = 2;
  const sx = 4.4;
  const v = 3.2;
  let y = pb.y + 2.2;
  for (let row = 0; row < rows; row++) {
    for (let k = -3; k <= 3; k++) {
      const x = cx + (k + 0.5 * (row % 2)) * sx;
      const rb = rng.range(0.5, 0.7);
      if (Math.abs(x - cx) + rb > half - (2 * R + 0.6)) continue;
      addWall(ctx, { type: 'circle', center: { x, y }, radius: rb }, 'bumper', { reaction: bumperReaction(ctx) });
    }
    pathTo(ctx, cx, y);
    if (row < rows - 1) y += v;
  }

  // 3. guide walls down to the flippers, drain between the tips
  const yG0 = y + 2.8;
  const side = ctx.cx - ctx.hw - 0.3;
  const sideR = ctx.cx + ctx.hw + 0.3;
  const tan = Math.tan(FLIPPER_TILT);
  const pxL = cx - g / 2 - 0.1 - L * Math.cos(FLIPPER_TILT);
  const pxR = cx + g / 2 + 0.1 + L * Math.cos(FLIPPER_TILT);
  const pyL = yG0 + (pxL - side) * tan;
  const pyR = yG0 + (sideR - pxR) * tan;
  const pyMax = Math.max(pyL, pyR);
  // both flippers at the same height (symmetric table): lower the shallower guide's start
  const pivotY = pyMax;
  const startL = { x: side, y: pivotY - (pxL - side) * tan };
  const startR = { x: sideR, y: pivotY - (sideR - pxR) * tan };
  addWall(ctx, { type: 'polyline', thickness: 0.4, points: [startL, { x: pxL, y: pivotY }] }, 'wall', { reaction: 'solid' });
  addWall(ctx, { type: 'polyline', thickness: 0.4, points: [startR, { x: pxR, y: pivotY }] }, 'wall', { reaction: 'solid' });
  makeFlipper(ctx, { x: pxL, y: pivotY }, { L, dir: 1 });
  makeFlipper(ctx, { x: pxR, y: pivotY }, { L, dir: -1 });
  pathTo(ctx, cx, pivotY + 1);
  const tipY = pivotY + L * Math.sin(FLIPPER_TILT);
  pathTo(ctx, cx, tipY + 1);
  finishSeg(ctx, tipY + 2.6);
}

/* --------------------------------------------------------------- gableSplit */

export type GableTrap = 'sierra' | 'martillo' | 'triangulos' | 'asesina' | 'impulso' | 'miel' | 'rebote' | 'clavos' | 'helice' | 'zona' | 'escalones';

/** Trap sets of the lanes (left, right) built by the most recent generateMap call (diagnostics only). */
export const gableLog: GableTrap[][] = [];

const RISKY: GableTrap[] = ['sierra', 'martillo', 'triangulos', 'asesina', 'impulso'];
const SAFE: GableTrap[] = ['miel', 'rebote', 'helice', 'zona', 'clavos', 'escalones'];

export function gableAvailable(ctx: Ctx): boolean {
  return innerHalf(ctx) >= 5.5;
}

function trapOk(ctx: Ctx, t: GableTrap, c: number): boolean {
  const cfg = ctx.cfg;
  const roomHalf = c / 2 - (2 * ctx.R + 0.1);
  switch (t) {
    case 'sierra':
      return kindEnabled(ctx, 'saw') && c >= 5.5;
    case 'martillo':
      return kindEnabled(ctx, 'hammer') && roomHalf >= 1.0;
    case 'triangulos':
      return kindEnabled(ctx, 'triangle') && roomHalf >= 0.9;
    case 'asesina':
      return cfg.walls.special.kill && ctx.kills < 3;
    case 'miel':
      return cfg.walls.special.slow;
    case 'helice':
      return kindEnabled(ctx, 'propeller') && c >= 5.8;
    case 'zona':
      return cfg.objects.zones && (cfg.objects.effects.grow || cfg.objects.effects.shrink);
    default:
      return true;
  }
}

/** One trap in a vertical slot [ya, yb] of a lane. */
function buildTrap(ctx: Ctx, lane: Lane, t: GableTrap, variant: number): void {
  const { rng, cfg } = ctx;
  const c = lane.xb - lane.xa;
  const xm = (lane.xa + lane.xb) / 2;
  const len = lane.yb - lane.ya;
  const ym = lane.ya + len / 2;
  switch (t) {
    case 'sierra': {
      const radius = rng.range(0.9, 1.2);
      const reach = radius * 1.35;
      const sg = rng.sign();
      const x = sg < 0 ? lane.xa + reach + 0.1 : lane.xb - reach - 0.1;
      const m: Mechanism = {
        id: nid(ctx, 'saw'),
        kind: 'saw',
        pivot: { x, y: ym },
        links: [{ shapes: sawShapes(radius, 10), motion: { type: 'rotate', speed: rng.sign() * rng.range(2.5, 4), phase: 0 } }],
        effect: null,
      };
      applyEffect(ctx, m, { x: 0, y: 0 });
      ctx.mechs.push(m);
      break;
    }
    case 'martillo': {
      const Lh = 2.8;
      const reachX = Math.max(0.2, c / 2 - (2 * ctx.R + 0.1) - 0.7);
      const amp = Math.asin(Math.min(0.9, reachX / Lh));
      const m: Mechanism = {
        id: nid(ctx, 'ham'),
        kind: 'hammer',
        pivot: { x: xm, y: lane.ya + 0.3 },
        links: [
          {
            shapes: [
              { type: 'box', cx: 0, cy: Lh / 2, hw: 0.12, hh: Lh / 2, angle: 0 },
              { type: 'box', cx: 0, cy: Lh + 0.2, hw: 0.7, hh: 0.3, angle: 0 },
            ],
            motion: { type: 'oscillate', center: 0, amplitude: amp, frequency: rng.range(0.4, 0.7), phase: rng.range(0, Math.PI * 2) },
          },
        ],
        effect: null,
      };
      applyEffect(ctx, m, { x: 0, y: Lh + 0.2 });
      ctx.mechs.push(m);
      break;
    }
    case 'triangulos': {
      const rho = clamp(c / 2 - (2 * ctx.R + 0.1), 0.9, 1.5);
      const h = (rho * Math.sqrt(3)) / 2;
      let dir = rng.sign();
      for (let i = 0; i < 2; i++) {
        const m: Mechanism = {
          id: nid(ctx, 'tri'),
          kind: 'triangle',
          pivot: { x: xm, y: lane.ya + len * (0.28 + 0.44 * i) },
          links: [
            {
              shapes: [{ type: 'polygon', points: [{ x: rho, y: 0 }, { x: -rho / 2, y: h }, { x: -rho / 2, y: -h }] }],
              motion: { type: 'rotate', speed: dir * rng.range(1.2, 2.2), phase: rng.range(0, Math.PI * 2) },
            },
          ],
          effect: null,
        };
        applyEffect(ctx, m, { x: rho, y: 0 });
        ctx.mechs.push(m);
        dir = -dir;
      }
      break;
    }
    case 'asesina': {
      // short lethal nubs on the outer wall (never on the surface marbles have to follow)
      const wallX = variant % 2 === 0 ? lane.xa : lane.xb;
      for (let i = 0; i < 2 && ctx.kills < 3; i++) {
        addWall(ctx, { type: 'circle', center: { x: wallX, y: lane.ya + len * (0.3 + 0.4 * i) }, radius: 0.5 }, 'bumper', { reaction: 'kill' });
        ctx.kills++;
      }
      // a bumper facing the nub keeps marbles moving around instead of hugging the wall
      addWall(ctx, { type: 'circle', center: { x: xm, y: ym }, radius: 0.6 }, 'bumper', { reaction: bumperReaction(ctx) });
      break;
    }
    case 'zona': {
      const gp: ('grow' | 'shrink')[] = [];
      if (cfg.objects.effects.grow) gp.push('grow');
      if (cfg.objects.effects.shrink) gp.push('shrink');
      const effect = rng.pick(gp);
      ctx.zones.push({ id: nid(ctx, 'zone'), shape: { type: 'circle', center: { x: xm, y: ym }, radius: Math.min(2.4, c / 2 - 0.8) }, effect, strength: effect === 'grow' ? 1.25 : 0.8 });
      break;
    }
    case 'impulso':
      fillLane(ctx, lane, 'rapido' as LaneStyle, variant);
      break;
    case 'miel':
    case 'rebote':
    case 'clavos':
    case 'helice':
    case 'escalones':
      fillLane(ctx, lane, t as LaneStyle, variant);
      break;
  }
}

/** Two distinct trap sets: a riskier / faster one and a safer / slower one (never overlapping). */
export function pickGableSets(ctx: Ctx, c: number): { risky: GableTrap[]; safe: GableTrap[] } {
  const rng = ctx.rng;
  const order = (pool: GableTrap[], last: GableTrap[]): GableTrap[] => {
    const ok = pool.filter((t) => trapOk(ctx, t, c));
    const sh = rng.shuffle([...ok]);
    return [...sh.filter((t) => !last.includes(t)), ...sh.filter((t) => last.includes(t))];
  };
  const risky = order(RISKY, ['impulso']).slice(0, 2);
  const safe = order(SAFE, ['clavos', 'escalones']).filter((t) => !risky.includes(t)).slice(0, 2);
  // not enough of one class: borrow from the other, never reusing a trap
  const used = new Set<GableTrap>([...risky, ...safe]);
  const spare = [...order(RISKY, []), ...order(SAFE, [])].filter((t) => !used.has(t));
  while (risky.length < 2 && spare.length) risky.push(spare.shift() as GableTrap);
  while (safe.length < 2 && spare.length) safe.push(spare.shift() as GableTrap);
  return { risky, safe };
}

function gableSplit(ctx: Ctx): void {
  const { cx, rng } = ctx;
  const half = innerHalf(ctx);
  const theta = rng.range(30, 40) * DEG;
  // roof: eaves stop short of the walls, leaving an entry gap for each lane
  const gapE = Math.max(2.6, 2 * ctx.R + 0.8);
  const e = half - gapE;
  // entry: everything is funnelled onto the centre line first, so the apex splits the stream evenly
  const nb0 = neckFunnel(ctx, ctx.y + 1, cx, Math.max(3.0, 3.4 * ctx.R), Math.tan(rng.range(26, 30) * DEG), 1.0);
  const yA = nb0 + 1.6;
  const eaveY = yA + e * Math.tan(theta);
  const apex = { x: cx, y: yA };
  const eL = { x: cx - e, y: eaveY };
  const eR = { x: cx + e, y: eaveY };
  addWall(ctx, { type: 'polyline', thickness: 0.4, points: [eL, apex, eR] }, 'wall', { reaction: 'solid' });
  addWall(ctx, { type: 'circle', center: eL, radius: 0.2 }, 'wall', { reaction: 'solid' });
  addWall(ctx, { type: 'circle', center: eR, radius: 0.2 }, 'wall', { reaction: 'solid' });
  pathTo(ctx, cx, yA);

  // divider with a pointed cap under the apex
  const laneLen = 13;
  const yDiv0 = yA + 0.3;
  const yDiv1 = eaveY + 2 + laneLen;
  addSlat(ctx, cx, yDiv0, yDiv1, DIV_HALF, 1.0);

  const c = half - DIV_HALF;
  const sets = pickGableSets(ctx, c);
  const riskyLeft = rng.bool(0.5);
  const leftSet = riskyLeft ? sets.risky : sets.safe;
  const rightSet = riskyLeft ? sets.safe : sets.risky;
  gableLog.push(leftSet.slice(), rightSet.slice());
  const ya = eaveY + 2.2;
  const yb = yDiv1 - 1.2;
  const lanes: { set: GableTrap[]; xa: number; xb: number }[] = [
    { set: leftSet, xa: cx - half, xb: cx - DIV_HALF },
    { set: rightSet, xa: cx + DIV_HALF, xb: cx + half },
  ];
  for (const ln of lanes) {
    const slot = (yb - ya) / ln.set.length;
    ln.set.forEach((t, i) => buildTrap(ctx, { xa: ln.xa, xb: ln.xb, ya: ya + i * slot, yb: ya + (i + 1) * slot }, t, i));
  }
  pathTo(ctx, cx, yDiv1);

  // merge back into the corridor
  const O = Math.max(3.2, 5 * ctx.R) + 0.5;
  const nb = neckFunnel(ctx, yDiv1 + 0.3, cx, O, Math.tan(rng.range(32, 38) * DEG), 2);
  finishSeg(ctx, nb + 3);
}

void passMin;
export { pinball, gableSplit };
