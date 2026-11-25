/** Obstacle segment library (canonical frame, flow toward +y). */
import type { SwitchActionType } from '../core/config';
import { DEG, clamp, dist } from '../core/math';
import type { Mechanism, Vec } from '../core/types';
import {
  BH,
  type Ctx,
  type Ramp,
  addRamp,
  addSwitchObj,
  addWall,
  applyEffect,
  baseSpeed,
  innerHalf,
  makeTrapdoor,
  mechClearance,
  nid,
  pathTo,
  propellerShapes,
  gearShapes,
  rampSide,
  sawShapes,
  kindEnabled,
  makeFlipper,
  addTeslaCoil,
  RING_T,
  TIP_GAP,
  arcPts,
  addChain,
  capEnd,
  finishSeg,
} from './util';
import { Rng } from '../core/rng';
import { galton, galtonAvailable, lanes, lanesAvailable, neckFunnel } from './boards';
import { gableAvailable, gableSplit, pinball, pinballAvailable } from './pinball';
import { lift, liftAvailable } from './lift';

export type SegmentType =
  | 'zigzag'
  | 'funnel'
  | 'pegs'
  | 'propellers'
  | 'arms'
  | 'saws'
  | 'triangles'
  | 'hammers'
  | 'pads'
  | 'switch'
  | 'funnelGate'
  | 'rotorChamber'
  | 'galton'
  | 'lanes'
  | 'pinball'
  | 'gableSplit'
  | 'gears'
  | 'trampolines'
  | 'lift';


const lerpInt = (ctx: Ctx, lo: number, hi: number): number => clamp(Math.round(lo + ctx.t * (hi - lo) + ctx.rng.range(-0.6, 0.6)), lo, hi);

/* ----------------------------------------------------------------- zigzag */

/** Flipper lying on the head of a ramp (next to the wall it hangs from): kicks marbles that fall on it back up. */
function rampFlipper(ctx: Ctx, rp: Ramp): void {
  const L = dist(rp.a, rp.b);
  const d = { x: (rp.b.x - rp.a.x) / L, y: (rp.b.y - rp.a.y) / L };
  const tilt = Math.atan2(d.y, Math.abs(d.x));
  const up = d.x > 0 ? { x: d.y, y: -d.x } : { x: -d.y, y: d.x };
  const off = rp.thick / 2 + 0.22 + 0.03;
  const pivot = { x: rp.a.x + d.x * 0.45 + up.x * off, y: rp.a.y + d.y * 0.45 + up.y * off };
  makeFlipper(ctx, pivot, { L: 1.7, dir: d.x > 0 ? 1 : -1, tilt, upSpeed: 4 });
}

function zigzagRamps(ctx: Ctx, n: number, flippers = false): Ramp[] {
  const { cx, hw, rng } = ctx;
  const gap = Math.max(3, 4 * ctx.R) + 0.6;
  const sep = Math.max(3.5, 5 * ctx.R);
  let side = rampSide(ctx, rng.sign());
  let y = ctx.y + 2;
  const out: Ramp[] = [];
  for (let i = 0; i < n; i++) {
    const s = rng.range(11, 20) * DEG;
    const attachX = side < 0 ? cx - hw - 0.15 : cx + hw + 0.15;
    const freeX = side < 0 ? cx + hw - gap : cx - hw + gap;
    const a = { x: attachX, y };
    const b = { x: freeX, y: y + Math.abs(freeX - attachX) * Math.tan(s) };
    const rp = addRamp(ctx, a, b);
    out.push(rp);
    if (flippers && rng.bool(0.25) && kindEnabled(ctx, 'flipper')) rampFlipper(ctx, rp);
    y = b.y + sep;
    side = -side;
  }
  const last = out[out.length - 1];
  finishSeg(ctx, last.b.y + 3);
  return out;
}

