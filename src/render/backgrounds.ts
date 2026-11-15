/**
 * Procedural scenic backgrounds (purely visual; never touches the simulation).
 *
 * Every scene is a vertical sky/water gradient plus several PARALLAX layers. A layer is one
 * seamless tile painted once into an offscreen canvas (cached per kind + layer + DPR bucket) and
 * repeated in both axes with `drawImage`. Scenery inside a tile is placed from a seeded hash of
 * (kind, layer) — never `Math.random` — and every object is drawn "wrapped" so it can cross the
 * tile border without a seam. A few cheap animated bits (twinkle, bubbles, embers, drifting
 * clouds, swaying plants, shooting stars) are drawn on top each frame unless the user prefers
 * reduced motion.
 */
import type { BackgroundKind } from '../core/config';
import { alpha, mix } from './color';

export type SceneKind = Exclude<BackgroundKind, 'auto'>;

export interface ScenePalette {
  /** Flat colour behind everything (fallback / minimap-like tone). */
  background: string;
  /** Solid wall fill, outline and soft shadow used instead of `map.theme` in this scene. */
  wall: string;
  wallEdge: string;
  wallShadow: string;
  accent: string;
}

export const SCENE_PALETTES: Record<SceneKind, ScenePalette> = {
  sea: { background: '#06223f', wall: '#d6ecf7', wallEdge: '#06182e', wallShadow: 'rgba(1,8,22,0.55)', accent: '#6fd3ff' },
  space: { background: '#070816', wall: '#dde2f4', wallEdge: '#0b0d24', wallShadow: 'rgba(0,0,10,0.6)', accent: '#9ab4ff' },
  clouds: { background: '#8fbfe3', wall: '#2c3850', wallEdge: '#f2f8ff', wallShadow: 'rgba(20,40,70,0.28)', accent: '#2f6fb0' },
  dinosaurs: { background: '#5a2a58', wall: '#f3e0c6', wallEdge: '#2a0f2c', wallShadow: 'rgba(25,5,25,0.55)', accent: '#ffb35a' },
  castle: { background: '#0d1230', wall: '#d2d8ea', wallEdge: '#080b1f', wallShadow: 'rgba(0,0,12,0.6)', accent: '#ffd27a' },
};

export function scenePalette(kind: BackgroundKind): ScenePalette | null {
  return kind === 'auto' ? null : (SCENE_PALETTES[kind] ?? null);
}

/* ------------------------------------------------------------------ utils */

type Ctx = CanvasRenderingContext2D;

function hash32(...v: number[]): number {
  let h = 2166136261 >>> 0;
  for (const n of v) {
    h ^= n | 0;
    h = Math.imul(h, 16777619) >>> 0;
    h ^= h >>> 13;
    h = Math.imul(h, 0x5bd1e995) >>> 0;
  }
  return (h ^ (h >>> 15)) >>> 0;
}

function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TAU = Math.PI * 2;
const mod = (a: number, n: number): number => ((a % n) + n) % n;

interface Anim {
  x: number;
  y: number;
  r: number;
  ph: number;
  sp: number;
  kind: 'twinkle' | 'bubble' | 'ember';
  color: string;
}

interface PaintCtx {
  g: Ctx;
  T: number;
  R: () => number;
  /** Run `fn` once per wrapped copy of an object centred at (cx,cy) with half-extent `ext`. */
  rep: (cx: number, cy: number, ext: number, fn: () => void) => void;
  anim: Anim[];
}

interface Layer {
  id: string;
  /** Parallax factor (fraction of camera motion). */
  par: number;
  /** Tile edge in CSS px. */
  tile: number;
  alpha?: number;
  /** Ambient horizontal drift, CSS px per second. */
  drift?: number;
  /** Horizontal shear amplitude for swaying plants (rooted at the tile bottom). */
  sway?: number;
  /** Paint nothing (animation-only layer). */
  empty?: boolean;
  paint: (p: PaintCtx) => void;
}

interface Scene {
  /** Gradient stops top -> bottom. */
  sky: [number, string][];
  vignette: string;
  layers: Layer[];
  /** Extra per-frame screen-space decoration (sun, moon, rays, shooting star). */
  before?: (c: Ctx, W: number, H: number, dpr: number, t: number, moving: boolean) => void;
  after?: (c: Ctx, W: number, H: number, dpr: number, t: number, moving: boolean) => void;
}

/* ------------------------------------------------------------ shape kit */

/** Periodic ridge function over [0,T): integer cycle counts keep it seamless. */
function ridgeFn(R: () => number, T: number, base: number, amp: number, cycles: number[]): (x: number) => number {
  const comps = cycles.map((k, i) => ({ k, ph: R() * TAU, a: amp / (1 + i * 0.9) }));
  return (x) => {
    let y = base;
    for (const c of comps) y += Math.sin((x / T) * TAU * c.k + c.ph) * c.a;
    return y;
  };
}

/** Fill the area under a ridge, fading to transparent over `band` px so rows tile cleanly. */
function ground(g: Ctx, T: number, f: (x: number) => number, color: string, band: number, topA = 1): void {
  const y0 = f(0);
  const grad = g.createLinearGradient(0, y0 - 6, 0, y0 + band);
  grad.addColorStop(0, alpha(color, topA));
  grad.addColorStop(0.55, alpha(color, topA * 0.85));
  grad.addColorStop(1, alpha(color, 0));
  g.fillStyle = grad;
  g.beginPath();
  g.moveTo(0, f(0));
  for (let x = 6; x <= T; x += 6) g.lineTo(x, f(x));
  g.lineTo(T, f(T) + band);
  g.lineTo(0, f(0) + band);
  g.closePath();
  g.fill();
}

function ellipse(g: Ctx, x: number, y: number, rx: number, ry: number, rot = 0): void {
  g.beginPath();
  g.ellipse(x, y, Math.max(0.01, rx), Math.max(0.01, ry), rot, 0, TAU);
  g.fill();
}

function line(g: Ctx, x0: number, y0: number, x1: number, y1: number, w: number): void {
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(x0, y0);
  g.lineTo(x1, y1);
  g.stroke();
}

function curve(g: Ctx, x0: number, y0: number, cx: number, cy: number, x1: number, y1: number, w: number): void {
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(x0, y0);
  g.quadraticCurveTo(cx, cy, x1, y1);
  g.stroke();
}

