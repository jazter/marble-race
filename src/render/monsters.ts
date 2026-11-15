/**
 * Monster drawing (Canvas 2D, world space, units = metres).
 *
 * Pure presentation: everything is derived from the static `Monster` definition,
 * the live `MonsterState` (positions / phase come from the simulation) and a
 * render clock (only cosmetic wiggles). Nothing here feeds back into the sim.
 */
import type { Monster, MonsterOf, Vec } from '../core/types';
import type { MonsterKind } from '../core/config';
import type { MonsterState, TentacleState } from '../sim/api';
import { alpha, darken, lighten, mix } from './color';

/** The minimum a marble needs to expose for the monsters to react to it. */
export interface EnvMarble {
  id: number;
  x: number;
  y: number;
  radius: number;
  status?: string;
}

export interface MonsterEnv {
  /** Render clock in seconds (cosmetic animation only). */
  clock: number;
  /** True when drawing without a simulation (map preview). */
  preview: boolean;
  marbles: readonly EnvMarble[];
  /** Redraw a marble on top of what has been drawn so far (so jaws can close over it). */
  redraw?: (m: EnvMarble) => void;
}

export const MONSTER_COLORS: Record<MonsterKind, string> = {
  spider: '#9a7bd6',
  octopus: '#e4578e',
  fish: '#3fb6d9',
  snake: '#62c04b',
};

export const MONSTER_NAMES: Record<MonsterKind, { article: string; name: string; by: string }> = {
  spider: { article: 'La', name: 'araña', by: 'la araña' },
  octopus: { article: 'El', name: 'pulpo', by: 'el pulpo' },
  fish: { article: 'El', name: 'pez', by: 'el pez' },
  snake: { article: 'La', name: 'serpiente', by: 'la serpiente' },
};

const TAU = Math.PI * 2;

/* ------------------------------------------------------------ helpers */

function hash01(id: string): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10007) / 10007;
}

function clamp(v: number, a: number, b: number): number {
  return Math.max(a, Math.min(b, v));
}
function smooth(t: number): number {
  t = clamp(t, 0, 1);
  return t * t * (3 - 2 * t);
}
function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function angDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function findMarble(env: MonsterEnv, id: number): EnvMarble | undefined {
  const m = env.marbles[id];
  if (m && m.id === id) return m;
  return env.marbles.find((x) => x.id === id);
}

/** Nearest live marble to (x,y) within maxD, optionally ignoring some ids. */
function nearestMarble(env: MonsterEnv, x: number, y: number, maxD: number, skip?: readonly number[]): EnvMarble | undefined {
  let best: EnvMarble | undefined;
  let bd = maxD * maxD;
  for (const m of env.marbles) {
    if (m.status === 'eliminated' || m.status === 'finished') continue;
    if (skip && skip.includes(m.id)) continue;
    const d = (m.x - x) ** 2 + (m.y - y) ** 2;
    if (d < bd) {
      bd = d;
      best = m;
    }
  }
  return best;
}

/** Two-bone IK. Returns knee and the (possibly clamped) end point. `bend` picks the side. */
function ik(sx: number, sy: number, tx: number, ty: number, l1: number, l2: number, bend: number): { kx: number; ky: number; ex: number; ey: number } {
  let dx = tx - sx;
  let dy = ty - sy;
  let d = Math.hypot(dx, dy) || 1e-6;
  const maxD = l1 + l2 - 1e-3;
  const minD = Math.abs(l1 - l2) + 1e-3;
  const dc = clamp(d, minD, maxD);
  dx = (dx / d) * dc;
  dy = (dy / d) * dc;
  d = dc;
  const a = (d * d + l1 * l1 - l2 * l2) / (2 * d);
  const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
  const ux = dx / d;
  const uy = dy / d;
  return { kx: sx + ux * a - uy * h * bend, ky: sy + uy * a + ux * h * bend, ex: sx + dx, ey: sy + dy };
}

function circle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
}

/** Closed outline of a tapered ribbon along `pts` (widths = full widths). */
function taperOutline(ctx: CanvasRenderingContext2D, pts: Vec[], widths: number[]): void {
  const n = pts.length;
  const L: Vec[] = [];
  const R: Vec[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let tx = b.x - a.x;
    let ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    tx /= l;
    ty /= l;
    const w = widths[i] / 2;
    L.push({ x: pts[i].x - ty * w, y: pts[i].y + tx * w });
    R.push({ x: pts[i].x + ty * w, y: pts[i].y - tx * w });
  }
  ctx.beginPath();
  ctx.moveTo(L[0].x, L[0].y);
  for (let i = 1; i < n; i++) ctx.lineTo(L[i].x, L[i].y);
  // rounded tip
  const e = pts[n - 1];
  const wE = widths[n - 1] / 2;
  const a0 = Math.atan2(L[n - 1].y - e.y, L[n - 1].x - e.x);
  ctx.arc(e.x, e.y, wE, a0, a0 - Math.PI, true);
  for (let i = n - 1; i >= 0; i--) ctx.lineTo(R[i].x, R[i].y);
  ctx.closePath();
}

function shine(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number, rot: number, a = 0.28): void {
  ctx.fillStyle = `rgba(255,255,255,${a})`;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, rot, 0, TAU);
  ctx.fill();
}

/* ---------------------------------------------------------- rest state */

/** A plausible at-rest state used by the map preview (no simulation). */
export function restState(def: Monster): MonsterState {
  switch (def.kind) {
    case 'spider': {
      return {
        id: def.id,
        kind: 'spider',
        phase: 'idle',
        phaseTime: 0,
        x: def.anchor.x + def.down.x * def.restLength,
        y: def.anchor.y + def.down.y * def.restLength,
        angle: Math.atan2(def.down.y, def.down.x),
        visible: 1,
        holding: [],
        threadLength: def.restLength,
      };
    }
    case 'octopus': {
      const tentacles: TentacleState[] = [];
      for (let i = 0; i < def.tentacles; i++) {
        const a = def.facing + Math.PI + ((i + 0.5) / def.tentacles) * TAU;
        const r = def.bodyRadius * 1.9;
        tentacles.push({ x: def.center.x + Math.cos(a + 0.35) * r, y: def.center.y + Math.sin(a + 0.35) * r, state: 'idle' });
      }
      return { id: def.id, kind: 'octopus', phase: 'idle', phaseTime: 0, x: def.center.x, y: def.center.y, angle: def.facing, visible: 1, holding: [], tentacles };
    }
    case 'fish': {
      return { id: def.id, kind: 'fish', phase: 'hunting', phaseTime: 0, x: def.a.x, y: def.a.y, angle: Math.atan2(def.b.y - def.a.y, def.b.x - def.a.x), visible: 1, holding: [], passFrom: def.a };
    }
    case 'snake': {
      const p = def.passes[0];
      const ang = Math.atan2(p.b.y - p.a.y, p.b.x - p.a.x);
      return {
        id: def.id,
        kind: 'snake',
        phase: 'hunting',
        phaseTime: 0,
        x: p.a.x + Math.cos(ang) * def.length,
        y: p.a.y + Math.sin(ang) * def.length,
        angle: ang,
        visible: 1,
        holding: [],
        passFrom: p.a,
      };
    }
  }
}