function zigzag(ctx: Ctx): void {
  const ramps = zigzagRamps(ctx, ctx.rng.int(4, 6), true);
  // conveyor belts: some ramps drag the marbles (mostly with the flow, sometimes against it)
  if (ctx.cfg.objects.conveyors !== false) {
    const crng = new Rng(Math.floor(ctx.rng.next() * 4294967296) ^ 0xc0b7e);
    for (const rp of ramps) {
      if (!crng.bool(0.3)) continue;
      const w = ctx.walls.find((x) => x.id === rp.id);
      if (!w || w.shape.type !== 'polyline' || w.reaction !== 'solid') continue;
      const pts = w.shape.points;
      const downhill = pts[pts.length - 1].y >= pts[0].y ? 1 : -1;
      const withFlow = crng.bool(0.7);
      w.conveyor = downhill * (withFlow ? 1 : -1) * crng.range(5, 8);
    }
  }
  // Tesla coils: now and then an electrified orb hangs in a ramp's gap column, dazing the
  // marbles that drop through (separate Rng so the course itself doesn't change)
  if (!ctx.cfg.objects.effects.stun || !ctx.cfg.objects.zones) return;
  const trng = new Rng(Math.floor(ctx.rng.next() * 4294967296) ^ 0x7e51a);
  ramps.forEach((rp, i) => {
    if (i === ramps.length - 1 || !trng.bool(0.28)) return;
    const side = rp.b.x > ctx.cx ? 1 : -1;
    addTeslaCoil(ctx, { x: rp.b.x + side * 1.6, y: rp.b.y + 1.0 }, trng.range(1.2, 1.6));
  });
}

/* ----------------------------------------------------------------- funnel */

function funnel(ctx: Ctx): void {
  const { cx, hw, rng } = ctx;
  const y0 = ctx.y;
  const O = Math.max(3.2, 5 * ctx.R) + 0.5;
  const off = rng.range(-1, 1) * Math.min(hw * 0.35, 3);
  const nx = cx + off;
  const tan = Math.tan(rng.range(32, 42) * DEG);
  const top = y0 + 1.5;
  const xl = cx - hw - 0.2;
  const xr = cx + hw + 0.2;
  const lEnd = { x: nx - O / 2, y: top + (nx - O / 2 - xl) * tan };
  const rEnd = { x: nx + O / 2, y: top + (xr - (nx + O / 2)) * tan };
  const neckBottom = Math.max(lEnd.y, rEnd.y) + 2.5;
  const lb = { x: lEnd.x, y: neckBottom };
  const rb = { x: rEnd.x, y: neckBottom };
  const dirL = { x: lEnd.x - xl, y: lEnd.y - top };
  const dirR = { x: rEnd.x - xr, y: rEnd.y - top };
  addWall(ctx, { type: 'polyline', thickness: 0.4, points: [{ x: xl, y: top }, lEnd, lb] }, 'ramp', { surface: true, dir: dirL });
  addWall(ctx, { type: 'polyline', thickness: 0.4, points: [{ x: xr, y: top }, rEnd, rb] }, 'ramp', { surface: true, dir: dirR });
  pathTo(ctx, cx, top);
  pathTo(ctx, nx, lEnd.y > rEnd.y ? lEnd.y : rEnd.y);
  pathTo(ctx, nx, neckBottom);
  pathTo(ctx, cx, neckBottom + 3);
  finishSeg(ctx, neckBottom + 3);
}

/* ------------------------------------------------------------------- pegs */

function pegs(ctx: Ctx): void {
  const { cx, hw, rng, cfg } = ctx;
  const rp = ctx.r * Math.min(cfg.marbles.maxScale, 1.5);
  const gap = 2.4 * 2 * rp;
  const s = gap + 1.7;
  const v = Math.sqrt(s * s - (s / 2) * (s / 2));
  const rows = lerpInt(ctx, 5, 8);
  const wallGap = gap * 0.75;
  const phase = rng.range(-0.25, 0.25) * s;
  const bumperOk = cfg.walls.special.bounce && cfg.walls.specialRatio > 0;
  let y = ctx.y + 3;
  for (let row = 0; row < rows; row++) {
    const off = (row % 2) * 0.5;
    for (let k = -6; k <= 6; k++) {
      const x = cx + (k + off) * s + phase;
      const isBumper = rng.bool(0.22);
      const pr = isBumper ? rng.range(0.6, 0.85) : rng.range(0.3, 0.4);
      if (Math.abs(x - cx) + pr > hw - BH - wallGap) continue;
      if (isBumper) {
        addWall(ctx, { type: 'circle', center: { x, y }, radius: pr }, 'bumper', { reaction: bumperOk ? 'bounce' : 'solid' });
      } else {
        addWall(ctx, { type: 'circle', center: { x, y }, radius: pr }, 'peg', {});
      }
    }
    y += v;
  }
  finishSeg(ctx, y + 1);
}