function cloud(g: Ctx, x: number, y: number, w: number, h: number, R: () => number, col: string, shade: string): void {
  const n = 5 + Math.floor(R() * 3);
  const parts: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const u = i / (n - 1);
    const bump = Math.sin(u * Math.PI);
    parts.push([x + (u - 0.5) * w, y - bump * h * (0.25 + R() * 0.3), h * (0.28 + bump * 0.35 + R() * 0.1)]);
  }
  g.fillStyle = shade;
  for (const [px, py, pr] of parts) {
    g.beginPath();
    g.arc(px, py + h * 0.12, pr, 0, TAU);
    g.fill();
  }
  g.fillStyle = col;
  for (const [px, py, pr] of parts) {
    g.beginPath();
    g.arc(px, py, pr, 0, TAU);
    g.fill();
  }
  g.beginPath();
  g.roundRect(x - w * 0.52, y - h * 0.1, w * 1.04, h * 0.38, h * 0.19);
  g.fill();
}

function star(p: PaintCtx, x: number, y: number, r: number, col: string, glint: boolean, twinkle: boolean): void {
  const { g } = p;
  p.rep(x, y, r * 4, () => {
    g.fillStyle = col;
    g.beginPath();
    g.arc(x, y, r, 0, TAU);
    g.fill();
    if (glint) {
      g.strokeStyle = col;
      g.lineCap = 'round';
      g.globalAlpha = 0.55;
      line(g, x - r * 3.2, y, x + r * 3.2, y, Math.max(0.5, r * 0.45));
      line(g, x, y - r * 3.2, x, y + r * 3.2, Math.max(0.5, r * 0.45));
      g.globalAlpha = 1;
    }
  });
  if (twinkle) p.anim.push({ x, y, r: r * 1.3, ph: p.R() * TAU, sp: 1.2 + p.R() * 2.2, kind: 'twinkle', color: col });
}

/* ------------------------------------------------------------ creatures */

function fish(g: Ctx, x: number, y: number, s: number, dir: number): void {
  g.save();
  g.translate(x, y);
  g.scale(dir * s, s);
  ellipse(g, 0, 0, 12, 5);
  g.beginPath();
  g.moveTo(-9, 0);
  g.lineTo(-18, -6);
  g.lineTo(-18, 6);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(-2, -4);
  g.lineTo(3, -9);
  g.lineTo(5, -3);
  g.closePath();
  g.fill();
  g.restore();
}

function whale(g: Ctx, x: number, y: number, s: number, dir: number): void {
  g.save();
  g.translate(x, y);
  g.scale(dir * s, s);
  g.beginPath();
  g.moveTo(90, 4);
  g.bezierCurveTo(80, -34, 20, -42, -30, -22);
  g.bezierCurveTo(-60, -12, -80, -22, -108, -52);
  g.bezierCurveTo(-104, -28, -100, -14, -96, -6);
  g.bezierCurveTo(-100, 4, -108, 14, -118, 30);
  g.bezierCurveTo(-90, 20, -72, 12, -52, 12);
  g.bezierCurveTo(-10, 30, 50, 34, 82, 18);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(10, 14);
  g.quadraticCurveTo(24, 38, 46, 46);
  g.quadraticCurveTo(38, 28, 34, 16);
  g.fill();
  g.restore();
}

function coralBranch(g: Ctx, R: () => number, x: number, y: number, ang: number, len: number, w: number, depth: number): void {
  const x1 = x + Math.cos(ang) * len;
  const y1 = y + Math.sin(ang) * len;
  line(g, x, y, x1, y1, w);
  if (depth <= 0) return;
  const n = 2 + (R() < 0.35 ? 1 : 0);
  for (let i = 0; i < n; i++) {
    const a = ang + (i - (n - 1) / 2) * (0.55 + R() * 0.3);
    coralBranch(g, R, x1, y1, a, len * (0.68 + R() * 0.1), w * 0.72, depth - 1);
  }
}

function seaweed(g: Ctx, R: () => number, x: number, y: number, h: number, w: number): void {
  const ph = R() * TAU;
  const segs = 7;
  g.lineWidth = w;
  g.beginPath();
  g.moveTo(x, y);
  for (let i = 1; i <= segs; i++) {
    const u = i / segs;
    g.lineTo(x + Math.sin(u * 5 + ph) * h * 0.09 * u, y - u * h);
  }
  g.stroke();
}

function sauropod(g: Ctx, x: number, y: number, u: number, dir: number): void {
  g.save();
  g.translate(x, y);
  g.scale(dir * u, u);
  g.lineCap = 'round';
  ellipse(g, 0, -3.4, 3.2, 1.8);
  for (const lx of [-2.1, -1.0, 1.1, 2.2]) line(g, lx, -2.6, lx, -0.2, 0.95);
  curve(g, 2.4, -4.2, 4.6, -5.2, 4.8, -9.6, 1.0);
  ellipse(g, 5.25, -9.9, 0.85, 0.5, -0.2);
  curve(g, -2.8, -3.8, -5.4, -3.4, -8.2, -0.8, 1.05);
  g.restore();
}

function trex(g: Ctx, x: number, y: number, u: number, dir: number): void {
  g.save();
  g.translate(x, y);
  g.scale(dir * u, u);
  g.lineCap = 'round';
  ellipse(g, 0, -4.1, 2.7, 1.55, -0.38);
  ellipse(g, 2.9, -6.3, 1.7, 0.85, 0.12);
  ellipse(g, 2.7, -5.55, 1.2, 0.35, 0.18);
  curve(g, -2.2, -4.2, -5.2, -3.9, -7.4, -2.2, 1.2);
  ellipse(g, -0.2, -2.7, 1.1, 1.5, 0.2);
  line(g, -0.1, -2.0, -0.5, -0.2, 0.9);
  line(g, 0.9, -2.2, 1.4, -0.2, 0.9);
  line(g, -0.9, -0.15, 0.2, -0.15, 0.6);
  line(g, 1.2, -0.15, 2.3, -0.15, 0.6);
  line(g, 1.6, -3.6, 2.3, -2.8, 0.45);
  g.restore();
}

