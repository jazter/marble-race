/** Obstacle segment library (canonical frame, flow toward +y). */
import type { SwitchActionType } from '../core/config';
import { DEG, clamp, dist } from '../core/math';
import type { Mechanism, Vec } from '../core/types';
import {
  BH,
  type Ctx,
  type Ramp,
  type Sweeper,
  addRamp,
  addSwitchObj,
  addWall,
  applyEffect,
  baseSpeed,
  extend,
  innerHalf,
  makeTrapdoor,
  maxSweepRadius,
  mechClearance,
  nid,
  pathTo,
  propellerShapes,
  rampSide,
  rowGap,
  sawShapes,
  sweeperXs,
  kindEnabled,
  makeFlipper,
  addTeslaCoil,
} from './util';
import { Rng } from '../core/rng';
import { galton, galtonAvailable, lanes, lanesAvailable } from './boards';
import { gableAvailable, gableSplit, pinball, pinballAvailable } from './pinball';

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
  | 'gableSplit';

const finishSeg = (ctx: Ctx, yEnd: number): void => {
  extend(ctx, yEnd);
  pathTo(ctx, ctx.cx, yEnd);
};

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

/* ------------------------------------------------- propellers / triangles */

function rowsOfSweepers(
  ctx: Ctx,
  rows: number,
  radiusFor: (n: number) => number | null,
): { rows: Sweeper[][]; ys: number[] } {
  const c = mechClearance(ctx);
  const out: Sweeper[][] = [];
  const ys: number[] = [];
  let y = ctx.y + 3;
  for (let i = 0; i < rows; i++) {
    let n = ctx.rng.bool(0.5) ? 2 : 1;
    let L = radiusFor(n);
    if (L === null) {
      n = 1;
      L = radiusFor(1);
    }
    if (L === null) break;
    const xs = sweeperXs(ctx, n, L);
    const row = xs.map((x) => ({ x, L: L as number }));
    if (out.length === 0) y += row[0].L;
    else y += Math.max(rowGap(out[out.length - 1], row, c), 2) ;
    out.push(row);
    ys.push(y);
  }
  ctx.y = y + 0;
  return { rows: out, ys };
}

function propellers(ctx: Ctx): void {
  const rng = ctx.rng;
  const rows = lerpInt(ctx, 1, 3);
  const { rows: rs, ys } = rowsOfSweepers(ctx, rows, (n) => {
    const m = maxSweepRadius(ctx, n);
    if (m < 1.8 && n > 1) return null;
    const mm = Math.max(1.2, m);
    return n === 1 ? Math.min(mm, rng.range(3.6, 5.4)) : mm * rng.range(0.85, 1);
  });
  let dir = rng.sign();
  rs.forEach((row, i) =>
    row.forEach((sw) => {
      const blades = rng.int(2, 4);
      const m: Mechanism = {
        id: nid(ctx, 'prop'),
        kind: 'propeller',
        pivot: { x: sw.x, y: ys[i] },
        links: [
          {
            shapes: propellerShapes(blades, sw.L, 0.4),
            motion: { type: 'rotate', speed: dir * baseSpeed(ctx), phase: rng.range(0, Math.PI * 2) },
          },
        ],
        effect: null,
      };
      applyEffect(ctx, m, { x: sw.L * 0.92, y: 0 });
      ctx.mechs.push(m);
      dir = -dir;
    }),
  );
  finishSeg(ctx, ys[ys.length - 1] + rs[rs.length - 1][0].L + 3);
}