/* ------------------------------------------------------------------- arms */

function arms(ctx: Ctx): void {
  const rng = ctx.rng;
  const c = mechClearance(ctx);
  const count = lerpInt(ctx, 1, 2);
  const reach = clamp(innerHalf(ctx) - c, 2.4, 5.6) * rng.range(0.9, 1);
  let y = ctx.y + 3 + reach;
  let dir = rng.sign();
  for (let i = 0; i < count; i++) {
    const L1 = reach * 0.55;
    const L2 = reach - L1;
    const s1 = dir * baseSpeed(ctx) * 0.8;
    const m: Mechanism = {
      id: nid(ctx, 'arm'),
      kind: 'arm2',
      pivot: { x: ctx.cx, y },
      links: [
        {
          shapes: [{ type: 'box', cx: L1 / 2, cy: 0, hw: L1 / 2, hh: 0.2, angle: 0 }, { type: 'circle', cx: 0, cy: 0, r: 0.35 }],
          tip: { x: L1, y: 0 },
          motion: { type: 'rotate', speed: s1, phase: rng.range(0, Math.PI * 2) },
        },
        {
          shapes: [{ type: 'box', cx: L2 / 2, cy: 0, hw: L2 / 2, hh: 0.15, angle: 0 }, { type: 'circle', cx: L2, cy: 0, r: 0.3 }],
          motion: { type: 'rotate', speed: -dir * baseSpeed(ctx) * 1.3, phase: rng.range(0, Math.PI * 2) },
        },
      ],
      effect: null,
    };
    applyEffect(ctx, m, { x: L2, y: 0 });
    ctx.mechs.push(m);
    y += reach * 2 + 1.5;
    dir = -dir;
  }
  finishSeg(ctx, y - reach + 1.5);
}

/* ------------------------------------------------------------------- saws */

function saws(ctx: Ctx): void {
  const { rng } = ctx;
  const count = lerpInt(ctx, 1, 2);
  const c = mechClearance(ctx);
  let y = ctx.y + 3.5;
  let side = rng.sign();
  for (let i = 0; i < count; i++) {
    const radius = rng.range(0.8, 1.4);
    const reach = radius * 1.35;
    const lim = innerHalf(ctx) - reach - c;
    const x = ctx.cx + side * lim * rng.range(0.6, 1);
    y += reach;
    const m: Mechanism = {
      id: nid(ctx, 'saw'),
      kind: 'saw',
      pivot: { x, y },
      links: [{ shapes: sawShapes(radius, 10), motion: { type: 'rotate', speed: (rng.sign()) * rng.range(2.5, 4.5), phase: 0 } }],
      effect: null,
    };
    applyEffect(ctx, m, { x: 0, y: 0 });
    ctx.mechs.push(m);
    y += reach + 5.5;
    side = -side;
  }
  finishSeg(ctx, y - 2);
}

/* ------------------------------------------------------------------- pads */