function trike(g: Ctx, x: number, y: number, u: number, dir: number): void {
  g.save();
  g.translate(x, y);
  g.scale(dir * u, u);
  g.lineCap = 'round';
  ellipse(g, 0, -2.4, 3.2, 1.6);
  for (const lx of [-2.0, -0.9, 1.2, 2.3]) line(g, lx, -1.8, lx, -0.1, 0.95);
  ellipse(g, 3.6, -2.2, 1.35, 1.0, 0.15);
  ellipse(g, 2.7, -3.4, 0.95, 1.9, 0.5);
  line(g, 3.4, -3.0, 5.6, -4.1, 0.45);
  line(g, 3.7, -2.9, 5.9, -2.4, 0.45);
  g.beginPath();
  g.moveTo(4.6, -2.5);
  g.lineTo(5.6, -2.0);
  g.lineTo(4.4, -1.8);
  g.fill();
  curve(g, -3.0, -2.6, -4.6, -2.4, -5.8, -0.9, 0.8);
  g.restore();
}

function ptero(g: Ctx, x: number, y: number, s: number, dir: number): void {
  g.save();
  g.translate(x, y);
  g.scale(dir * s, s);
  g.beginPath();
  g.moveTo(2, 0);
  g.lineTo(-6, -9);
  g.lineTo(-14, -12);
  g.lineTo(-10, -3);
  g.lineTo(-14, 6);
  g.lineTo(-6, 3);
  g.closePath();
  g.fill();
  g.beginPath();
  g.moveTo(2, 0);
  g.lineTo(-2, 7);
  g.lineTo(-9, 12);
  g.lineTo(-7, 3);
  g.closePath();
  g.fill();
  ellipse(g, 3, -0.4, 4, 1.8);
  g.beginPath();
  g.moveTo(5, -1);
  g.lineTo(12, 0);
  g.lineTo(5, 1);
  g.fill();
  g.beginPath();
  g.moveTo(2, -1);
  g.lineTo(-3, -4);
  g.lineTo(1, 0);
  g.fill();
  g.restore();
}

function bat(g: Ctx, x: number, y: number, s: number): void {
  g.save();
  g.translate(x, y);
  g.scale(s, s);
  ellipse(g, 0, 0, 2.2, 3.2);
  ellipse(g, 0, -3.4, 1.8, 1.6);
  g.beginPath();
  g.moveTo(-1.4, -4.2);
  g.lineTo(-2.2, -6.6);
  g.lineTo(-0.4, -4.8);
  g.moveTo(1.4, -4.2);
  g.lineTo(2.2, -6.6);
  g.lineTo(0.4, -4.8);
  g.fill();
  for (const d of [-1, 1]) {
    g.beginPath();
    g.moveTo(d * 1.5, -1.8);
    g.quadraticCurveTo(d * 8, -9, d * 15, -5);
    g.quadraticCurveTo(d * 12.5, -3.4, d * 11.5, -1);
    g.quadraticCurveTo(d * 9.5, -2.4, d * 8, 0.8);
    g.quadraticCurveTo(d * 5.5, -1.4, d * 3.5, 2);
    g.closePath();
    g.fill();
  }
  g.restore();
}

function birdV(g: Ctx, x: number, y: number, s: number): void {
  g.lineWidth = Math.max(1.1, s * 0.22);
  g.beginPath();
  g.moveTo(x - s, y - s * 0.35);
  g.quadraticCurveTo(x - s * 0.45, y - s * 0.6, x, y);
  g.quadraticCurveTo(x + s * 0.45, y - s * 0.6, x + s, y - s * 0.35);
  g.stroke();
}

function palm(g: Ctx, R: () => number, x: number, y: number, h: number, col: string): void {
  g.strokeStyle = col;
  g.fillStyle = col;
  g.lineCap = 'round';
  const lean = (R() - 0.5) * h * 0.35;
  curve(g, x, y, x + lean * 0.2, y - h * 0.55, x + lean, y - h, Math.max(3, h * 0.045));
  const tx = x + lean;
  const ty = y - h;
  const fronds = 7;
  for (let i = 0; i < fronds; i++) {
    const a = -Math.PI + (i / (fronds - 1)) * Math.PI;
    const l = h * (0.34 + R() * 0.1);
    const ex = tx + Math.cos(a) * l;
    const ey = ty + Math.sin(a) * l * 0.55 + l * 0.38;
    curve(g, tx, ty, tx + Math.cos(a) * l * 0.55, ty + Math.sin(a) * l * 0.75 - l * 0.12, ex, ey, Math.max(2.5, h * 0.03));
  }
}

function fern(g: Ctx, R: () => number, x: number, y: number, h: number): void {
  g.lineCap = 'round';
  const blades = 6 + Math.floor(R() * 3);
  for (let i = 0; i < blades; i++) {
    const a = -Math.PI / 2 + (i / (blades - 1) - 0.5) * 2.2;
    const l = h * (0.7 + R() * 0.35);
    const ex = x + Math.cos(a) * l;
    const ey = y + Math.sin(a) * l;
    curve(g, x, y, x + Math.cos(a) * l * 0.4, y + Math.sin(a) * l * 0.9, ex, ey + l * 0.12, Math.max(1.8, h * 0.05));
  }
}