/** Rough world bounding boxes (for culling) of everything a monster may draw. */
export function monsterBounds(def: Monster): { x0: number; y0: number; x1: number; y1: number } {
  const pts: Vec[] = [];
  let pad = def.size * 3;
  switch (def.kind) {
    case 'spider': {
      pts.push(def.anchor, { x: def.anchor.x + def.down.x * def.maxLength, y: def.anchor.y + def.down.y * def.maxLength });
      pad = def.size * 4 + 1;
      break;
    }
    case 'octopus':
      pts.push(def.center);
      pad = def.reach + def.bodyRadius * 2 + 1;
      break;
    case 'fish':
      pts.push(def.a, def.b);
      pad = def.size * 5 + 1;
      break;
    case 'snake':
      for (const p of def.passes) pts.push(p.a, p.b);
      pad = def.length + def.size * 3 + 1;
      break;
  }
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of pts) {
    x0 = Math.min(x0, p.x);
    y0 = Math.min(y0, p.y);
    x1 = Math.max(x1, p.x);
    y1 = Math.max(y1, p.y);
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/* -------------------------------------------------------------- entry */

export function drawMonster(ctx: CanvasRenderingContext2D, def: Monster, st: MonsterState, env: MonsterEnv): void {
  if (def.kind === 'spider') drawSpider(ctx, def, st, env);
  else if (def.kind === 'octopus') drawOctopus(ctx, def, st, env);
  else if (def.kind === 'fish') drawFish(ctx, def, st, env);
  else drawSnake(ctx, def, st, env);
}

/** Faint dotted hints shown in the map preview. */
export function drawMonsterHint(ctx: CanvasRenderingContext2D, def: Monster): void {
  ctx.save();
  ctx.setLineDash([0.35, 0.45]);
  ctx.lineWidth = 0.09;
  ctx.lineCap = 'round';
  ctx.strokeStyle = alpha(MONSTER_COLORS[def.kind], 0.45);
  if (def.kind === 'spider') {
    ctx.beginPath();
    ctx.moveTo(def.anchor.x, def.anchor.y);
    ctx.lineTo(def.anchor.x + def.down.x * def.maxLength, def.anchor.y + def.down.y * def.maxLength);
    ctx.stroke();
    const e = { x: def.anchor.x + def.down.x * def.maxLength, y: def.anchor.y + def.down.y * def.maxLength };
    const px = -def.down.y * def.huntWidth;
    const py = def.down.x * def.huntWidth;
    ctx.beginPath();
    ctx.moveTo(def.anchor.x + px, def.anchor.y + py);
    ctx.lineTo(e.x + px, e.y + py);
    ctx.moveTo(def.anchor.x - px, def.anchor.y - py);
    ctx.lineTo(e.x - px, e.y - py);
    ctx.globalAlpha = 0.5;
    ctx.stroke();
  } else if (def.kind === 'octopus') {
    circle(ctx, def.center.x, def.center.y, def.reach);
    ctx.stroke();
  } else if (def.kind === 'fish') {
    ctx.beginPath();
    ctx.moveTo(def.a.x, def.a.y);
    ctx.lineTo(def.b.x, def.b.y);
    ctx.stroke();
    arrowHead(ctx, def.a, def.b);
  } else {
    for (const p of def.passes) {
      ctx.beginPath();
      ctx.moveTo(p.a.x, p.a.y);
      ctx.lineTo(p.b.x, p.b.y);
      ctx.stroke();
    }
    const p = def.passes[0];
    if (p) arrowHead(ctx, p.a, p.b);
  }
  ctx.restore();
}

function arrowHead(ctx: CanvasRenderingContext2D, a: Vec, b: Vec): void {
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(mx - Math.cos(ang - 0.5) * 0.9, my - Math.sin(ang - 0.5) * 0.9);
  ctx.lineTo(mx, my);
  ctx.lineTo(mx - Math.cos(ang + 0.5) * 0.9, my - Math.sin(ang + 0.5) * 0.9);
  ctx.stroke();
}

/* ============================================================== SPIDER */

const SP = {
  body: '#2a2140',
  bodyHi: '#4a3a70',
  rim: '#8f7bc4',
  leg: '#352a52',
  legEdge: '#0f0a1a',
  eye: '#c9ff5a',
  mark: '#ff6a3d',
};

function drawSpider(ctx: CanvasRenderingContext2D, def: MonsterOf<'spider'>, st: MonsterState, env: MonsterEnv): void {
  const s = def.size;
  const h = hash01(def.id);
  const t = env.clock + h * 20;
  const down = def.down;
  const phase = st.phase;
  const pt = st.phaseTime;

  // idle/returning sway: purely lateral, small
  const swayAmp = phase === 'idle' ? 0.14 : phase === 'returning' ? 0.06 : 0.02;
  const sway = Math.sin(t * 1.25) * swayAmp * s * 2 + Math.sin(t * 2.1 + 1) * swayAmp * 0.4;
  const px = -down.y;
  const py = down.x;
  const bx = st.x + px * sway;
  const by = st.y + py * sway;
  const rot = Math.atan2(down.y, down.x) - Math.PI / 2 + (sway / Math.max(2, Math.hypot(st.x - def.anchor.x, st.y - def.anchor.y))) * -1;

  // ---- silk thread
  const topX = bx - down.x * 1.75 * s;
  const topY = by - down.y * 1.75 * s;
  const ax = def.anchor.x;
  const ay = def.anchor.y;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = 'rgba(20,16,32,0.55)';
  ctx.lineWidth = 0.085;
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(topX, topY);
  ctx.stroke();
  ctx.strokeStyle = 'rgba(232,238,255,0.8)';
  ctx.lineWidth = 0.05;
  ctx.stroke();
  // glossy glint travelling down the thread
  const len = Math.hypot(topX - ax, topY - ay);
  if (len > 0.5) {
    const g = (t * 0.45) % 1;
    ctx.strokeStyle = 'rgba(255,255,255,0.95)';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(ax + (topX - ax) * g, ay + (topY - ay) * g);
    ctx.lineTo(ax + (topX - ax) * Math.min(1, g + 0.07), ay + (topY - ay) * Math.min(1, g + 0.07));
    ctx.stroke();
  }
  // silk tuft at the anchor
  ctx.fillStyle = 'rgba(230,236,255,0.85)';
  circle(ctx, ax, ay, 0.12);
  ctx.fill();
  ctx.strokeStyle = 'rgba(230,236,255,0.5)';
  ctx.lineWidth = 0.04;
  for (let i = -2; i <= 2; i++) {
    ctx.beginPath();
    ctx.moveTo(ax, ay);
    ctx.lineTo(ax + (px * i * 0.18 - down.x * 0.12), ay + (py * i * 0.18 - down.y * 0.12));
    ctx.stroke();
  }
  ctx.restore();

  // ---- body (local frame: +y = down, head toward +y)
  ctx.save();
  ctx.translate(bx, by);
  ctx.rotate(rot);
  const c2l = Math.cos(-rot);
  const s2l = Math.sin(-rot);
  const toLocal = (wx: number, wy: number): Vec => ({ x: (wx - bx) * c2l - (wy - by) * s2l, y: (wx - bx) * s2l + (wy - by) * c2l });

  // target marble (first held marble)
  let held: EnvMarble | undefined;
  for (const id of st.holding) {
    held = findMarble(env, id);
    if (held) break;
  }

  const legs = spiderLegPose(s, h, t, held ? toLocal(held.x, held.y) : null, held ? held.radius : 0, phase, pt);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // back legs first (right side = +x), then body, front legs on top of the marble
  for (const leg of legs) {
    ctx.strokeStyle = SP.legEdge;
    ctx.lineWidth = 0.19 * s + 0.07;
    ctx.beginPath();
    ctx.moveTo(leg.sx, leg.sy);
    ctx.lineTo(leg.kx, leg.ky);
    ctx.lineTo(leg.ex, leg.ey);
    ctx.stroke();
  }
  for (const leg of legs) {
    ctx.strokeStyle = SP.leg;
    ctx.lineWidth = 0.19 * s;
    ctx.beginPath();
    ctx.moveTo(leg.sx, leg.sy);
    ctx.lineTo(leg.kx, leg.ky);
    ctx.stroke();
    ctx.lineWidth = 0.13 * s;
    ctx.beginPath();
    ctx.moveTo(leg.kx, leg.ky);
    ctx.lineTo(leg.ex, leg.ey);
    ctx.stroke();
    // knee highlight + claw tip
    ctx.fillStyle = SP.bodyHi;
    circle(ctx, leg.kx, leg.ky, 0.115 * s);
    ctx.fill();
    ctx.fillStyle = '#d9cffa';
    circle(ctx, leg.ex, leg.ey, 0.06 * s);
    ctx.fill();
  }

  // abdomen
  const abY = -0.95 * s;
  const breathe = 1 + Math.sin(t * 2.4) * 0.025;
  ctx.fillStyle = SP.body;
  ctx.strokeStyle = SP.rim;
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.ellipse(0, abY, 0.82 * s * breathe, 0.98 * s * breathe, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  // markings: ember hourglass + dots
  ctx.fillStyle = SP.mark;
  ctx.beginPath();
  ctx.moveTo(-0.22 * s, abY - 0.5 * s);
  ctx.lineTo(0.22 * s, abY - 0.5 * s);
  ctx.lineTo(0.05 * s, abY - 0.05 * s);
  ctx.lineTo(0.22 * s, abY + 0.4 * s);
  ctx.lineTo(-0.22 * s, abY + 0.4 * s);
  ctx.lineTo(-0.05 * s, abY - 0.05 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = alpha(SP.rim, 0.55);
  for (const [dx, dy] of [
    [-0.5, -0.2],
    [0.5, -0.2],
    [-0.42, 0.35],
    [0.42, 0.35],
  ]) {
    circle(ctx, dx * s, abY + dy * s, 0.09 * s);
    ctx.fill();
  }
  shine(ctx, -0.3 * s, abY - 0.45 * s, 0.14 * s, 0.3 * s, 0.5, 0.22);

  // cephalothorax
  ctx.fillStyle = SP.body;
  ctx.strokeStyle = SP.rim;
  ctx.lineWidth = 0.07;
  circle(ctx, 0, 0, 0.58 * s);
  ctx.fill();
  ctx.stroke();
  shine(ctx, -0.18 * s, -0.18 * s, 0.14 * s, 0.09 * s, -0.5, 0.25);
  // fangs
  ctx.fillStyle = '#d9d0f5';
  for (const sx of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(sx * 0.14 * s, 0.5 * s);
    ctx.lineTo(sx * 0.07 * s, 0.82 * s + (phase === 'holding' ? 0.05 * s : 0));
    ctx.lineTo(sx * 0.02 * s, 0.52 * s);
    ctx.closePath();
    ctx.fill();
  }
  // glowing eyes (4, 6 or 8)
  const n = h < 0.34 ? 4 : h < 0.67 ? 6 : 8;
  const eyes: [number, number, number][] = [
    [0.18, 0.27, 0.115],
    [0.3, 0.1, 0.085],
    [0.1, 0.4, 0.06],
    [0.36, 0.28, 0.06],
  ];
  const glow = 0.75 + 0.25 * Math.sin(t * 3);
  for (let i = 0; i < Math.min(4, n / 2); i++) {
    for (const sx of [-1, 1]) {
      const [ex, ey, er] = eyes[i];
      ctx.fillStyle = `rgba(190,255,90,${0.22 * glow})`;
      circle(ctx, sx * ex * s, ey * s, er * s * 2.3);
      ctx.fill();
      ctx.fillStyle = SP.eye;
      circle(ctx, sx * ex * s, ey * s, er * s);
      ctx.fill();
      ctx.fillStyle = '#10200a';
      circle(ctx, sx * ex * s, ey * s + er * s * 0.15, er * s * 0.42);
      ctx.fill();
    }
  }
  ctx.restore();
}

interface Leg {
  sx: number;
  sy: number;
  kx: number;
  ky: number;
  ex: number;
  ey: number;
}

function spiderLegPose(s: number, h: number, t: number, held: Vec | null, heldR: number, phase: string, pt: number): Leg[] {
  const out: Leg[] = [];
  const l1 = 1.2 * s;
  const l2 = 1.65 * s;
  // front (down) to back (up)
  const restAng = [62, 24, -18, -58].map((d) => (d * Math.PI) / 180);
  const huntAng = [88, 58, 22, -15].map((d) => (d * Math.PI) / 180);
  const climbAng = [-8, -34, -62, -88].map((d) => (d * Math.PI) / 180);
  const shoulderY = [0.26, 0.1, -0.08, -0.24];
  const spread = smooth(pt / 0.5);
  for (let i = 0; i < 4; i++) {
    for (const sd of [-1, 1]) {
      const sx = sd * 0.42 * s;
      const sy = shoulderY[i] * s;
      let tx: number;
      let ty: number;
      const wob = t * (2.3 + i * 0.7) + sd * 1.7 + h * 9;
      if (held && phase !== 'idle') {
        // wrap around the marble: legs reach over its outline
        const beta = ((38 + i * 40) * Math.PI) / 180;
        const squeeze = 1.04 + Math.sin(t * 9 + i + sd) * 0.02;
        tx = held.x + sd * Math.sin(beta) * heldR * squeeze;
        ty = held.y + Math.cos(beta) * heldR * squeeze;
        // dive in from the rest pose while closing
        const k = smooth(pt / 0.35);
        const rx = sx + sd * Math.cos(restAng[i]) * 2.2 * s;
        const ry = sy + Math.sin(restAng[i]) * 2.2 * s;
        tx = lerp(rx, tx, phase === 'holding' ? k : 1);
        ty = lerp(ry, ty, phase === 'holding' ? k : 1);
      } else if (phase === 'hunting') {
        const a = lerp(restAng[i], huntAng[i], spread);
        const r = (2.2 + 0.5 * spread) * s + Math.sin(wob * 2.2) * 0.1 * s;
        tx = sx + sd * Math.cos(a) * r;
        ty = sy + Math.sin(a) * r;
      } else if (phase === 'returning') {
        const cyc = Math.sin(pt * 9 + i * 1.6 + (sd > 0 ? Math.PI : 0));
        const a = climbAng[i];
        const r = 2.2 * s;
        tx = sx + sd * Math.cos(a) * r + sd * 0.1 * s * cyc;
        ty = sy + Math.sin(a) * r - 0.4 * s * cyc;
      } else {
        // idle: relaxed stance with an occasional twitch of one leg
        const a = restAng[i] + Math.sin(wob) * 0.05;
        const tw = Math.pow(Math.max(0, Math.sin(t * 1.1 + i * 2.3 + sd * 1.1 + h * 30)), 14) * 0.6;
        const r = (2.15 + tw * 0.45) * s;
        tx = sx + sd * Math.cos(a - sd * tw * 0.4) * r;
        ty = sy + Math.sin(a - sd * tw * 0.4) * r + Math.sin(wob * 1.3) * 0.05 * s;
      }
      // knee bends "up and outward" (toward -y)
      const k1 = l1 * (1 + (i - 1.5) * 0.1);
      const k2 = l2 * (1 - (i - 1.5) * 0.08);
      const solve = ik(sx, sy, tx, ty, k1, k2, 1);
      const alt = ik(sx, sy, tx, ty, k1, k2, -1);
      const wrapping = !!held && phase !== 'idle';
      const best = wrapping ? (sd * (solve.kx - sx) > sd * (alt.kx - sx) ? solve : alt) : solve.ky < alt.ky ? solve : alt;
      out.push({ sx, sy, kx: best.kx, ky: best.ky, ex: best.ex, ey: best.ey });
    }
  }
  return out;
}

/* ============================================================= OCTOPUS */

const OC = {
  body: '#c23a78',
  dark: '#7d1f4d',
  light: '#f27ab0',
  cup: '#ffd0e2',
  spot: '#8d2a5a',
};

interface TPoint extends Vec {
  w: number;
}

function drawOctopus(ctx: CanvasRenderingContext2D, def: MonsterOf<'octopus'>, st: MonsterState, env: MonsterEnv): void {
  const R = def.bodyRadius;
  const cx = def.center.x;
  const cy = def.center.y;
  const h = hash01(def.id);
  const t = env.clock + h * 17;
  const facing = def.facing;
  const dirx = Math.cos(facing);
  const diry = Math.sin(facing);
  const n = Math.max(1, def.tentacles);
  const tents = st.tentacles ?? [];

  // look target: held / grabbed marble, else the nearest free marble nearby
  let look: Vec | null = null;
  let bestD = Infinity;
  for (const tt of tents) {
    if (tt.marbleId === undefined) continue;
    const m = findMarble(env, tt.marbleId);
    if (!m) continue;
    const d = (m.x - cx) ** 2 + (m.y - cy) ** 2;
    if (d < bestD) {
      bestD = d;
      look = m;
    }
  }
  if (!look) {
    const near = nearestMarble(env, cx, cy, def.reach * 1.4);
    if (near) look = near;
  }

  // ---- tentacles (under the body)
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const order: number[] = [];
  for (let i = 0; i < n; i++) order.push(i);
  // draw reaching/holding ones last so they stay on top of the idle ones
  order.sort((a, b) => weight(tents[a]) - weight(tents[b]));
  for (const i of order) {
    const tt = tents[i];
    const base = def.facing + Math.PI + ((i + 0.5) / n) * TAU;
    drawTentacle(ctx, def, tt, i, base, t, env, h);
  }
  ctx.restore();

  // ---- body + mantle
  ctx.save();
  const breathe = 1 + Math.sin(t * 1.9) * 0.018;
  ctx.fillStyle = OC.body;
  ctx.strokeStyle = OC.dark;
  ctx.lineWidth = 0.09;
  circle(ctx, cx, cy, R * breathe);
  ctx.fill();
  ctx.stroke();
  // mantle (head) over the body
  ctx.translate(cx + dirx * R * 0.38, cy + diry * R * 0.38);
  ctx.rotate(facing);
  const grad = ctx.createRadialGradient(R * 0.25, -R * 0.2, R * 0.1, 0, 0, R * 1.2);
  grad.addColorStop(0, OC.light);
  grad.addColorStop(0.55, OC.body);
  grad.addColorStop(1, darken(OC.body, 0.2));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.ellipse(0, 0, R * 1.05 * breathe, R * 0.98 * breathe, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  // spots
  ctx.fillStyle = alpha(OC.spot, 0.55);
  for (const [sx, sy, sr] of [
    [0.55, -0.35, 0.13],
    [0.7, 0.2, 0.09],
    [0.3, 0.45, 0.11],
    [0.2, -0.6, 0.08],
    [0.62, 0.52, 0.07],
  ]) {
    circle(ctx, sx * R, sy * R, sr * R);
    ctx.fill();
  }
  shine(ctx, R * 0.45, -R * 0.45, R * 0.3, R * 0.13, -0.6, 0.25);
  ctx.restore();

  // ---- eyes (in world orientation, on the lower head)
  const blink = blinkAmount(t, h);
  const happy = st.phase === 'holding';
  const ex0 = cx + dirx * R * 0.05;
  const ey0 = cy + diry * R * 0.05;
  const perpX = -diry;
  const perpY = dirx;
  for (const sd of [-1, 1]) {
    const ex = ex0 + perpX * sd * R * 0.5;
    const ey = ey0 + perpY * sd * R * 0.5;
    const er = R * 0.3;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(facing);
    ctx.scale(1, Math.max(0.08, 1 - blink));
    ctx.fillStyle = '#fffaf2';
    ctx.strokeStyle = OC.dark;
    ctx.lineWidth = 0.06;
    circle(ctx, 0, 0, er);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    // pupil follows the target
    let lx = 0;
    let ly = 0;
    if (look) {
      const dx = look.x - ex;
      const dy = look.y - ey;
      const d = Math.hypot(dx, dy) || 1;
      const k = Math.min(1, d / (R * 1.5));
      lx = (dx / d) * er * 0.42 * k;
      ly = (dy / d) * er * 0.42 * k;
    } else {
      lx = dirx * er * 0.15;
      ly = diry * er * 0.15;
    }
    if (blink < 0.7) {
      ctx.fillStyle = '#1a0f1c';
      circle(ctx, ex + lx, ey + ly, er * 0.5);
      ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.9)';
      circle(ctx, ex + lx - er * 0.16, ey + ly - er * 0.18, er * 0.15);
      ctx.fill();
    }
    // brow: friendly curve when holding, slightly angry when hunting
    ctx.strokeStyle = OC.dark;
    ctx.lineWidth = 0.08;
    ctx.beginPath();
    const tilt = st.phase === 'hunting' ? -0.35 * sd : happy ? 0.12 * sd : 0;
    const bx = ex + dirx * er * 1.15;
    const by = ey + diry * er * 1.15;
    ctx.moveTo(bx - perpX * er * 0.95 * sd + dirx * tilt * er * 0.3, by - perpY * er * 0.95 * sd + diry * tilt * er * 0.3);
    ctx.lineTo(bx + perpX * er * 0.95 * sd - dirx * tilt * er * 0.3, by + perpY * er * 0.95 * sd - diry * tilt * er * 0.3);
    ctx.stroke();
  }
  // little mouth between the eyes
  ctx.strokeStyle = OC.dark;
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  const mx = cx - dirx * R * 0.38;
  const my = cy - diry * R * 0.38;
  ctx.arc(mx, my, R * 0.16, facing + Math.PI * 0.15 + (happy ? 0 : 0.2), facing + Math.PI * 0.85 - (happy ? 0 : 0.2));
  ctx.stroke();
}

function weight(t?: TentacleState): number {
  if (!t) return 0;
  return t.state === 'hold' ? 3 : t.state === 'reach' ? 2 : t.state === 'retract' ? 1 : 0;
}

function blinkAmount(t: number, h: number): number {
  const period = 4.3 + h * 2;
  const k = (t % period) / period;
  if (k > 0.96) return Math.sin(((k - 0.96) / 0.04) * Math.PI);
  return 0;
}

function drawTentacle(
  ctx: CanvasRenderingContext2D,
  def: MonsterOf<'octopus'>,
  tt: TentacleState | undefined,
  i: number,
  baseAng: number,
  t: number,
  env: MonsterEnv,
  h: number,
): void {
  const R = def.bodyRadius;
  const cx = def.center.x;
  const cy = def.center.y;
  const state = tt?.state ?? 'idle';
  // tentacle tip (fallback: a relaxed pose near the rim)
  let tipX: number;
  let tipY: number;
  if (tt) {
    tipX = tt.x;
    tipY = tt.y;
  } else {
    tipX = cx + Math.cos(baseAng + 0.35) * R * 1.9;
    tipY = cy + Math.sin(baseAng + 0.35) * R * 1.9;
  }
  // the root drifts toward the tip's direction so arms don't criss-cross the body
  const tipAng = Math.atan2(tipY - cy, tipX - cx);
  const ang = baseAng + angDiff(baseAng, tipAng) * 0.45;
  const outx = Math.cos(ang);
  const outy = Math.sin(ang);
  const p0x = cx + outx * R * 0.78;
  const p0y = cy + outy * R * 0.78;

  // held marble → wrap
  let marble: EnvMarble | undefined;
  if (tt?.marbleId !== undefined && (state === 'hold' || state === 'reach' || state === 'retract')) marble = findMarble(env, tt.marbleId);
  const wrap = marble && state === 'hold';
  const sumReach = Math.hypot(tipX - p0x, tipY - p0y);

  // endpoint of the base curve
  let ex = tipX;
  let ey = tipY;
  let wrapAng = 0;
  let wrapDir = 1;
  const wr = marble ? marble.radius * 1.0 : 0;
  if (wrap && marble) {
    // Arrive at the side of the marble where the circle's tangent matches the arm's
    // approach direction, then keep turning the same way: no hook before the wrap.
    const dAng = Math.atan2(marble.y - p0y, marble.x - p0x);
    const sgn = i % 2 === 0 ? 1 : -1;
    wrapAng = dAng + sgn * Math.PI * 0.5;
    wrapDir = -sgn;
    ex = marble.x + Math.cos(wrapAng) * wr * 1.12;
    ey = marble.y + Math.sin(wrapAng) * wr * 1.12;
  }

  // Centre-line: a smooth Hermite curve from the root (leaving the body outward) to the
  // end point, so the arm flows without kinks; a slow travelling sway whose amplitude grows
  // toward the tip makes it look like it floats. Tips only bend slightly (no spirals).
  const L = Math.hypot(ex - p0x, ey - p0y) || 0.01;
  const chordAng = Math.atan2(ey - p0y, ex - p0x);
  const startAng = ang + angDiff(ang, chordAng) * 0.55;
  const swayAmt = state === 'reach' ? 0.24 : state === 'hold' ? 0.1 : 0.38;
  let endAng = chordAng + Math.sin(t * 0.85 + i * 1.7 + h * 5) * swayAmt;
  if (wrap) endAng = wrapAng + wrapDir * Math.PI * 0.5; // meet the marble tangentially
  const tg = L * 0.95;
  const m0x = Math.cos(startAng) * tg;
  const m0y = Math.sin(startAng) * tg;
  const m1x = Math.cos(endAng) * tg;
  const m1y = Math.sin(endAng) * tg;
  const lnx = -Math.sin(chordAng);
  const lny = Math.cos(chordAng);
  const waveAmp = R * (state === 'idle' ? 0.13 : state === 'retract' ? 0.11 : state === 'reach' ? 0.08 : 0.05);
  const wave = t * 1.5 + i * 0.95 + h * 6;

  const STEPS = 24;
  const pts: TPoint[] = [];
  for (let k = 0; k <= STEPS; k++) {
    const u = k / STEPS;
    const u2 = u * u;
    const u3 = u2 * u;
    const h00 = 2 * u3 - 3 * u2 + 1;
    const h10 = u3 - 2 * u2 + u;
    const h01 = -2 * u3 + 3 * u2;
    const h11 = u3 - u2;
    const bx = h00 * p0x + h10 * m0x + h01 * ex + h11 * m1x;
    const by = h00 * p0y + h10 * m0y + h01 * ey + h11 * m1y;
    // zero at the root and at the very end (so wraps stay attached), strongest near 3/4
    const env = Math.sin(Math.PI * u) * (0.35 + 0.65 * u);
    const lat = Math.sin(u * 5.0 - wave) * waveAmp * env;
    pts.push({ x: bx + lnx * lat, y: by + lny * lat, w: 0 });
  }

  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  if (wrap && marble) {
    // one gentle turn around the marble, continuing the arm's direction
    const sweep = (1.05 + 0.08 * Math.sin(t * 2.2 + i)) * Math.PI;
    const rr0 = wr * 1.12;
    for (let k = 1; k <= 12; k++) {
      const u = k / 12;
      const a = wrapAng + wrapDir * sweep * u;
      const rr = rr0 - wr * 0.06 * u;
      pts.push({ x: marble.x + Math.cos(a) * rr, y: marble.y + Math.sin(a) * rr, w: 0 });
    }
  } else if (state === 'idle' || state === 'retract') {
    // relaxed tip: a slight bend (~40-60 degrees) that breathes a little
    let th = Math.atan2(last.y - prev.y, last.x - prev.x);
    const dir = i % 2 === 0 ? 1 : -1;
    const bend = (state === 'idle' ? 0.85 : 0.5) + 0.2 * Math.sin(t * 1.1 + i * 2.3);
    let px = last.x;
    let py = last.y;
    const steps = 6;
    const seg = Math.min(R * 0.11, (L / STEPS) * 1.1);
    for (let k = 1; k <= steps; k++) {
      th += (bend / steps) * dir;
      const ds = seg * (1 - 0.08 * k);
      px += Math.cos(th) * ds;
      py += Math.sin(th) * ds;
      pts.push({ x: px, y: py, w: 0 });
    }
  }

  // widths: strong taper
  const total = pts.length;
  const w0 = Math.min(0.5 * R, 0.62);
  for (let k = 0; k < total; k++) {
    const u = k / (total - 1);
    pts[k].w = Math.max(0.05, w0 * Math.pow(1 - u, 0.85) + 0.05);
  }
  void sumReach;

  const col = state === 'hold' ? mix(OC.body, '#ff7fb5', 0.25) : OC.body;
  taperOutline(
    ctx,
    pts,
    pts.map((p) => p.w),
  );
  ctx.fillStyle = col;
  ctx.fill();
  ctx.strokeStyle = OC.dark;
  ctx.lineWidth = 0.07;
  ctx.stroke();
  // lighter centre stripe
  ctx.strokeStyle = alpha(OC.light, 0.35);
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  for (let k = 1; k < total - 3; k++) {
    const p = pts[k];
    if (k === 1) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
  // suction cups
  ctx.fillStyle = OC.cup;
  for (let k = 3; k < total - 1; k += 2) {
    const a = pts[k - 1];
    const b = pts[Math.min(total - 1, k + 1)];
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    const p = pts[k];
    const off = p.w * 0.12;
    circle(ctx, p.x - (ty / l) * off, p.y + (tx / l) * off, Math.max(0.018, p.w * 0.2));
    ctx.fill();
  }
}

/* ================================================================ FISH */

const FI = {
  top: '#1f7fb3',
  mid: '#3fb6d9',
  belly: '#d7f1f7',
  fin: '#ff9a3c',
  finEdge: '#b3571a',
  edge: '#0c3550',
};

function drawFish(ctx: CanvasRenderingContext2D, def: MonsterOf<'fish'>, st: MonsterState, env: MonsterEnv): void {
  if (st.phase === 'hidden' || st.visible <= 0.01) return;
  const size = def.size;
  const h = hash01(def.id);
  const t = env.clock;
  const ang = st.angle;
  const dirx = Math.cos(ang);
  const diry = Math.sin(ang);
  const flip = dirx < 0 ? -1 : 1;

  const Lf = 4.2 * size;
  const H = 1.0 * size;

  let held: EnvMarble | undefined;
  for (const id of st.holding) {
    held = findMarble(env, id);
    if (held) break;
  }
  let open = 0;
  let mouthX = st.x;
  let mouthY = st.y;
  if (held) {
    // marble sits in the gape: nose is a little ahead of the marble centre
    const lx = 0.4 * held.radius;
    const ly = 0.14 * H * flip;
    mouthX = held.x - (dirx * lx - diry * ly);
    mouthY = held.y - (diry * lx + dirx * ly);
    open = 0.62 + 0.05 * Math.sin(t * 7);
  } else if (!env.preview) {
    const near = nearestMarble(env, st.x + dirx * size * 1.2, st.y + diry * size * 1.2, size * 4.5);
    if (near) {
      const fx = near.x - st.x;
      const fy = near.y - st.y;
      const ahead = fx * dirx + fy * diry;
      const side = Math.abs(-fx * diry + fy * dirx);
      if (ahead > -size * 0.5 && side < size * 2.2) open = smooth(1 - Math.max(0, ahead) / (size * 4.5)) * 0.95;
    }
  }

  ctx.save();
  ctx.globalAlpha *= clamp(st.visible, 0, 1);
  ctx.translate(mouthX, mouthY);
  ctx.rotate(ang);
  ctx.scale(1, flip);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  const SEG = 24;
  const swim = t * 9 + h * 5;
  const spineY = (x: number): number => {
    const u = clamp(-x / Lf, 0, 1);
    return Math.sin(swim + u * 3.2) * 0.14 * Lf * u * u;
  };
  const half = (u: number): number => {
    const f = Math.pow(u + 0.0001, 0.55) * Math.pow(1 - u, 1.1);
    return Math.max(0.06 * H, (f / 0.4) * H);
  };
  const top: Vec[] = [];
  const bot: Vec[] = [];
  const spine: Vec[] = [];
  for (let k = 0; k <= SEG; k++) {
    const u = k / SEG;
    const x = -u * Lf;
    const y = spineY(x);
    const hw = half(u);
    spine.push({ x, y });
    top.push({ x, y: y - hw * 0.98 });
    bot.push({ x, y: y + hw * 1.02 });
  }
  const tail = spine[SEG];
  const slope = Math.atan2(spine[SEG].y - spine[SEG - 2].y, spine[SEG].x - spine[SEG - 2].x);
  const wag = Math.sin(swim + 3.4) * 0.45;

  // tail fin
  ctx.save();
  ctx.translate(tail.x, tail.y);
  ctx.rotate(slope - Math.PI + wag);
  const tf = 1.35 * H;
  ctx.fillStyle = FI.fin;
  ctx.strokeStyle = FI.finEdge;
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(tf * 0.5, -tf * 0.2, tf * 1.05, -tf * 0.95);
  ctx.quadraticCurveTo(tf * 0.7, -tf * 0.05, tf * 0.85, 0.02);
  ctx.quadraticCurveTo(tf * 0.7, tf * 0.1, tf * 1.05, tf * 0.95);
  ctx.quadraticCurveTo(tf * 0.5, tf * 0.2, 0, 0);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = alpha(FI.finEdge, 0.5);
  ctx.lineWidth = 0.04;
  for (const ky of [-0.5, 0, 0.5]) {
    ctx.beginPath();
    ctx.moveTo(tf * 0.1, 0);
    ctx.lineTo(tf * 0.9, ky * tf * 0.85);
    ctx.stroke();
  }
  ctx.restore();

  // dorsal + pelvic fins
  const fin = (u0: number, u1: number, hgt: number, sign: number, sway: number): void => {
    const k0 = Math.round(u0 * SEG);
    const k1 = Math.round(u1 * SEG);
    const edge = sign < 0 ? top : bot;
    ctx.fillStyle = FI.fin;
    ctx.strokeStyle = FI.finEdge;
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.moveTo(edge[k0].x, edge[k0].y);
    ctx.quadraticCurveTo(edge[k0].x - 0.06 * Lf + sway, edge[k0].y + sign * hgt * 1.1, edge[k1].x + sway * 1.5 - 0.04 * Lf, edge[k1].y + sign * hgt * 0.35);
    ctx.lineTo(edge[k1].x, edge[k1].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };
  fin(0.3, 0.64, 0.95 * H, -1, Math.sin(swim * 0.5) * 0.05 * Lf);
  fin(0.46, 0.64, 0.55 * H, 1, Math.sin(swim * 0.5 + 1) * 0.04 * Lf);

  // body: upper part only near the head (the lower jaw is a separate piece)
  const hk = Math.round(0.27 * SEG);
  const hinge: Vec = { x: spine[hk].x, y: spine[hk].y + H * 0.2 };
  const jaw0 = 0.05 * H;
  const bodyPath = (): void => {
    ctx.beginPath();
    ctx.moveTo(0, 0);
    for (let k = 1; k <= SEG; k++) ctx.lineTo(top[k].x, top[k].y);
    for (let k = SEG; k >= hk; k--) ctx.lineTo(bot[k].x, bot[k].y);
    ctx.lineTo(hinge.x, hinge.y);
    ctx.closePath();
  };
  const grad = ctx.createLinearGradient(0, -H, 0, H);
  grad.addColorStop(0, FI.top);
  grad.addColorStop(0.5, FI.mid);
  grad.addColorStop(0.82, FI.belly);
  grad.addColorStop(1, FI.belly);
  const paintBody = (): void => {
    ctx.fillStyle = grad;
    bodyPath();
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.fillStyle = 'rgba(8,50,90,0.28)';
    for (const u of [0.45, 0.58, 0.71]) {
      const k = Math.round(u * SEG);
      const px = spine[k].x;
      const w = 0.05 * Lf;
      ctx.beginPath();
      ctx.moveTo(px + w, top[k].y - 0.2);
      ctx.lineTo(px - w, top[k].y - 0.2);
      ctx.lineTo(px - w * 1.4, bot[k].y + 0.2);
      ctx.lineTo(px + w * 0.6, bot[k].y + 0.2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.lineWidth = 0.035;
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 5; c++) {
        const k = Math.round((0.3 + c * 0.1 + (r % 2) * 0.05) * SEG);
        ctx.beginPath();
        ctx.arc(spine[k].x, spine[k].y + (r - 1) * H * 0.34, H * 0.2, -Math.PI * 0.45, Math.PI * 0.45);
        ctx.stroke();
      }
    }
    shine(ctx, spine[8].x, spine[8].y - H * 0.55, Lf * 0.14, H * 0.1, 0, 0.3);
    ctx.restore();
    ctx.strokeStyle = FI.edge;
    ctx.lineWidth = 0.09;
    bodyPath();
    ctx.stroke();
  };
  paintBody();

  // gill arc + pectoral fin
  ctx.strokeStyle = alpha(FI.edge, 0.55);
  ctx.lineWidth = 0.06;
  const gk = Math.round(0.36 * SEG);
  ctx.beginPath();
  ctx.arc(spine[gk].x + 0.1 * H, spine[gk].y, H * 0.6, Math.PI * 0.62, Math.PI * 1.38);
  ctx.stroke();
  const pk = Math.round(0.42 * SEG);
  ctx.save();
  ctx.translate(spine[pk].x, spine[pk].y + H * 0.2);
  ctx.rotate(0.5 + Math.sin(swim * 0.9) * 0.35);
  ctx.fillStyle = alpha(FI.fin, 0.95);
  ctx.strokeStyle = FI.finEdge;
  ctx.lineWidth = 0.05;
  ctx.beginPath();
  ctx.ellipse(-0.25 * H, 0.2 * H, 0.5 * H, 0.22 * H, 0.5, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.restore();

  // gape (dark wedge between the lip line and the opened lower jaw)
  const jawA = open * 0.9;
  const jawTip: Vec = { x: 0, y: jaw0 };
  const rot = (p: Vec, a: number): Vec => {
    const dx = p.x - hinge.x;
    const dy = p.y - hinge.y;
    return { x: hinge.x + dx * Math.cos(a) - dy * Math.sin(a), y: hinge.y + dx * Math.sin(a) + dy * Math.cos(a) };
  };
  if (open > 0.03) {
    const tipR = rot(jawTip, jawA);
    ctx.fillStyle = '#3a0d1c';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(hinge.x, hinge.y);
    ctx.lineTo(tipR.x, tipR.y);
    ctx.closePath();
    ctx.fill();
  }

  // held marble is redrawn inside the gape, then the upper head goes back on top
  if (held && env.redraw) {
    env.redraw(held);
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(1.2 * size, -3 * H);
    ctx.lineTo(1.2 * size, -0.02);
    ctx.lineTo(0, 0);
    ctx.lineTo(hinge.x, hinge.y);
    ctx.lineTo(hinge.x - 0.3 * Lf, hinge.y);
    ctx.lineTo(hinge.x - 0.3 * Lf, -3 * H);
    ctx.closePath();
    ctx.clip();
    paintBody();
    ctx.restore();
  }

  // lower jaw (wedge hinged at the cheek)
  ctx.save();
  ctx.translate(hinge.x, hinge.y);
  ctx.rotate(jawA);
  ctx.translate(-hinge.x, -hinge.y);
  ctx.fillStyle = FI.belly;
  ctx.strokeStyle = FI.edge;
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  ctx.moveTo(hinge.x, hinge.y);
  ctx.lineTo(jawTip.x, jawTip.y);
  for (let k = 1; k <= hk; k++) ctx.lineTo(bot[k].x, bot[k].y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  if (open > 0.15) {
    ctx.fillStyle = '#ffffff';
    for (let k = 0; k < 4; k++) {
      const tx = -0.04 * Lf - k * 0.045 * Lf;
      ctx.beginPath();
      ctx.moveTo(tx - 0.07, jaw0 + (hinge.y - jaw0) * (-tx / -hinge.x) - 0.01);
      ctx.lineTo(tx, jaw0 + (hinge.y - jaw0) * (-tx / -hinge.x) - 0.17 * H);
      ctx.lineTo(tx + 0.07, jaw0 + (hinge.y - jaw0) * (-tx / -hinge.x) - 0.01);
      ctx.closePath();
      ctx.fill();
    }
  }
  ctx.restore();
  // smile line when closed
  if (open < 0.1) {
    ctx.strokeStyle = FI.edge;
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.moveTo(0.0, 0.0);
    ctx.lineTo(hinge.x * 0.8, hinge.y * 0.9);
    ctx.stroke();
  }

  // eye
  const ek = Math.round(0.2 * SEG);
  const ex = spine[ek].x;
  const ey = spine[ek].y - H * 0.3;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = FI.edge;
  ctx.lineWidth = 0.06;
  circle(ctx, ex, ey, H * 0.3);
  ctx.fill();
  ctx.stroke();
  let lx = H * 0.08;
  let ly = 0;
  const tgt = held ?? nearestMarble(env, st.x, st.y, size * 5);
  if (tgt) {
    const wx = tgt.x - mouthX;
    const wy = tgt.y - mouthY;
    const lxw = wx * dirx + wy * diry;
    const lyw = (-wx * diry + wy * dirx) * flip;
    const d = Math.hypot(lxw, lyw) || 1;
    lx = (lxw / d) * H * 0.11;
    ly = (lyw / d) * H * 0.11;
  }
  ctx.fillStyle = '#10202a';
  circle(ctx, ex + lx, ey + ly, H * 0.16);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  circle(ctx, ex + lx - H * 0.05, ey + ly - H * 0.06, H * 0.05);
  ctx.fill();
  ctx.restore();
}


/* =============================================================== SNAKE */

const SN = {
  body: '#58b948',
  dark: '#256b32',
  belly: '#d9ec9a',
  edge: '#12361c',
  tongue: '#ff3d55',
};

function drawSnake(ctx: CanvasRenderingContext2D, def: MonsterOf<'snake'>, st: MonsterState, env: MonsterEnv): void {
  if (st.phase === 'hidden' || st.visible <= 0.01) return;
  const size = def.size;
  const h = hash01(def.id);
  const t = env.clock + h * 11;
  const ang = st.angle;
  const dx = Math.cos(ang);
  const dy = Math.sin(ang);
  const nx = -dy;
  const ny = dx;

  let held: EnvMarble | undefined;
  for (const id of st.holding) {
    held = findMarble(env, id);
    if (held) break;
  }
  let hx = st.x;
  let hy = st.y;
  let open = 0;
  if (held) {
    hx = held.x - dx * held.radius * 0.35;
    hy = held.y - dy * held.radius * 0.35;
    open = 0.75 + 0.08 * Math.sin(t * 6);
  } else if (!env.preview) {
    const near = nearestMarble(env, st.x + dx * size * 2, st.y + dy * size * 2, size * 5);
    if (near) {
      const fx = near.x - st.x;
      const fy = near.y - st.y;
      const ahead = fx * dx + fy * dy;
      const side = Math.abs(-fx * dy + fy * dx);
      if (ahead > 0 && side < size * 2.2) open = smooth(1 - ahead / (size * 5)) * 0.9;
    }
  }

  // visible body span: from max(passFrom, head - length) to the head
  let bodyLen = def.length;
  if (st.passFrom) {
    const trav = (st.x - st.passFrom.x) * dx + (st.y - st.passFrom.y) * dy;
    bodyLen = clamp(trav, size * 1.6, def.length);
  }
  const N = Math.max(10, Math.min(46, Math.round(bodyLen / 0.28)));
  const pts: TPoint[] = [];
  const A = 0.25;
  const k = (Math.PI * 2) / Math.max(2.2, def.length * 0.4);
  const wCycle = t * 6.2;
  for (let i = 0; i <= N; i++) {
    const u = i / N;
    const s = u * bodyLen;
    const env0 = smooth(s / (size * 2.5)) * (0.55 + 0.45 * Math.sin(Math.PI * Math.min(1, u * 0.9 + 0.1))) * (1 - 0.3 * u * u);
    // travelling toward the tail: phase advances with s while time pushes it along
    const lat = Math.sin(k * s - wCycle) * A * env0 * 1.0;
    const px = hx - dx * s + nx * lat;
    const py = hy - dy * s + ny * lat;
    // body width: neck → thick mid → thin tail
    const tw = u < 0.08 ? lerp(0.78, 0.95, u / 0.08) : 0.95 - 0.95 * smooth((u - 0.55) / 0.45) * 0.92;
    pts.push({ x: px, y: py, w: Math.max(0.05, 2 * size * tw * 0.8) });
  }

  ctx.save();
  ctx.globalAlpha *= clamp(st.visible, 0, 1);
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  const widths = pts.map((p) => p.w);
  // body
  taperOutline(ctx, pts, widths);
  ctx.fillStyle = SN.body;
  ctx.fill();
  ctx.save();
  ctx.clip();
  // belly stripe along one edge + diamonds
  ctx.strokeStyle = alpha(SN.belly, 0.55);
  ctx.lineWidth = size * 0.55;
  ctx.beginPath();
  for (let i = 0; i <= N; i++) {
    const p = pts[i];
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(N, i + 1)];
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    const ox = p.x + (-ty / l) * p.w * 0.38;
    const oy = p.y + (tx / l) * p.w * 0.38;
    if (i === 0) ctx.moveTo(ox, oy);
    else ctx.lineTo(ox, oy);
  }
  ctx.stroke();
  ctx.fillStyle = SN.dark;
  const spacing = Math.max(0.5, size * 1.5);
  for (let d = size * 2.2; d < bodyLen - size * 0.6; d += spacing) {
    const f = (d / bodyLen) * N;
    const i0 = Math.min(N - 1, Math.floor(f));
    const fr = f - i0;
    const p = { x: lerp(pts[i0].x, pts[i0 + 1].x, fr), y: lerp(pts[i0].y, pts[i0 + 1].y, fr), w: lerp(pts[i0].w, pts[i0 + 1].w, fr) };
    const tx = pts[i0 + 1].x - pts[i0].x;
    const ty = pts[i0 + 1].y - pts[i0].y;
    const th = Math.atan2(ty, tx);
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(th);
    const rw = p.w * 0.42;
    ctx.beginPath();
    ctx.moveTo(spacing * 0.42, 0);
    ctx.lineTo(0, -rw);
    ctx.lineTo(-spacing * 0.42, 0);
    ctx.lineTo(0, rw * 0.7);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
  taperOutline(ctx, pts, widths);
  ctx.strokeStyle = SN.edge;
  ctx.lineWidth = 0.08;
  ctx.stroke();
  // gloss along the back
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = size * 0.22;
  ctx.beginPath();
  for (let i = 1; i < N - 2; i++) {
    const p = pts[i];
    const a = pts[i - 1];
    const b = pts[i + 1];
    const tx = b.x - a.x;
    const ty = b.y - a.y;
    const l = Math.hypot(tx, ty) || 1;
    const ox = p.x + (ty / l) * p.w * 0.25;
    const oy = p.y - (tx / l) * p.w * 0.25;
    if (i === 1) ctx.moveTo(ox, oy);
    else ctx.lineTo(ox, oy);
  }
  ctx.stroke();

  // ---- head
  const hs = size * 1.3;
  ctx.save();
  ctx.translate(hx, hy);
  ctx.rotate(ang);
  ctx.scale(1, dx < 0 ? -1 : 1);
  const flicker = Math.pow(Math.max(0, Math.sin(t * 4.2)), 5);
  const tongueLen = (open > 0.3 ? 0 : 0.5 + flicker * 1.5) * hs;
  // tongue
  if (tongueLen > 0.05 * hs) {
    const tx0 = hs * 1.35;
    ctx.strokeStyle = SN.tongue;
    ctx.lineWidth = 0.07;
    ctx.beginPath();
    ctx.moveTo(tx0, 0);
    const wob = Math.sin(t * 40) * 0.05 * hs;
    ctx.lineTo(tx0 + tongueLen, wob);
    ctx.moveTo(tx0 + tongueLen, wob);
    ctx.lineTo(tx0 + tongueLen + hs * 0.4, wob - hs * 0.28);
    ctx.moveTo(tx0 + tongueLen, wob);
    ctx.lineTo(tx0 + tongueLen + hs * 0.4, wob + hs * 0.28);
    ctx.stroke();
  }
  const jawA = open * 0.6;
  // lower jaw
  ctx.save();
  ctx.translate(-hs * 0.25, 0);
  ctx.rotate(jawA);
  ctx.fillStyle = SN.belly;
  ctx.strokeStyle = SN.edge;
  ctx.lineWidth = 0.07;
  ctx.beginPath();
  ctx.ellipse(hs * 0.9, hs * 0.28, hs * 1.05, hs * 0.4, 0, 0, TAU);
  ctx.fill();
  ctx.stroke();
  ctx.restore();
  // gape
  if (open > 0.05) {
    ctx.fillStyle = '#3d0a16';
    ctx.beginPath();
    ctx.moveTo(-hs * 0.25, 0);
    ctx.lineTo(hs * 1.7, -hs * 0.05);
    ctx.lineTo(hs * 1.7 * Math.cos(jawA * 0.9) - hs * 0.25, hs * 1.7 * Math.sin(jawA) * 0.9);
    ctx.closePath();
    ctx.fill();
  }
  if (held && env.redraw) {
    ctx.restore();
    env.redraw(held);
    ctx.save();
    ctx.translate(hx, hy);
    ctx.rotate(ang);
    ctx.scale(1, dx < 0 ? -1 : 1);
  }
  // upper head
  const hg = ctx.createLinearGradient(0, -hs, 0, hs);
  hg.addColorStop(0, lighten(SN.body, 0.1));
  hg.addColorStop(1, SN.body);
  ctx.fillStyle = hg;
  ctx.strokeStyle = SN.edge;
  ctx.lineWidth = 0.08;
  ctx.beginPath();
  ctx.moveTo(-hs * 0.9, -hs * 0.62);
  ctx.quadraticCurveTo(hs * 0.7, -hs * 0.95, hs * 1.5, -hs * 0.18);
  ctx.quadraticCurveTo(hs * 1.62, 0, hs * 1.5, hs * 0.1);
  ctx.lineTo(-hs * 0.25, hs * 0.04);
  ctx.lineTo(-hs * 0.9, hs * 0.5);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  // fangs when open
  if (open > 0.3) {
    ctx.fillStyle = '#ffffff';
    for (const fx of [1.05, 1.3]) {
      ctx.beginPath();
      ctx.moveTo(hs * fx - 0.06, hs * 0.04);
      ctx.lineTo(hs * fx, hs * 0.04 + hs * 0.3);
      ctx.lineTo(hs * fx + 0.06, hs * 0.04);
      ctx.fill();
    }
  }
  // nostril + eyes
  ctx.fillStyle = SN.edge;
  circle(ctx, hs * 1.35, -hs * 0.2, hs * 0.05);
  ctx.fill();
  {
    const ex = hs * 0.55;
    const ey = -hs * 0.36;
    ctx.fillStyle = '#ffe680';
    ctx.strokeStyle = SN.edge;
    ctx.lineWidth = 0.05;
    circle(ctx, ex, ey, hs * 0.3);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#10200a';
    ctx.beginPath();
    ctx.ellipse(ex + hs * 0.04, ey, hs * 0.07, hs * 0.22, 0, 0, TAU);
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    circle(ctx, ex - hs * 0.06, ey - hs * 0.1, hs * 0.05);
    ctx.fill();
  }
  ctx.restore();
  ctx.restore();
}

/** Re-exported for tests. */
export const _internals = { hash01, ik, smooth, restState, mixCol: mix, darkenCol: darken };