function pads(ctx: Ctx): void {
  const { rng, cfg } = ctx;
  const ramps = zigzagRamps(ctx, rng.int(3, 4));
  const eff = cfg.objects.effects;
  const gp: ('grow' | 'shrink')[] = [];
  if (eff.grow) gp.push('grow');
  if (eff.shrink) gp.push('shrink');
  const orbs: ('attract' | 'repel' | 'stun')[] = [];
  if (eff.attract) orbs.push('attract');
  if (eff.repel) orbs.push('repel');
  if (eff.stun) orbs.push('stun');
  ramps.forEach((rp, i) => {
    const L = dist(rp.a, rp.b);
    const d = { x: (rp.b.x - rp.a.x) / L, y: (rp.b.y - rp.a.y) / L };
    const up = d.y * d.x >= 0 || true ? { x: d.y, y: -d.x } : { x: 0, y: -1 };
    const n = up.y < 0 ? up : { x: -up.x, y: -up.y };
    if (gp.length) {
      const t = rng.range(0.35, 0.6);
      const rad = rng.range(1.1, 1.5);
      const p = { x: rp.a.x + d.x * t * L + n.x * 0.6, y: rp.a.y + d.y * t * L + n.y * 0.6 };
      ctx.zones.push({
        id: nid(ctx, 'zone'),
        shape: { type: 'circle', center: p, radius: rad },
        effect: rng.pick(gp),
        strength: 0,
      });
      const z = ctx.zones[ctx.zones.length - 1];
      z.strength = z.effect === 'grow' ? 1.25 : 0.8;
    }
    if (orbs.length && i < ramps.length - 0) {
      const effect = rng.pick(orbs);
      const radius = rng.range(2, 3.2);
      // orb in the air at the gap column of this ramp
      const gx = rp.b.x + (rp.b.x > ctx.cx ? 1 : -1) * 1.6;
      if (effect === 'stun') {
        addTeslaCoil(ctx, { x: gx, y: rp.b.y + 1.0 }, Math.min(1.7, radius * 0.6));
        return;
      }
      const center: Vec =
        effect === 'attract' ? { x: gx, y: rp.b.y - 0.5 } : { x: gx, y: rp.b.y - 3.2 };
      ctx.zones.push({
        id: nid(ctx, 'zone'),
        shape: { type: 'circle', center, radius },
        effect,
        strength: effect === 'attract' ? rng.range(8, 11) : rng.range(10, 20),
      });
    }
  });
}

/* --------------------------------------------------------------- switches */

const LABELS: Record<SwitchActionType, string> = {
  lowGravity: 'Gravedad baja',
  highGravity: 'Gravedad alta',
  tiltGravity: 'Gravedad inclinada',
  reverseGravity: 'Gravedad invertida',
  reverseMechanisms: 'Mecanismos en reversa',
  fastMechanisms: 'Mecanismos rápidos',
  wind: 'Viento',
  bouncy: 'Modo rebote',
  openGate: 'Abrir compuerta',
};

/** Extra ramp below the current content (switch host). */
function tailRamp(ctx: Ctx): void {
  const { cx, hw, rng } = ctx;
  const gap = Math.max(3, 4 * ctx.R) + 0.6;
  const side = rampSide(ctx, rng.sign());
  const s = rng.range(14, 22) * DEG;
  const attachX = side < 0 ? cx - hw - 0.15 : cx + hw + 0.15;
  const freeX = side < 0 ? cx + hw - gap : cx - hw + gap;
  const y = ctx.y + 1.5;
  const a = { x: attachX, y };
  const b = { x: freeX, y: y + Math.abs(freeX - attachX) * Math.tan(s) };
  addRamp(ctx, a, b);
  finishSeg(ctx, b.y + 3);
}

function pickAction(ctx: Ctx, gateOk: boolean): SwitchActionType | null {
  const en = ctx.cfg.switches.actions;
  const all = (Object.keys(LABELS) as SwitchActionType[]).filter((k) => en[k] && (gateOk || k !== 'openGate'));
  const roll = ctx.rng.next();
  if (all.length === 0) return null;
  return all[Math.floor(roll * all.length)];
}