function castle(p: PaintCtx, cx: number, base: number, s: number, col: string, win: string): void {
  const { g } = p;
  const ext = 140 * s;
  p.rep(cx, base - 100 * s, ext + 40 * s, () => {
    g.fillStyle = col;
    const crenels = (x0: number, y0: number, w: number, c: number) => {
      const cw = w / (c * 2 - 1);
      for (let i = 0; i < c; i++) g.fillRect(x0 + i * cw * 2, y0 - 8 * s, cw, 8.5 * s);
    };
    // curtain wall + keep
    g.fillRect(cx - 130 * s, base - 62 * s, 260 * s, 62 * s);
    crenels(cx - 130 * s, base - 62 * s, 260 * s, 14);
    g.fillRect(cx - 52 * s, base - 120 * s, 104 * s, 122 * s);
    crenels(cx - 52 * s, base - 120 * s, 104 * s, 7);
    // towers
    const tower = (tx: number, w: number, h: number, roof: boolean, flag: boolean) => {
      g.fillRect(tx - w / 2, base - h, w, h + 2 * s);
      if (roof) {
        g.beginPath();
        g.moveTo(tx - w * 0.64, base - h);
        g.lineTo(tx, base - h - w * 1.15);
        g.lineTo(tx + w * 0.64, base - h);
        g.closePath();
        g.fill();
      } else {
        g.fillRect(tx - w * 0.62, base - h - 5 * s, w * 1.24, 7 * s);
        crenels(tx - w * 0.62, base - h - 5 * s, w * 1.24, 4);
      }
      if (flag) {
        const top = base - h - (roof ? w * 1.15 : 8 * s);
        g.strokeStyle = col;
        line(g, tx, top, tx, top - 26 * s, Math.max(1, 1.6 * s));
        g.beginPath();
        g.moveTo(tx, top - 26 * s);
        g.lineTo(tx + 17 * s, top - 21 * s);
        g.lineTo(tx, top - 15 * s);
        g.closePath();
        g.fill();
      }
    };
    tower(cx - 128 * s, 38 * s, 118 * s, true, false);
    tower(cx + 128 * s, 38 * s, 118 * s, true, false);
    tower(cx - 50 * s, 34 * s, 172 * s, true, true);
    tower(cx + 50 * s, 34 * s, 150 * s, false, false);
    tower(cx, 40 * s, 200 * s, true, true);
    // lit windows
    const wins: [number, number][] = [
      [-128, 84], [-128, 62], [128, 84], [-50, 120], [-50, 96], [50, 100], [0, 150], [0, 120], [0, 92], [-20, 52], [24, 40], [-84, 34], [84, 34], [-100, 30],
    ];
    for (const [wx, wy] of wins) {
      const x = cx + wx * s;
      const y = base - wy * s;
      g.fillStyle = alpha(win, 0.8);
      g.beginPath();
      g.roundRect(x - 2.4 * s, y - 5 * s, 4.8 * s, 9 * s, 2.4 * s);
      g.fill();
      if (p.R() < 0.7) p.anim.push({ x, y, r: 3.2 * s + 1, ph: p.R() * TAU, sp: 0.8 + p.R() * 2.5, kind: 'twinkle', color: win });
    }
  });
}

/* ---------------------------------------------------------------- scenes */

const rain = (R: () => number, a: number, b: number): number => a + R() * (b - a);

function seaScene(): Scene {
  return {
    sky: [[0, '#0e4a78'], [0.45, '#0a2f58'], [1, '#04132b']],
    vignette: 'rgba(0,6,20,0.5)',
    before(c, W, H, dpr, t, moving) {
      c.save();
      for (let i = 0; i < 6; i++) {
        const sway = moving ? Math.sin(t * 0.18 + i * 1.7) * W * 0.03 : 0;
        const x0 = W * (0.04 + i * 0.18) + sway;
        const w = W * (0.05 + (i % 3) * 0.025);
        const grad = c.createLinearGradient(x0, 0, x0 + W * 0.1, H * 0.85);
        grad.addColorStop(0, 'rgba(150,215,255,0.16)');
        grad.addColorStop(1, 'rgba(150,215,255,0)');
        c.fillStyle = grad;
        c.beginPath();
        c.moveTo(x0, 0);
        c.lineTo(x0 + w, 0);
        c.lineTo(x0 + w + W * 0.22, H * 0.85);
        c.lineTo(x0 - W * 0.04, H * 0.85);
        c.closePath();
        c.fill();
      }
      c.restore();
      void dpr;
    },
    layers: [
      {
        id: 'whale', par: 0.05, tile: 1024, alpha: 0.5, drift: 2,
        paint({ g, T, R, rep }) {
          g.fillStyle = '#1b5f93';
          rep(T * 0.3, T * 0.35, 150, () => whale(g, T * 0.3, T * 0.35, 1.1, 1));
          rep(T * 0.78, T * 0.8, 110, () => whale(g, T * 0.78, T * 0.8, 0.55, -1));
          for (let i = 0; i < 14; i++) {
            const x = rain(R, 0, T);
            const y = rain(R, 0, T);
            rep(x, y, 20, () => fish(g, x, y, 0.5, i % 2 ? 1 : -1));
          }
        },
      },
      {
        id: 'ridge-far', par: 0.1, tile: 768, alpha: 0.7,
        paint({ g, T, R }) {
          const f = ridgeFn(R, T, T * 0.7, T * 0.06, [2, 3, 5]);
          ground(g, T, f, '#1f6a8f', T * 0.28, 0.55);
        },
      },
      {
        id: 'coral', par: 0.2, tile: 640, alpha: 0.7,
        paint({ g, T, R, rep }) {
          const f = ridgeFn(R, T, T * 0.82, T * 0.025, [2, 4]);
          ground(g, T, f, '#2c7c8c', T * 0.18, 0.9);
          const cols = ['#1f8a8a', '#c0577a', '#d98a5a', '#4aa58c'];
          for (let i = 0; i < 6; i++) {
            const x = (i + 0.3 + R() * 0.4) * (T / 6);
            const y = f(x) + 4;
            const col = cols[Math.floor(R() * cols.length)];
            g.strokeStyle = col;
            g.fillStyle = col;
            g.lineCap = 'round';
            rep(x, y - 50, 80, () => {
              if (R() < 0.65) coralBranch(g, R, x, y, -Math.PI / 2 + (R() - 0.5) * 0.4, 30 + R() * 14, 8, 3);
              else {
                g.beginPath();
                g.arc(x, y, 26 + R() * 14, Math.PI, 0);
                g.fill();
              }
            });
          }
        },
      },
      {
        id: 'fish', par: 0.3, tile: 768, alpha: 0.6, drift: 8,
        paint({ g, T, R, rep }) {
          g.fillStyle = '#3a8fb5';
          for (let s = 0; s < 3; s++) {
            const cx = rain(R, 0, T);
            const cy = rain(R, 0, T);
            const dir = R() < 0.5 ? 1 : -1;
            const n = 5 + Math.floor(R() * 5);
            for (let i = 0; i < n; i++) {
              const x = cx + (R() - 0.5) * 120;
              const y = cy + (R() - 0.5) * 60;
              rep(x, y, 24, () => fish(g, x, y, 0.7 + R() * 0.4, dir));
            }
          }
        },
      },
      {
        id: 'weed', par: 0.45, tile: 512, alpha: 0.75, sway: 0.07,
        paint({ g, T, R, rep }) {
          const f = ridgeFn(R, T, T * 0.88, T * 0.02, [2, 3]);
          ground(g, T, f, '#1c6f6a', T * 0.12, 0.9);
          g.lineCap = 'round';
          for (let i = 0; i < 9; i++) {
            const x = rain(R, 0, T);
            const y = f(x) + 3;
            g.strokeStyle = i % 3 === 0 ? '#2a8f6a' : '#1f7a5e';
            rep(x, y - 70, 90, () => seaweed(g, R, x, y, 70 + R() * 70, 5 + R() * 3));
          }
        },
      },
      {
        id: 'bubbles', par: 0.35, tile: 640, empty: true,
        paint({ T, R, anim }) {
          for (let i = 0; i < 16; i++) {
            anim.push({ x: rain(R, 0, T), y: rain(R, 0, T), r: 1.5 + R() * 3.5, ph: R() * TAU, sp: 14 + R() * 26, kind: 'bubble', color: '#bfe6ff' });
          }
        },
      },
    ],
  };
}