function triangles(ctx: Ctx): void {
  const rng = ctx.rng;
  const rows = lerpInt(ctx, 1, 3);
  const { rows: rs, ys } = rowsOfSweepers(ctx, rows, (n) => {
    const m = maxSweepRadius(ctx, n);
    const want = rng.range(1.2, 1.8);
    return m >= 1.2 ? Math.min(m, want) : n === 1 ? want : null;
  });
  let dir = rng.sign();
  rs.forEach((row, i) =>
    row.forEach((sw) => {
      const rho = sw.L;
      const h = (rho * Math.sqrt(3)) / 2;
      const m: Mechanism = {
        id: nid(ctx, 'tri'),
        kind: 'triangle',
        pivot: { x: sw.x, y: ys[i] },
        links: [
          {
            shapes: [{ type: 'polygon', points: [{ x: rho, y: 0 }, { x: -rho / 2, y: h }, { x: -rho / 2, y: -h }] }],
            motion: { type: 'rotate', speed: dir * baseSpeed(ctx), phase: rng.range(0, Math.PI * 2) },
          },
        ],
        effect: null,
      };
      applyEffect(ctx, m, { x: rho, y: 0 });
      ctx.mechs.push(m);
      dir = -dir;
    }),
  );
  finishSeg(ctx, ys[ys.length - 1] + rs[rs.length - 1][0].L + 3);
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

/* ---------------------------------------------------------------- hammers */

function hammers(ctx: Ctx): void {
  const { rng } = ctx;
  const c = mechClearance(ctx);
  const count = lerpInt(ctx, 1, 2);
  let y = ctx.y + 1.5;
  for (let i = 0; i < count; i++) {
    const amp = rng.range(0.6, 1.1);
    const limit = innerHalf(ctx) - c;
    const Lh = clamp((limit - 0.7) / Math.sin(amp) - 0.5, 2.5, 8);
    const m: Mechanism = {
      id: nid(ctx, 'ham'),
      kind: 'hammer',
      pivot: { x: ctx.cx, y },
      links: [
        {
          shapes: [
            { type: 'box', cx: 0, cy: Lh / 2, hw: 0.12, hh: Lh / 2, angle: 0 },
            { type: 'box', cx: 0, cy: Lh + 0.2, hw: 0.7, hh: 0.3, angle: 0 },
          ],
          motion: { type: 'oscillate', center: 0, amplitude: amp, frequency: rng.range(0.3, 0.7), phase: rng.range(0, Math.PI * 2) },
        },
      ],
      effect: null,
    };
    applyEffect(ctx, m, { x: 0, y: Lh + 0.2 });
    ctx.mechs.push(m);
    y += Lh + 0.5 + 2.5;
  }
  finishSeg(ctx, y + 1);
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
      value = rng.range(4, 8);
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

const RING_T = 0.4;
/** Blade-tip to ring-wall clearance: well below the smallest marble diameter (2·r·minScale). */
const TIP_GAP = 0.2;

const arcPts = (cx: number, cy: number, rho: number, a0: number, a1: number): Vec[] => {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 9));
  const out: Vec[] = [];
  for (let i = 0; i <= n; i++) {
    const a = (a0 + ((a1 - a0) * i) / n) * DEG;
    out.push({ x: cx + rho * Math.cos(a), y: cy + rho * Math.sin(a) });
  }
  return out;
};

/** Polyline wall pieces of at most 10 points that share end points. */
function addChain(ctx: Ctx, pts: Vec[], style: 'ramp' | 'wall'): void {
  const CH = 10;
  for (let i = 0; i < pts.length - 1; i += CH - 1) {
    const piece = pts.slice(i, Math.min(pts.length, i + CH));
    if (piece.length >= 2) addWall(ctx, { type: 'polyline', thickness: RING_T, points: piece }, style, { reaction: 'solid' });
  }
}

/** Free end of a wall: round it so marbles never catch on the square edge. */
function capEnd(ctx: Ctx, p: Vec): void {
  addWall(ctx, { type: 'circle', center: p, radius: RING_T / 2 }, 'wall', { reaction: 'solid' });
}

function regroupSpeed(ctx: Ctx): number {
  return (0.5 + 0.5 * ctx.diff) * ctx.rng.range(0.9, 1.1);
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
  addRotor(ctx, cx, cy, L, o.blades, o.speed);
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
  { type: 'propellers', weight: 2, run: propellers, available: (c) => kindEnabled(c, 'propeller') },
  { type: 'arms', weight: 1.5, run: arms, available: (c) => kindEnabled(c, 'arm2') },
  { type: 'saws', weight: 1.5, run: saws, available: (c) => kindEnabled(c, 'saw') },
  { type: 'triangles', weight: 1.5, run: triangles, available: (c) => kindEnabled(c, 'triangle') },
  { type: 'hammers', weight: 1.5, run: hammers, available: (c) => kindEnabled(c, 'hammer') },
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