function placeOnRamp(ctx: Ctx, rp: Ramp, t: number, type: SwitchActionType, gateId?: string): void {
  const { rng, cfg } = ctx;
  const L = dist(rp.a, rp.b);
  let d = { x: (rp.b.x - rp.a.x) / L, y: (rp.b.y - rp.a.y) / L };
  if (d.x < 0) d = { x: -d.x, y: -d.y };
  const hh = 0.15;
  const hwid = rng.range(0.8, 1.1);
  const n = { x: d.y, y: -d.x };
  const nn = n.y < 0 ? n : { x: -n.x, y: -n.y };
  const base = { x: rp.a.x + ((rp.b.x - rp.a.x) / L) * t * L, y: rp.a.y + ((rp.b.y - rp.a.y) / L) * t * L };
  const off = hh + rp.thick / 2 + 0.02;
  let value = 0;
  let angle: number | undefined;
  let duration = cfg.switches.duration;
  switch (type) {
    case 'lowGravity':
      value = rng.range(0.35, 0.5);
      break;
    case 'highGravity':
      value = rng.range(1.6, 2);
      break;
    case 'tiltGravity':
      // tilts downhill along the host ramp (uphill tilt would trap marbles on the button);
      // kept gentle and short because ramps sloping the other way turn uphill while it lasts
      value = Math.sign(rp.b.x - rp.a.x) * rng.range(10, 18);
      rng.next();
      duration = Math.min(duration, 4);
      break;
    case 'reverseGravity':
      value = -rng.range(0.4, 0.6);
      duration = Math.min(duration, 2);
      break;
    case 'reverseMechanisms':
      value = -1;
      break;
    case 'fastMechanisms':
      value = rng.range(2, 3);
      break;
    case 'wind':
      // relative to gravity: wind tilts the effective gravity ~8-12 deg. Stronger wind (it used to be
      // 4-8 m/s^2, i.e. up to ~40 deg) pinned marbles against walls on every ramp facing it
      value = cfg.physics.gravity * rng.range(0.14, 0.22);
      angle = cfg.physics.gravityAngle + Math.sign(rp.b.x - rp.a.x) * 90; // blows downhill along the host ramp (never uphill: would trap marbles)
      rng.next();
      break;
    case 'bouncy':
      value = 0.9;
      break;
    case 'openGate':
      duration = 0;
      break;
  }
  addSwitchObj(ctx, {
    position: { x: base.x + nn.x * off, y: base.y + nn.y * off },
    halfWidth: hwid,
    halfHeight: hh,
    angle: Math.atan2(d.y, d.x),
    action: { type, value, ...(angle !== undefined ? { angle } : {}), ...(gateId ? { gateId } : {}) },
    mode: type === 'openGate' ? 'once' : 'timed',
    duration,
    label: LABELS[type],
  });
}

/** Maybe add a switch to the segment just built (uses ctx.ramps). */
export function maybeSwitch(ctx: Ctx, force: boolean): void {
  const sw = ctx.cfg.switches;
  if (!sw.enabled) return;
  const roll = ctx.rng.next();
  if (!force && roll >= sw.frequency) return;
  let type = pickAction(ctx, true);
  if (!type) return;
  if (ctx.ramps.length === 0) tailRamp(ctx);
  if (type === 'openGate' && ctx.ramps.length < 2) {
    // need a trap ramp after the host ramp
    tailRamp(ctx);
  }
  let gateId: string | undefined;
  if (type === 'openGate') {
    if (ctx.ramps.length < 2) type = pickAction(ctx, false);
    else {
      gateId = makeTrapdoor(ctx, ctx.ramps[1], 0.45, Math.max(3.4, 4.2 * ctx.R));
    }
  }
  if (!type) return;
  placeOnRamp(ctx, ctx.ramps[0], ctx.rng.range(0.3, 0.5), type, gateId);
}

function switchSeg(ctx: Ctx): void {
  zigzagRamps(ctx, 3);
  maybeSwitch(ctx, true);
}


/* ------------------------------------------------------ regroup segments */

function regroupSpeed(ctx: Ctx): number {
  // about as lively as the other mechanisms (~1.9 rad/s at the default difficulty; the round chamber
  // turns at 3/4 of it so it still carries marbles round to its exit)
  return 2.6 * (0.5 + 0.5 * ctx.diff) * ctx.rng.range(0.9, 1.1);
}

function addRotor(ctx: Ctx, x: number, y: number, L: number, blades: number, speed: number): void {
  ctx.mechs.push({
    id: nid(ctx, 'regroup'),
    kind: 'propeller',
    pivot: { x, y },
    links: [{ shapes: propellerShapes(blades, L, 0.4), motion: { type: 'rotate', speed, phase: ctx.rng.range(0, Math.PI * 2) } }],
    effect: null,
  });
}