function spaceScene(): Scene {
  const stars = (id: string, par: number, tile: number, n: number, rMin: number, rMax: number, glintP: number, alphaV: number): Layer => ({
    id, par, tile, alpha: alphaV,
    paint(p) {
      const cols = ['#ffffff', '#cfe0ff', '#ffe9c4', '#ffd0d8'];
      for (let i = 0; i < n; i++) {
        star(p, rain(p.R, 0, p.T), rain(p.R, 0, p.T), rain(p.R, rMin, rMax), cols[Math.floor(p.R() * cols.length)], p.R() < glintP, p.R() < 0.4);
      }
    },
  });
  return {
    sky: [[0, '#04050c'], [0.5, '#090a1c'], [1, '#150a24']],
    vignette: 'rgba(0,0,0,0.5)',
    layers: [
      {
        id: 'nebula', par: 0.04, tile: 1024, alpha: 0.55,
        paint({ g, T, R, rep }) {
          const cols = ['#5b2a8c', '#1f5f8f', '#8c2a6a', '#2a7a7a'];
          for (let i = 0; i < 8; i++) {
            const x = rain(R, 0, T);
            const y = rain(R, 0, T);
            const r = rain(R, 160, 300);
            const col = cols[i % cols.length];
            rep(x, y, r, () => {
              const grad = g.createRadialGradient(x, y, 0, x, y, r);
              grad.addColorStop(0, alpha(col, 0.5));
              grad.addColorStop(0.55, alpha(col, 0.18));
              grad.addColorStop(1, alpha(col, 0));
              g.fillStyle = grad;
              g.fillRect(x - r, y - r, r * 2, r * 2);
            });
          }
        },
      },
      stars('stars-far', 0.06, 512, 55, 0.5, 0.9, 0, 0.7),
      {
        id: 'planets', par: 0.12, tile: 1024, alpha: 0.75,
        paint({ g, T, rep }) {
          const planet = (x: number, y: number, r: number, c0: string, c1: string, ring: boolean) => {
            rep(x, y, r * 2, () => {
              if (ring) {
                g.save();
                g.translate(x, y);
                g.rotate(-0.35);
                g.strokeStyle = alpha('#d8c8a0', 0.5);
                g.lineWidth = r * 0.22;
                g.beginPath();
                g.ellipse(0, 0, r * 1.9, r * 0.5, 0, Math.PI, TAU);
                g.stroke();
                g.restore();
              }
              const grad = g.createRadialGradient(x - r * 0.4, y - r * 0.4, r * 0.1, x, y, r);
              grad.addColorStop(0, c0);
              grad.addColorStop(1, c1);
              g.fillStyle = grad;
              g.beginPath();
              g.arc(x, y, r, 0, TAU);
              g.fill();
              if (ring) {
                g.save();
                g.translate(x, y);
                g.rotate(-0.35);
                g.strokeStyle = alpha('#d8c8a0', 0.5);
                g.lineWidth = r * 0.22;
                g.beginPath();
                g.ellipse(0, 0, r * 1.9, r * 0.5, 0, 0, Math.PI);
                g.stroke();
                g.restore();
              }
            });
          };
          planet(T * 0.24, T * 0.3, 62, '#6aa0c8', '#1c2f55', false);
          planet(T * 0.72, T * 0.72, 46, '#d6a874', '#5a3a2a', true);
          planet(T * 0.52, T * 0.14, 20, '#a8a8c0', '#383850', false);
          planet(T * 0.9, T * 0.4, 14, '#c86a6a', '#4a1f2a', false);
        },
      },
      stars('stars-mid', 0.2, 640, 38, 0.9, 1.5, 0.12, 0.85),
      stars('stars-near', 0.35, 768, 16, 1.4, 2.4, 0.45, 0.95),
    ],
    after(c, W, H, dpr, t, moving) {
      if (!moving) return;
      const period = 7.5;
      const k = Math.floor(t / period);
      const local = (t - k * period) / 0.9;
      if (local < 0 || local > 1 || hash32(k, 7) % 3 === 0) return;
      const r = rng(hash32(k, 11));
      const x0 = W * (0.15 + r() * 0.6);
      const y0 = H * (0.05 + r() * 0.35);
      const len = Math.min(W, H) * 0.3;
      const hx = x0 + local * len * 1.3;
      const hy = y0 + local * len * 0.55;
      const grad = c.createLinearGradient(hx, hy, hx - len * 0.5, hy - len * 0.21);
      const a = Math.sin(local * Math.PI) * 0.8;
      grad.addColorStop(0, `rgba(255,255,255,${a})`);
      grad.addColorStop(1, 'rgba(255,255,255,0)');
      c.strokeStyle = grad;
      c.lineWidth = 2 * dpr;
      c.lineCap = 'round';
      c.beginPath();
      c.moveTo(hx, hy);
      c.lineTo(hx - len * 0.5, hy - len * 0.21);
      c.stroke();
    },
  };
}