function regroupAvailable(ctx: Ctx): boolean {
  return kindEnabled(ctx, 'propeller') && ctx.hw >= 3.4 && ctx.R <= 1.5;
}

interface RingOpts {
  /** ring centre-line radius */
  rho: number;
  /** half angle (deg) of the top opening, measured from straight up */
  e: number;
  /** slope (deg from horizontal) of the funnel walls feeding the opening */
  slope: number;
  /** on-screen angles (deg, y down: 90 = bottom) where the left / right arcs stop (exit gap in between) */
  leftEnd: number;
  rightEnd: number;
  blades: number;
  speed: number;
  /** Builds the rotor at (cx, cy) with tip radius L instead of the default propeller. */
  rotor?: (L: number, cx: number, cy: number) => void;
}

/**
 * Round chamber + funnel walls into its top opening + centred propeller (tip clearance TIP_GAP to
 * the ring). Returns the centre y.
 */
function rotorRing(ctx: Ctx, o: RingOpts): number {
  const { cx, hw } = ctx;
  const { rho, e } = o;
  const top = ctx.y + 1.2;
  const xl = cx - hw - 0.2;
  const xr = cx + hw + 0.2;
  const lipDx = rho * Math.sin(e * DEG);
  const lipY = top + (cx - lipDx - xl) * Math.tan(o.slope * DEG);
  const cy = lipY + rho * Math.cos(e * DEG);
  const left = [{ x: xl, y: top }, ...arcPts(cx, cy, rho, 270 - e, o.leftEnd)];
  const right = [{ x: xr, y: top }, ...arcPts(cx, cy, rho, 270 + e, o.rightEnd)];
  addChain(ctx, left, 'ramp');
  addChain(ctx, right, 'ramp');
  capEnd(ctx, left[left.length - 1]);
  capEnd(ctx, right[right.length - 1]);
  const L = rho - RING_T / 2 - TIP_GAP;
  if (o.rotor) o.rotor(L, cx, cy);
  else addRotor(ctx, cx, cy, L, o.blades, o.speed);
  pathTo(ctx, cx, top);
  pathTo(ctx, cx, cy);
  return cy;
}

/** 2 blades (one bar, two big half-disc pockets) most of the time, sometimes 3. */
const regroupBlades = (ctx: Ctx): number => (ctx.rng.bool(0.7) ? 2 : 3);

/**
 * Embudo con hélice: a V funnel whose neck is a rotary valve. Wide V walls open into a round
 * chamber (mouth +-58..68 deg from the top) with the propeller at its centre; marbles pile up on
 * the blades while the neck is blocked and drop out in batches through a bottom-centre opening
 * (about 1.4 m wider than the biggest marble).
 */
function funnelGate(ctx: Ctx): void {
  const { hw, rng } = ctx;
  const rho = clamp(rng.range(3.0, 3.5), 2.4, hw - 0.6);
  const e = rng.range(58, 68);
  const exitHalf = (Math.asin(clamp((ctx.R + 0.7) / rho, 0, 0.95)) * 180) / Math.PI;
  const blades = regroupBlades(ctx);
  const cy = rotorRing(ctx, { rho, e, slope: rng.range(36, 42), leftEnd: 90 + exitHalf, rightEnd: 450 - exitHalf, blades, speed: rng.sign() * regroupSpeed(ctx) });
  finishSeg(ctx, cy + rho + 2.8);
}

/**
 * Círculo con hélice: a rotary airlock. Steep funnel into a top opening, propeller at the centre,
 * exit opening low on one side (marbles must be carried round), then out and back to the corridor.
 */