function cloudsScene(): Scene {
  const puff = (id: string, par: number, tile: number, n: number, wMin: number, wMax: number, a: number, drift: number, fluffy: boolean): Layer => ({
    id, par, tile, alpha: a, drift,
    paint({ g, T, R, rep }) {
      for (let i = 0; i < n; i++) {
        const x = rain(R, 0, T);
        const y = rain(R, 0, T);
        const w = rain(R, wMin, wMax);
        const h = fluffy ? w * 0.42 : w * 0.16;
        rep(x, y, w * 0.75, () => cloud(g, x, y, w, h, R, '#ffffff', fluffy ? '#bcd3e8' : '#dbe8f4'));
      }
    },
  });
  return {
    sky: [[0, '#5f9bd0'], [0.55, '#94bfe0'], [1, '#c4dcee']],
    vignette: 'rgba(25,55,95,0.28)',
    before(c, W, H, dpr) {
      const x = W * 0.8;
      const y = H * 0.17;
      const r = Math.min(W, H) * 0.075;
      const glow = c.createRadialGradient(x, y, r * 0.3, x, y, r * 6);
      glow.addColorStop(0, 'rgba(255,248,214,0.7)');
      glow.addColorStop(0.25, 'rgba(255,240,190,0.28)');
      glow.addColorStop(1, 'rgba(255,240,190,0)');
      c.fillStyle = glow;
      c.fillRect(x - r * 6, y - r * 6, r * 12, r * 12);
      c.fillStyle = '#fff6cf';
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
      void dpr;
    },
    layers: [
      puff('stratus', 0.05, 1024, 6, 260, 420, 0.5, 3, false),
      {
        id: 'birds', par: 0.1, tile: 1024, alpha: 0.4, drift: 12,
        paint({ g, T, R, rep }) {
          g.strokeStyle = '#3a4a66';
          g.lineCap = 'round';
          for (let f = 0; f < 3; f++) {
            const cx = rain(R, 0, T);
            const cy = rain(R, 0, T);
            const n = 3 + Math.floor(R() * 4);
            for (let i = 0; i < n; i++) {
              const x = cx + i * 22 + (R() - 0.5) * 12;
              const y = cy + Math.abs(i - n / 2) * 8 + (R() - 0.5) * 8;
              rep(x, y, 14, () => birdV(g, x, y, 7 + R() * 4));
            }
          }
        },
      },
      puff('cumulus-mid', 0.2, 768, 5, 150, 250, 0.5, 6, true),
      puff('cumulus-near', 0.4, 640, 4, 200, 320, 0.4, 10, true),
    ],
  };
}

function dinoScene(): Scene {
  const sil = '#2a1230';
  return {
    sky: [[0, '#3f2466'], [0.5, '#9b4670'], [1, '#e9915a']],
    vignette: 'rgba(30,5,30,0.45)',
    before(c, W, H) {
      const x = W * 0.3;
      const y = H * 0.92;
      const r = Math.max(W, H) * 0.5;
      const glow = c.createRadialGradient(x, y, 0, x, y, r);
      glow.addColorStop(0, 'rgba(255,190,110,0.35)');
      glow.addColorStop(1, 'rgba(255,190,110,0)');
      c.fillStyle = glow;
      c.fillRect(0, 0, W, H);
    },
    layers: [
      {
        id: 'ptero-far', par: 0.06, tile: 1024, alpha: 0.5, drift: 14,
        paint({ g, T, R, rep }) {
          g.fillStyle = '#4a2150';
          for (let i = 0; i < 6; i++) {
            const x = rain(R, 0, T);
            const y = rain(R, 0, T);
            rep(x, y, 30, () => ptero(g, x, y, 1.0 + R() * 0.8, R() < 0.5 ? 1 : -1));
          }
        },
      },
      {
        id: 'volcano', par: 0.08, tile: 1024, alpha: 0.85,
        paint({ g, T, R, rep, anim }) {
          const base = T * 0.9;
          const cx = T * 0.5;
          // cone with faded base
          const grad = g.createLinearGradient(0, base - T * 0.42, 0, base + T * 0.1);
          grad.addColorStop(0, '#4a2250');
          grad.addColorStop(0.75, '#3a1a44');
          grad.addColorStop(1, 'rgba(58,26,68,0)');
          g.fillStyle = grad;
          g.beginPath();
          g.moveTo(cx - T * 0.46, base + T * 0.1);
          g.lineTo(cx - T * 0.16, base - T * 0.36);
          g.lineTo(cx - T * 0.06, base - T * 0.42);
          g.lineTo(cx + T * 0.06, base - T * 0.42);
          g.lineTo(cx + T * 0.17, base - T * 0.36);
          g.lineTo(cx + T * 0.46, base + T * 0.1);
          g.closePath();
          g.fill();
          // lava glow + runnels
          const lg = g.createRadialGradient(cx, base - T * 0.42, 0, cx, base - T * 0.42, T * 0.22);
          lg.addColorStop(0, 'rgba(255,170,70,0.75)');
          lg.addColorStop(1, 'rgba(255,120,40,0)');
          g.fillStyle = lg;
          g.fillRect(cx - T * 0.25, base - T * 0.65, T * 0.5, T * 0.45);
          g.strokeStyle = 'rgba(255,140,60,0.7)';
          g.lineCap = 'round';
          curve(g, cx - 8, base - T * 0.42, cx - 24, base - T * 0.3, cx - 40, base - T * 0.2, 4);
          curve(g, cx + 8, base - T * 0.42, cx + 18, base - T * 0.32, cx + 36, base - T * 0.22, 3);
          // smoke plume
          for (let i = 0; i < 9; i++) {
            const u = i / 8;
            const x = cx + Math.sin(u * 3) * 30 + u * 60;
            const y = base - T * 0.45 - u * T * 0.4;
            const r = 22 + u * 38;
            rep(x, y, r, () => {
              g.fillStyle = alpha(mix('#6a3a62', '#8a5a78', u), 0.55 - u * 0.25);
              g.beginPath();
              g.arc(x, y, r, 0, TAU);
              g.fill();
            });
          }
          for (let i = 0; i < 7; i++) {
            anim.push({ x: cx + (R() - 0.5) * 40, y: rain(R, base - T * 0.6, base - T * 0.4), r: 1.6 + R() * 1.4, ph: R() * TAU, sp: 18 + R() * 20, kind: 'ember', color: '#ffb455' });
          }
        },
      },
      {
        id: 'hills-far', par: 0.12, tile: 768, alpha: 0.75,
        paint({ g, T, R }) {
          const f = ridgeFn(R, T, T * 0.7, T * 0.07, [1, 2, 4]);
          ground(g, T, f, '#5a2a5e', T * 0.3, 0.9);
        },
      },
      {
        id: 'dinos', par: 0.22, tile: 1024, alpha: 0.82,
        paint({ g, T, R, rep }) {
          const f = ridgeFn(R, T, T * 0.8, T * 0.02, [2, 3]);
          ground(g, T, f, '#3a1a40', T * 0.18, 0.95);
          g.fillStyle = sil;
          g.strokeStyle = sil;
          const list: [typeof sauropod, number, number, number][] = [
            [sauropod, T * 0.18, 12, 1],
            [trex, T * 0.52, 13, -1],
            [trike, T * 0.8, 11, 1],
          ];
          for (const [fn, x, u, dir] of list) {
            const y = f(x) + 2;
            rep(x, y - u * 5, u * 10, () => fn(g, x, y, u, dir));
          }
          for (let i = 0; i < 4; i++) {
            const x = rain(R, 0, T);
            const y = f(x) + 2;
            rep(x, y - 30, 50, () => palm(g, R, x, y, 70 + R() * 40, sil));
          }
        },
      },
      {
        id: 'jungle', par: 0.4, tile: 640, alpha: 0.9, sway: 0.05,
        paint({ g, T, R, rep }) {
          const f = ridgeFn(R, T, T * 0.88, T * 0.02, [2, 3]);
          ground(g, T, f, '#1f2a3a', T * 0.12, 1);
          g.strokeStyle = '#1b3a3a';
          g.fillStyle = '#1b3a3a';
          for (let i = 0; i < 6; i++) {
            const x = rain(R, 0, T);
            const y = f(x) + 3;
            rep(x, y - 60, 100, () => (R() < 0.5 ? fern(g, R, x, y, 55 + R() * 40) : palm(g, R, x, y, 110 + R() * 70, '#1b3a3a')));
          }
        },
      },
    ],
  };
}

function castleScene(): Scene {
  return {
    sky: [[0, '#060a1e'], [0.55, '#131a3d'], [1, '#2b2753']],
    vignette: 'rgba(0,0,10,0.5)',
    before(c, W, H) {
      const x = W * 0.2;
      const y = H * 0.2;
      const r = Math.min(W, H) * 0.11;
      const glow = c.createRadialGradient(x, y, r * 0.5, x, y, r * 5);
      glow.addColorStop(0, 'rgba(210,225,255,0.3)');
      glow.addColorStop(1, 'rgba(210,225,255,0)');
      c.fillStyle = glow;
      c.fillRect(x - r * 5, y - r * 5, r * 10, r * 10);
      c.fillStyle = '#dfe6f5';
      c.beginPath();
      c.arc(x, y, r, 0, TAU);
      c.fill();
      c.fillStyle = 'rgba(150,165,200,0.35)';
      for (const [dx, dy, k] of [[-0.3, -0.25, 0.22], [0.25, 0.1, 0.3], [-0.1, 0.4, 0.16], [0.35, -0.4, 0.12]] as const) {
        c.beginPath();
        c.arc(x + dx * r, y + dy * r, k * r, 0, TAU);
        c.fill();
      }
    },
    layers: [
      {
        id: 'stars', par: 0.04, tile: 768, alpha: 0.9,
        paint(p) {
          for (let i = 0; i < 50; i++) star(p, rain(p.R, 0, p.T), rain(p.R, 0, p.T), rain(p.R, 0.6, 1.5), '#e8eeff', p.R() < 0.1, p.R() < 0.4);
        },
      },
      {
        id: 'mountains', par: 0.08, tile: 1024, alpha: 0.8,
        paint({ g, T, R }) {
          const n = 14;
          const pts: number[] = [];
          for (let i = 0; i < n; i++) pts.push(T * 0.66 - R() * T * 0.2 * (i % 2 ? 0.6 : 1));
          const f = (x: number): number => {
            const u = (x / T) * n;
            const i = Math.floor(u) % n;
            const j = (i + 1) % n;
            const k = u - Math.floor(u);
            return pts[i] * (1 - k) + pts[j] * k;
          };
          ground(g, T, f, '#262a56', T * 0.3, 0.95);
        },
      },
      {
        id: 'castle-far', par: 0.15, tile: 1024, alpha: 0.8,
        paint(p) {
          const f = ridgeFn(p.R, p.T, p.T * 0.82, p.T * 0.02, [1, 3]);
          ground(p.g, p.T, f, '#1c2048', p.T * 0.16, 1);
          castle(p, p.T * 0.7, f(p.T * 0.7) + 2, 0.55, '#1c2048', '#ffcf80');
        },
      },
      {
        id: 'bats', par: 0.2, tile: 768, alpha: 0.7, drift: 16,
        paint({ g, T, R, rep }) {
          g.fillStyle = '#0c0e22';
          for (let i = 0; i < 7; i++) {
            const x = rain(R, 0, T);
            const y = rain(R, 0, T);
            rep(x, y, 24, () => bat(g, x, y, 0.7 + R() * 0.7));
          }
        },
      },
      {
        id: 'castle-mid', par: 0.3, tile: 1024, alpha: 0.95,
        paint(p) {
          const f = ridgeFn(p.R, p.T, p.T * 0.84, p.T * 0.025, [1, 2]);
          ground(p.g, p.T, f, '#0a0c1e', p.T * 0.15, 1);
          castle(p, p.T * 0.38, f(p.T * 0.38) + 2, 1.15, '#0a0c1e', '#ffc25e');
        },
      },
    ],
  };
}

const SCENE_BUILDERS: Record<SceneKind, () => Scene> = {
  sea: seaScene,
  space: spaceScene,
  clouds: cloudsScene,
  dinosaurs: dinoScene,
  castle: castleScene,
};

/* --------------------------------------------------------------- painter */

/** Reference scale: CSS px of layer scroll per world metre per unit of parallax factor. */
const REF_PX_PER_M = 24;
const CACHE_CAP = 18;

export class BackgroundPainter {
  private scenes = new Map<SceneKind, Scene>();
  private tiles = new Map<string, { canvas: HTMLCanvasElement; anim: Anim[] }>();
  private kinds = ['sea', 'space', 'clouds', 'dinosaurs', 'castle'];
  private gradKey = '';
  private grad: CanvasGradient | null = null;
  /** True when the user prefers reduced motion (no ambient animation). */
  reducedMotion = false;