function rotorChamber(ctx: Ctx): void {
  const { cx, hw, rng } = ctx;
  const rho = clamp(rng.range(3.4, 4.0), 2.4, hw - 0.6);
  const side = rng.sign(); // exit on this side (+1 = left)
  const e = rng.range(34, 40);
  // exit gap: about 1 m wider than the biggest marble, starting past the lowest point
  const gapNear = 100;
  const gapFar = gapNear + (2 * Math.asin(clamp((ctx.R + 0.5) / rho, 0, 0.95)) * 180) / Math.PI;
  const leftEnd = side > 0 ? gapFar : 180 - gapNear;
  const rightEnd = side > 0 ? 360 + gapNear : 360 + (180 - gapFar);
  const blades = regroupBlades(ctx);
  // clockwise for an exit on the left (anticlockwise mirrored): blades sweep the floor toward the exit
  const cy = rotorRing(ctx, { rho, e, slope: rng.range(44, 52), leftEnd, rightEnd, blades, speed: side * regroupSpeed(ctx) * 0.75 });
  pathTo(ctx, cx - side * rho * 0.3, cy + rho * 0.9);
  finishSeg(ctx, cy + rho + 2.8);
}

/* ------------------------------------------------------------------ gears */

/**
 * Engranes: one or two round chambers, each with a toothed gear turning inside it. Marbles drop
 * into the pockets between the teeth at the top and are carried round to an exit low on one side
 * (alternating sides), so every marble is moved by the gear. Pockets fit the biggest marble.
 */
function gears(ctx: Ctx): void {
  const { rng } = ctx;
  const n = rng.bool(0.45 + 0.3 * ctx.t) ? 2 : 1;
  let side = rng.sign();
  for (let k = 0; k < n; k++) {
    gearChamber(ctx, side);
    side = -side;
  }
}

function gearChamber(ctx: Ctx, side: number): void {
  const { cx, hw, rng } = ctx;
  // big wheel: a large hub with short teeth reads as a gear, and the pockets still fit a grown marble
  const rho = clamp(rng.range(4.6, 5.6), 2.4, hw - 0.9);
  const e = rng.range(34, 40);
  const gapNear = 100;
  const gapFar = gapNear + (2 * Math.asin(clamp((ctx.R + 0.5) / rho, 0, 0.95)) * 180) / Math.PI;
  const leftEnd = side > 0 ? gapFar : 180 - gapNear;
  const rightEnd = side > 0 ? 360 + gapNear : 360 + (180 - gapFar);
  const Lr = rho - RING_T / 2 - TIP_GAP;
  // ~4-6 m/s at the rim whatever the size
  const speed = side * clamp((4 + 2 * ctx.diff) / Lr, 0.8, 2.2) * rng.range(0.9, 1.1);
  const phase = rng.range(0, Math.PI * 2);
  const cy = rotorRing(ctx, {
    rho,
    e,
    slope: rng.range(44, 52),
    leftEnd,
    rightEnd,
    blades: 0,
    speed,
    rotor: (L, x, y) => {
      // pockets between tooth tips at least as wide as the biggest marble + margin
      // radial room hub..ring = 2R + 0.3 (incl. the tip gap); rim pocket >= 2R + 0.35
      const toothW = 0.8;
      const teeth = clamp(Math.floor((2 * Math.PI * L) / (2 * ctx.R + 0.35 + toothW * 0.84)), 4, 14);
      const hub = Math.max(0.6, L - 2 * ctx.R - 0.1);
      ctx.mechs.push({
        id: nid(ctx, 'gear'),
        kind: 'gear',
        pivot: { x, y },
        links: [{ shapes: gearShapes(teeth, L, hub, toothW), motion: { type: 'rotate', speed, phase } }],
        effect: null,
      });
    },
  });
  pathTo(ctx, cx - side * rho * 0.3, cy + rho * 0.9);
  ctx.dropSpots.push({ x: cx - side * rho * 0.35, y: cy + rho + 1.7 });
  finishSeg(ctx, cy + rho + 2.8);
}

/* ------------------------------------------------------------ trampolines */

/**
 * Trampolines: a funnel drops the marbles straight onto a tilted trampoline that throws them
 * across to a catch ramp on the other side, which rolls them into a second funnel + trampoline
 * throwing the other way. After a few throws a trampoline is a plain pad they roll off.
 */