  constructor() {
    try {
      this.reducedMotion = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch {
      this.reducedMotion = false;
    }
  }

  clearCache(): void {
    this.tiles.clear();
  }

  private scene(kind: SceneKind): Scene {
    let s = this.scenes.get(kind);
    if (!s) {
      s = SCENE_BUILDERS[kind]();
      this.scenes.set(kind, s);
    }
    return s;
  }

  private tile(kind: SceneKind, li: number, layer: Layer, bucket: number): { canvas: HTMLCanvasElement; anim: Anim[] } {
    const key = `${kind}:${li}:${bucket}`;
    const hit = this.tiles.get(key);
    if (hit) {
      this.tiles.delete(key);
      this.tiles.set(key, hit); // LRU touch
      return hit;
    }
    const px = Math.round(layer.tile * bucket);
    const canvas = document.createElement('canvas');
    canvas.width = px;
    canvas.height = px;
    const anim: Anim[] = [];
    const g = canvas.getContext('2d')!;
    g.scale(px / layer.tile, px / layer.tile);
    const T = layer.tile;
    const R = rng(hash32(this.kinds.indexOf(kind) + 1, li + 1, 0x9e37));
    const rep: PaintCtx['rep'] = (cx, cy, ext, fn) => {
      for (const dx of [-T, 0, T]) {
        if (cx + dx + ext < 0 || cx + dx - ext > T) continue;
        for (const dy of [-T, 0, T]) {
          if (cy + dy + ext < 0 || cy + dy - ext > T) continue;
          g.save();
          g.translate(dx, dy);
          fn();
          g.restore();
        }
      }
    };
    layer.paint({ g, T, R, rep, anim });
    const entry = { canvas, anim };
    this.tiles.set(key, entry);
    while (this.tiles.size > CACHE_CAP) {
      const oldest = this.tiles.keys().next().value;
      if (oldest === undefined) break;
      this.tiles.delete(oldest);
    }
    return entry;
  }

  /**
   * Paint the whole backdrop. (camX, camY) = world point at the screen centre, in metres.
   */
  draw(c: Ctx, kind: SceneKind, W: number, H: number, dpr: number, camX: number, camY: number, t: number): void {
    const scene = this.scene(kind);
    const moving = !this.reducedMotion;
    const bucket = dpr > 1.5 ? 2 : 1;
    c.setTransform(1, 0, 0, 1, 0, 0);
    // sky
    const gk = `${kind}:${H}`;
    if (gk !== this.gradKey || !this.grad) {
      const grad = c.createLinearGradient(0, 0, 0, H);
      for (const [o, col] of scene.sky) grad.addColorStop(o, col);
      this.grad = grad;
      this.gradKey = gk;
    }
    c.fillStyle = this.grad;
    c.fillRect(0, 0, W, H);
    scene.before?.(c, W, H, dpr, t, moving);

    scene.layers.forEach((layer, li) => {
      const S = layer.tile * dpr;
      const entry = this.tile(kind, li, layer, bucket);
      const k = REF_PX_PER_M * layer.par * dpr;
      const ox = mod(-camX * k + (moving ? (layer.drift ?? 0) * t * dpr : 0), S);
      const oy = mod(-camY * k, S);
      const shear = moving && layer.sway ? layer.sway * Math.sin(t * 0.9 + layer.par * 17) : 0;
      c.globalAlpha = layer.alpha ?? 1;
      const nx = Math.ceil(W / S) + 1;
      const ny = Math.ceil(H / S) + 1;
      for (let j = -1; j < ny; j++) {
        const y0 = Math.round(oy + j * S);
        const y1 = Math.round(oy + (j + 1) * S);
        if (y1 < 0 || y0 > H) continue;
        for (let i = -1; i < nx; i++) {
          const x0 = Math.round(ox + i * S);
          const x1 = Math.round(ox + (i + 1) * S);
          if (x1 < 0 || x0 > W) continue;
          if (!layer.empty) {
            if (shear) {
              // shear around the tile bottom so plants stay rooted
              c.setTransform(1, 0, shear, 1, -shear * y1, 0);
              c.drawImage(entry.canvas, x0, y0, x1 - x0, y1 - y0);
              c.setTransform(1, 0, 0, 1, 0, 0);
            } else c.drawImage(entry.canvas, x0, y0, x1 - x0, y1 - y0);
          }
          if (moving || layer.empty || entry.anim.length) this.drawAnim(c, entry.anim, x0, y0, S, layer.tile, dpr, t, moving, W, H, layer.alpha ?? 1);
        }
      }
      c.globalAlpha = 1;
    });

    scene.after?.(c, W, H, dpr, t, moving);

    // vignette
    const vg = c.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.hypot(W, H) * 0.6);
    vg.addColorStop(0, 'rgba(0,0,0,0)');
    vg.addColorStop(1, scene.vignette);
    c.fillStyle = vg;
    c.fillRect(0, 0, W, H);
  }

  private drawAnim(c: Ctx, list: Anim[], x0: number, y0: number, S: number, T: number, dpr: number, t: number, moving: boolean, W: number, H: number, base: number): void {
    if (!list.length) return;
    const u = S / T;
    for (const a of list) {
      let ax = a.x;
      let ay = a.y;
      let al = 1;
      if (a.kind === 'twinkle') al = moving ? 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(t * a.sp + a.ph)) : 0.6;
      else if (moving) {
        ay = mod(a.y - t * a.sp, T);
        ax = a.x + Math.sin(t * 0.8 + a.ph) * 6;
        al = Math.sin((ay / T) * Math.PI) * 0.9;
      } else continue;
      const x = x0 + ax * u;
      const y = y0 + ay * u;
      if (x < -8 || y < -8 || x > W + 8 || y > H + 8) continue;
      const r = Math.max(0.6, a.r * u);
      if (a.kind === 'twinkle') {
        c.globalAlpha = base * al * 0.9;
        c.fillStyle = a.color;
        c.fillRect(x - r, y - r, r * 2, r * 2);
      } else if (a.kind === 'bubble') {
        c.globalAlpha = base * al * 0.55;
        c.strokeStyle = a.color;
        c.lineWidth = Math.max(1, dpr * 0.9);
        c.beginPath();
        c.arc(x, y, r, 0, TAU);
        c.stroke();
      } else {
        c.globalAlpha = base * al * 0.8;
        c.fillStyle = a.color;
        c.fillRect(x - r * 0.6, y - r * 0.6, r * 1.2, r * 1.2);
      }
    }
    c.globalAlpha = base;
  }
}