function trampolines(ctx: Ctx): void {
  const { rng } = ctx;
  let side = rng.sign(); // direction of the first throw
  const g = Math.max(2, ctx.cfg.physics.gravity);
  for (let k = 0; k < 2; k++) {
    const { cx, hw } = ctx;
    const nx = cx - side * 1.2;
    const O = 2 * ctx.R + 0.8;
    const neckBottom = neckFunnel(ctx, ctx.y + 0.8, nx, O, Math.tan(38 * DEG), 1.0);
    // pad under the neck, rising toward -side so it throws up and toward +side
    const padY = neckBottom + 2.3;
    const half = 1.45;
    const tilt = rng.range(20, 28) * DEG;
    const c = Math.cos(tilt) * half;
    const s = Math.sin(tilt) * half;
    const pad = addWall(
      ctx,
      { type: 'polyline', thickness: 0.3, points: [{ x: nx - side * c, y: padY - s }, { x: nx + side * c, y: padY + s }] },
      'ramp',
      { reaction: 'solid' },
    );
    // same arc whatever the gravity
    pad.trampoline = 7.6 * Math.sqrt(g / 9.8);
    pathTo(ctx, nx, padY);
    // catch ramp from the +side wall, sloping down toward -side past the pad
    const a = { x: cx + side * (hw + 0.15), y: padY + 1.6 };
    const bx = cx - side * 1.6;
    const b = { x: bx, y: a.y + Math.abs(a.x - bx) * Math.tan(12 * DEG) };
    addRamp(ctx, a, b);
    pathTo(ctx, cx + side * hw * 0.5, a.y + 1);
    pathTo(ctx, bx, b.y + 0.6);
    finishSeg(ctx, b.y + 1.2);
    side = -side;
  }
  finishSeg(ctx, ctx.y + 1.5);
}

/* ---------------------------------------------------------------- library */

export interface SegmentDef {
  type: SegmentType;
  weight: number;
  run: (ctx: Ctx) => void;
  available: (ctx: Ctx) => boolean;
  /** True if the segment builds its own switch (don't add another). */
  ownSwitch?: boolean;
  /** Regroup segment: only placed by the generator's regroup planner, never picked randomly. */
  regroup?: boolean;
}

const anyEffectZone = (ctx: Ctx): boolean => Object.values(ctx.cfg.objects.effects).some(Boolean);

export const LIBRARY: SegmentDef[] = [
  { type: 'zigzag', weight: 3, run: zigzag, available: () => true },
  { type: 'funnel', weight: 2, run: funnel, available: () => true },
  { type: 'pegs', weight: 2.5, run: pegs, available: () => true },
  // gears replaced the open propeller / triangle / hammer rows, which marbles mostly flew past
  { type: 'gears', weight: 3.5, run: gears, available: (c) => kindEnabled(c, 'gear') && c.hw >= 3.4 },
  { type: 'lift', weight: 1.4, run: lift, available: liftAvailable, ownSwitch: true },
  { type: 'trampolines', weight: 1.6, run: trampolines, available: (c) => c.cfg.objects.trampolines !== false && c.hw >= 4.5 },
  { type: 'arms', weight: 1.5, run: arms, available: (c) => kindEnabled(c, 'arm2') },
  { type: 'saws', weight: 1.5, run: saws, available: (c) => kindEnabled(c, 'saw') },
  {
    type: 'pads',
    weight: 1.2,
    run: pads,
    available: (c) => c.cfg.objects.zones && anyEffectZone(c),
  },
  {
    type: 'switch',
    weight: 1.5,
    run: switchSeg,
    available: (c) => c.cfg.switches.enabled && Object.values(c.cfg.switches.actions).some(Boolean),
    ownSwitch: true,
  },
  { type: 'galton', weight: 1.2, run: galton, available: galtonAvailable, ownSwitch: true },
  { type: 'lanes', weight: 1.2, run: lanes, available: lanesAvailable, ownSwitch: true },
  { type: 'pinball', weight: 1, run: pinball, available: pinballAvailable, ownSwitch: true },
  { type: 'gableSplit', weight: 1, run: gableSplit, available: gableAvailable, ownSwitch: true },
  { type: 'funnelGate', weight: 1, run: funnelGate, available: regroupAvailable, regroup: true },
  { type: 'rotorChamber', weight: 1, run: rotorChamber, available: regroupAvailable, regroup: true },
];
