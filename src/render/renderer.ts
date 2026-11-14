/**
 * Canvas 2D renderer for the marble race: course, mechanisms, marbles,
 * particles and minimap. Pure presentation — never feeds back into the sim.
 */
import type { EffectType, GameConfig, WallReaction } from '../core/config';
import type { LocalShape, MapDef, MarbleProfile, StaticShape, Vec, Wall } from '../core/types';
import type { CameraState, MarbleState, MechanismPose, SimEvent, Simulation, SwitchState } from '../sim/api';
import { alpha, darken, lighten, mix } from './color';
import { ParticleSystem, drawSkull } from './particles';
import { mechanismPoseAt } from './poses';
import { clearSkinCache, drawMarbleSprite, skinColor } from './skins';

export const EFFECT_COLORS: Record<EffectType, string> = {
  grow: '#3ddc84',
  shrink: '#a463ff',
  destroy: '#ff4747',
  attract: '#4aa3ff',
  repel: '#ff8a2a',
};
const STEEL = '#8d98a8';
const FX_COLORS: Record<string, string> = {
  ...EFFECT_COLORS,
  bounce: '#38e07b',
  launch: '#38d6ff',
  slow: '#f2b134',
  kill: '#ff4a1a',
};

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

interface View {
  s: number; // device px per metre
  tx: number;
  ty: number;
  box: Box; // visible world rect
}

interface Item {
  box: Box;
}
interface WallItem extends Item {
  wall: Wall;
}
interface GateItem extends Item {
  id: string;
  shape: StaticShape;
  center: Vec;
}

export interface PreviewMarble {
  x: number;
  y: number;
  radius: number;
  profile: MarbleProfile;
}

const FONT = '600 12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

function shapeBox(sh: StaticShape): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (x: number, y: number, pad: number) => {
    x0 = Math.min(x0, x - pad);
    y0 = Math.min(y0, y - pad);
    x1 = Math.max(x1, x + pad);
    y1 = Math.max(y1, y + pad);
  };
  if (sh.type === 'circle') add(sh.center.x, sh.center.y, sh.radius);
  else {
    const pad = sh.type === 'polyline' ? sh.thickness / 2 : 0;
    for (const p of sh.points) add(p.x, p.y, pad);
  }
  return { x0, y0, x1, y1 };
}

function shapeCenter(sh: StaticShape): Vec {
  if (sh.type === 'circle') return sh.center;
  let x = 0;
  let y = 0;
  for (const p of sh.points) {
    x += p.x;
    y += p.y;
  }
  return { x: x / sh.points.length, y: y / sh.points.length };
}

function intersects(a: Box, b: Box): boolean {
  return a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0;
}

export class Renderer {
  readonly canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private mini: HTMLCanvasElement | null;
  private miniCtx: CanvasRenderingContext2D | null = null;
  private miniStatic: HTMLCanvasElement | null = null;
  private miniScale = 1;
  private miniOrigin: Vec = { x: 0, y: 0 };

  private dpr = 1;
  private W = 1;
  private H = 1;

  private map: MapDef | null = null;
  private config: GameConfig;
  private walls: WallItem[] = [];
  private gates: GateItem[] = [];
  private reach: number[] = [];
  private poses0: MechanismPose[] = [];
  private courseBox: Box = { x0: 0, y0: 0, x1: 1, y1: 1 };
  private gateAlpha = new Map<string, number>();
  private fxLast = new Map<string, number>();
  private particles = new ParticleSystem();
  private clock = 0;

  /** Name tags above the top-3 marbles. */
  nameTags = true;

  // preview viewport
  private pv = { cx: 0, cy: 0, scale: 1, fitted: true };
  private lastView: View | null = null;
  private labels: { text: string; x: number; y: number; color: string; size: number; bold?: boolean }[] = [];

  constructor(canvas: HTMLCanvasElement, config: GameConfig, minimap?: HTMLCanvasElement | null) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.mini = minimap ?? null;
    this.miniCtx = this.mini ? this.mini.getContext('2d') : null;
    this.config = config;
    this.resize();
  }

  setConfig(config: GameConfig): void {
    this.config = config;
  }

  /* ------------------------------------------------------------ setup */

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * this.dpr));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * this.dpr));
    if (w !== this.canvas.width || h !== this.canvas.height) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.W = w;
    this.H = h;
    if (this.pv.fitted) this.previewFit();
    if (this.map) this.buildMinimap();
    clearSkinCache();
  }

  setMap(map: MapDef): void {
    this.map = map;
    this.walls = map.walls.map((wall) => ({ wall, box: shapeBox(wall.shape) }));
    this.gates = map.gates.map((g) => ({ id: g.id, shape: g.shape, box: shapeBox(g.shape), center: shapeCenter(g.shape) }));
    this.poses0 = map.mechanisms.map((m) => mechanismPoseAt(m, 0));
    this.reach = map.mechanisms.map((m) => {
      let r = 0;
      for (const l of m.links) {
        let e = 0;
        for (const sh of l.shapes) e = Math.max(e, localShapeExtent(sh));
        r += e + (l.tip ? Math.hypot(l.tip.x, l.tip.y) : 0);
      }
      return Math.max(r, m.fieldRadius ?? 0) + 1.5;
    });
    this.gateAlpha.clear();
    for (const g of map.gates) this.gateAlpha.set(g.id, 1);
    this.fxLast.clear();
    this.particles.clear();
    this.courseBox = computeCourseBox(map);
    this.pv.fitted = true;
    this.previewFit();
    this.buildMinimap();
  }

  /** Forget transient visuals (call when restarting the same map). */
  resetVisuals(): void {
    this.particles.clear();
    this.fxLast.clear();
    for (const g of this.gates) this.gateAlpha.set(g.id, 1);
  }

  /* ---------------------------------------------------------- preview */

  previewFit(): void {
    const b = this.courseBox;
    const pad = 1.06;
    const w = Math.max(1, b.x1 - b.x0) * pad;
    const h = Math.max(1, b.y1 - b.y0) * pad;
    this.pv.scale = Math.min(this.W / w, this.H / h);
    this.pv.cx = (b.x0 + b.x1) / 2;
    this.pv.cy = (b.y0 + b.y1) / 2;
    this.pv.fitted = true;
  }

  previewPan(dxCss: number, dyCss: number): void {
    this.pv.cx -= (dxCss * this.dpr) / this.pv.scale;
    this.pv.cy -= (dyCss * this.dpr) / this.pv.scale;
    this.pv.fitted = false;
  }

  previewZoomAt(factor: number, xCss: number, yCss: number): void {
    const old = this.pv.scale;
    const fit = this.fitScale();
    const next = Math.max(fit * 0.5, Math.min(old * factor, fit * 40));
    const px = xCss * this.dpr;
    const py = yCss * this.dpr;
    // keep the world point under the cursor fixed
    const wx = (px - this.W / 2) / old + this.pv.cx;
    const wy = (py - this.H / 2) / old + this.pv.cy;
    this.pv.scale = next;
    this.pv.cx = wx - (px - this.W / 2) / next;
    this.pv.cy = wy - (py - this.H / 2) / next;
    this.pv.fitted = false;
  }

  private fitScale(): number {
    const b = this.courseBox;
    return Math.min(this.W / ((b.x1 - b.x0) * 1.06 || 1), this.H / ((b.y1 - b.y0) * 1.06 || 1));
  }

  renderPreview(map: MapDef, roster?: MarbleProfile[]): void {
    if (this.map !== map) this.setMap(map);
    const { s } = { s: this.pv.scale };
    const view = this.makeView(s, this.pv.cx, this.pv.cy);
    const radius = this.config.marbles.radius;
    const placeholders: PreviewMarble[] = map.start.spawnPoints.map((p, i) => ({
      x: p.x,
      y: p.y,
      radius,
      profile: roster?.[i] ?? { id: i, name: '', skin: { type: 'solid', colors: ['#9aa6b8'] } },
    }));
    this.clock = performance.now() / 1000;
    this.drawScene(view, this.poses0, new Set(), new Map(), placeholders.map((m) => ({ ...m, angle: 0, status: 'waiting' as const, offscreenTime: 0, progress: 0, id: m.profile.id })), null);
    this.drawMinimap(placeholders, view.box, false);
  }

  /* ------------------------------------------------------------- live */

  /** Draw one frame of a live race. `events` = what `sim.drainEvents()` returned this frame. */
  render(sim: Simulation, dt: number, events: readonly SimEvent[] = []): void {
    if (this.map !== sim.map) this.setMap(sim.map);
    this.clock = performance.now() / 1000;
    const cam = sim.getCamera();
    const view = this.cameraView(cam);
    const marbles = sim.getMarbles();
    this.handleEvents(events, marbles);
    this.particles.update(dt);

    const open = new Set(sim.getOpenGates());
    const sw = new Map<string, SwitchState>();
    for (const st of sim.getSwitchStates()) sw.set(st.id, st);
    for (const g of this.gates) {
      const a = this.gateAlpha.get(g.id) ?? 1;
      const target = open.has(g.id) ? 0 : 1;
      this.gateAlpha.set(g.id, a + (target - a) * Math.min(1, dt * 6 + (open.has(g.id) ? 0.0 : 1)));
    }
    this.drawScene(view, sim.getMechanismPoses(), open, sw, marbles, cam);
    this.drawMinimap(marbles, view.box, true, cam);
  }

  /* ---------------------------------------------------------- helpers */

  private cameraView(cam: CameraState): View {
    const s = Math.min(this.W / cam.width, this.H / cam.height);
    return this.makeView(s, cam.x, cam.y);
  }

  private makeView(s: number, cx: number, cy: number): View {
    const tx = this.W / 2 - cx * s;
    const ty = this.H / 2 - cy * s;
    return {
      s,
      tx,
      ty,
      box: { x0: -tx / s, y0: -ty / s, x1: (this.W - tx) / s, y1: (this.H - ty) / s },
    };
  }

  private handleEvents(events: readonly SimEvent[], marbles: readonly MarbleState[]): void {
    const map = this.map;
    if (!map) return;
    const find = (id: number) => (marbles[id]?.id === id ? marbles[id] : marbles.find((m) => m.id === id));
    for (const e of events) {
      switch (e.type) {
        case 'eliminated': {
          const m = find(e.marbleId);
          const col = m ? skinColor(m.profile.skin) : '#ffffff';
          this.particles.burst(e.x, e.y, col, 26, 9);
          this.particles.burst(e.x, e.y, '#ffffff', 8, 6);
          this.particles.ring(e.x, e.y, col, 1.6, 0.5);
          this.particles.skull(e.x, e.y - 0.4);
          break;
        }
        case 'finish': {
          const m = find(e.marbleId);
          if (m) {
            const cols = [...m.profile.skin.colors, '#ffd54a', '#ffffff'];
            this.particles.confetti(m.x, m.y, cols, 36);
            this.particles.ring(m.x, m.y, '#ffd54a', 2.2, 0.7);
          }
          break;
        }
        case 'effect': {
          const col = FX_COLORS[e.effect];
          if (!col) break;
          if (e.effect === 'attract' || e.effect === 'repel') break;
          const key = `${e.marbleId}:${e.effect}`;
          const last = this.fxLast.get(key) ?? -9;
          if (this.clock - last < 0.18) break;
          this.fxLast.set(key, this.clock);
          const n = e.effect === 'bounce' || e.effect === 'slow' ? 4 : 10;
          this.particles.burst(e.x, e.y, col, n, e.effect === 'launch' ? 8 : 5);
          if (e.effect === 'grow' || e.effect === 'shrink') this.particles.ring(e.x, e.y, col, 1.2, 0.45);
          break;
        }
        case 'switch': {
          const sw = map.switches.find((s) => s.id === e.switchId);
          if (sw) {
            this.particles.ring(sw.position.x, sw.position.y, e.active ? '#46f08a' : '#e0b12f', 3, 0.7);
            this.particles.burst(sw.position.x, sw.position.y, e.active ? '#46f08a' : '#e0b12f', 14, 6);
          }
          break;
        }
        case 'gateOpen': {
          const g = this.gates.find((x) => x.id === e.gateId);
          if (g) this.particles.dust(g.center.x, g.center.y, alpha(map.theme.wall, 0.8), 18, Math.max(1, g.box.x1 - g.box.x0));
          break;
        }
        default:
          break;
      }
    }
  }

  /* ----------------------------------------------------- scene drawing */

  private drawScene(
    view: View,
    poses: readonly MechanismPose[],
    openGates: Set<string>,
    switches: Map<string, SwitchState>,
    marbles: readonly (PreviewMarble & Partial<MarbleState>)[] | readonly MarbleState[],
    cam: CameraState | null,
  ): void {
    const map = this.map!;
    const ctx = this.ctx;
    const { s, tx, ty, box } = view;
    this.lastView = view;
    this.labels.length = 0;
    const t = this.clock;

    // background + parallax dots
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = map.theme.background;
    ctx.fillRect(0, 0, this.W, this.H);
    this.drawBackdrop(view);

    ctx.setTransform(s, 0, 0, s, tx, ty);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // start area outline
    ctx.strokeStyle = alpha(map.theme.accent, 0.35);
    ctx.lineWidth = 0.12;
    ctx.setLineDash([0.5, 0.4]);
    pathPoly(ctx, map.start.area);
    ctx.stroke();
    ctx.setLineDash([]);

    // zones
    for (const z of map.zones) this.drawZone(z.shape, z.effect, t);

    // mechanism force fields (under walls)
    map.mechanisms.forEach((m, i) => {
      const p = poses[i];
      if (!p || !p.field || !m.fieldRadius) return;
      if (m.effect !== 'attract' && m.effect !== 'repel') return;
      const r = m.fieldRadius;
      if (p.field.x + r < box.x0 || p.field.x - r > box.x1 || p.field.y + r < box.y0 || p.field.y - r > box.y1) return;
      this.drawField(p.field, r, m.effect, t);
    });

    // walls
    for (const w of this.walls) {
      if (!intersects(w.box, box)) continue;
      this.drawWall(w.wall, t);
    }

    // finish line
    this.drawFinish(map);

    // gates
    for (const g of this.gates) {
      if (!intersects(g.box, box)) continue;
      const a = openGates.size === 0 && !this.gateAlpha.has(g.id) ? 1 : (this.gateAlpha.get(g.id) ?? 1);
      if (a < 0.03) continue;
      this.drawGate(g.shape, a, map.theme.accent);
    }

    // mechanisms
    map.mechanisms.forEach((m, i) => {
      const p = poses[i];
      if (!p) return;
      const r = this.reach[i];
      const pv = p.links[0];
      if (pv.x + r < box.x0 || pv.x - r > box.x1 || pv.y + r < box.y0 || pv.y - r > box.y1) return;
      const col = m.effect ? EFFECT_COLORS[m.effect] : STEEL;
      m.links.forEach((link, li) => {
        const lp = p.links[li];
        if (lp) this.drawLink(link.shapes, lp.x, lp.y, lp.angle, col, m.effect === 'destroy');
      });
      for (const lp of p.links) this.drawBolt(lp.x, lp.y);
    });

    // switches
    for (const sw of map.switches) {
      if (sw.position.x < box.x0 - 3 || sw.position.x > box.x1 + 3 || sw.position.y < box.y0 - 3 || sw.position.y > box.y1 + 3) continue;
      this.drawSwitch(sw.position, sw.halfWidth, sw.halfHeight, sw.angle, switches.get(sw.id), t);
      this.labels.push({ text: sw.label, x: sw.position.x, y: sw.position.y - Math.max(sw.halfWidth, 0.6) * 0.7 - 0.7, color: '#d8deea', size: 10.5 });
    }

    // marbles (device pixel space)
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.drawMarbles(view, marbles as readonly MarbleState[]);

    // particles
    ctx.setTransform(s, 0, 0, s, tx, ty);
    this.particles.draw(ctx);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // offscreen-kill zone dimming
    if (cam && this.config.camera.offscreenKill) {
      const rx = (cam.x - cam.width / 2) * s + tx;
      const ry = (cam.y - cam.height / 2) * s + ty;
      const rw = cam.width * s;
      const rh = cam.height * s;
      ctx.fillStyle = 'rgba(5,7,12,0.55)';
      ctx.beginPath();
      ctx.rect(0, 0, this.W, this.H);
      ctx.rect(rx, ry, rw, rh);
      ctx.fill('evenodd');
      ctx.strokeStyle = 'rgba(255,90,70,0.55)';
      ctx.lineWidth = 2 * this.dpr;
      ctx.setLineDash([10 * this.dpr, 7 * this.dpr]);
      ctx.strokeRect(rx, ry, rw, rh);
      ctx.setLineDash([]);
      this.drawOffscreenWarnings(view, marbles as readonly MarbleState[]);
    }

    this.drawLabels(view);
    if (cam && this.nameTags) this.drawNameTags(view, marbles as readonly MarbleState[]);
  }

  private drawBackdrop(view: View): void {
    const ctx = this.ctx;
    const sp = Math.max(24 * this.dpr, 3 * view.s);
    const par = 0.55;
    const ox = ((-view.tx * par) % sp + sp) % sp;
    const oy = ((-view.ty * par) % sp + sp) % sp;
    ctx.fillStyle = 'rgba(255,255,255,0.055)';
    const r = Math.max(1, 1.4 * this.dpr);
    for (let x = -ox; x < this.W + sp; x += sp) {
      for (let y = -oy; y < this.H + sp; y += sp) {
        ctx.fillRect(x - r / 2, y - r / 2, r, r);
      }
    }
  }

  private reactionOf(w: Wall): WallReaction {
    return w.boundary ? this.config.walls.boundary : w.reaction;
  }

  private drawWall(w: Wall, t: number): void {
    const ctx = this.ctx;
    const theme = this.map!.theme;
    const re = this.reactionOf(w);
    let fill = theme.wall;
    let edge = darken(theme.wall, 0.55);
    let glow: string | null = null;
    switch (re) {
      case 'bounce':
        fill = '#38e07b';
        edge = '#0c7a3d';
        glow = '#38e07b';
        break;
      case 'slow':
        fill = '#f2b134';
        edge = '#8a5a0c';
        glow = '#f2b134';
        break;
      case 'kill': {
        const k = 0.5 + 0.5 * Math.sin(t * 5 + w.id.length);
        fill = mix('#ff3b1f', '#ffb020', k);
        edge = '#6e0f06';
        glow = '#ff4a1a';
        break;
      }
      case 'launch':
        fill = '#38b6ff';
        edge = '#0b5a8a';
        glow = '#38d6ff';
        break;
    }
    const sh = w.shape;
    const style = w.style ?? 'wall';
    const glowA = re === 'kill' ? 0.22 + 0.15 * Math.sin(t * 5) : 0.2;
    if (sh.type === 'polyline') {
      pathLine(ctx, sh.points);
      if (glow) {
        ctx.strokeStyle = alpha(glow, glowA);
        ctx.lineWidth = sh.thickness + 0.8;
        ctx.stroke();
      }
      ctx.strokeStyle = edge;
      ctx.lineWidth = sh.thickness + 0.14;
      ctx.stroke();
      ctx.strokeStyle = fill;
      ctx.lineWidth = sh.thickness;
      ctx.stroke();
      ctx.strokeStyle = re === 'solid' ? alpha('#ffffff', 0.12) : alpha(lighten(fill, 0.5), 0.45);
      ctx.lineWidth = Math.max(0.06, sh.thickness * 0.28);
      ctx.stroke();
      if (re === 'kill') this.drawLavaSpikes(sh.points, sh.thickness, t);
    } else if (sh.type === 'polygon') {
      pathPoly(ctx, sh.points);
      if (glow) {
        ctx.strokeStyle = alpha(glow, glowA);
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      ctx.fillStyle = fill;
      ctx.fill();
      ctx.strokeStyle = edge;
      ctx.lineWidth = 0.12;
      ctx.stroke();
    } else {
      const { center: c, radius: r } = sh;
      if (glow) {
        ctx.fillStyle = alpha(glow, glowA + (style === 'bumper' ? 0.08 * Math.sin(t * 4) : 0));
        ctx.beginPath();
        ctx.arc(c.x, c.y, r + 0.35, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = fill;
      ctx.strokeStyle = edge;
      ctx.lineWidth = 0.12;
      ctx.beginPath();
      ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      if (style === 'bumper') {
        ctx.fillStyle = alpha('#ffffff', 0.3);
        ctx.beginPath();
        ctx.arc(c.x, c.y, r * 0.55, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.fillStyle = alpha('#ffffff', 0.35);
      ctx.beginPath();
      ctx.arc(c.x - r * 0.3, c.y - r * 0.3, r * 0.22, 0, Math.PI * 2);
      ctx.fill();
    }
    if (re === 'launch' && w.launchDir) this.drawChevrons(sh, w.launchDir, t);
  }

  private drawLavaSpikes(points: Vec[], th: number, t: number): void {
    // small flickering embers along the lava line
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(255,230,140,0.8)';
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.min(12, Math.floor(l / 0.9));
      for (let k = 0; k < n; k++) {
        const u = (k + 0.5) / n;
        const f = 0.5 + 0.5 * Math.sin(t * 6 + k * 2.3 + i);
        ctx.beginPath();
        ctx.arc(a.x + (b.x - a.x) * u, a.y + (b.y - a.y) * u, th * 0.14 * f, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  }

  private drawChevrons(sh: StaticShape, dir: Vec, t: number): void {
    const ctx = this.ctx;
    const len = Math.hypot(dir.x, dir.y) || 1;
    const d = { x: dir.x / len, y: dir.y / len };
    const n = { x: -d.y, y: d.x };
    const pts: Vec[] = [];
    if (sh.type === 'circle') pts.push(sh.center);
    else if (sh.type === 'polyline') {
      for (let i = 0; i < sh.points.length - 1; i++) {
        const a = sh.points[i];
        const b = sh.points[i + 1];
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        const cnt = Math.max(1, Math.floor(l / 1.1));
        for (let k = 0; k < cnt; k++) pts.push({ x: a.x + ((b.x - a.x) * (k + 0.5)) / cnt, y: a.y + ((b.y - a.y) * (k + 0.5)) / cnt });
      }
    } else {
      const c = shapeCenter(sh);
      let best = 0;
      let ex = 1;
      let ey = 0;
      for (let i = 0; i < sh.points.length; i++) {
        const a = sh.points[i];
        const b = sh.points[(i + 1) % sh.points.length];
        const l = Math.hypot(b.x - a.x, b.y - a.y);
        if (l > best) {
          best = l;
          ex = (b.x - a.x) / l;
          ey = (b.y - a.y) / l;
        }
      }
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of sh.points) {
        const u = (p.x - c.x) * ex + (p.y - c.y) * ey;
        lo = Math.min(lo, u);
        hi = Math.max(hi, u);
      }
      const cnt = Math.max(1, Math.floor((hi - lo) / 1.0));
      for (let k = 0; k < cnt; k++) {
        const u = lo + ((hi - lo) * (k + 0.5)) / cnt;
        pts.push({ x: c.x + ex * u, y: c.y + ey * u });
      }
    }
    const k = 0.3;
    ctx.lineWidth = 0.09;
    ctx.lineCap = 'round';
    pts.forEach((p, i) => {
      const a = 0.45 + 0.5 * Math.max(0, Math.sin(t * 5 - i * 0.9));
      ctx.strokeStyle = `rgba(255,255,255,${a})`;
      ctx.beginPath();
      ctx.moveTo(p.x - n.x * k - d.x * k * 0.7, p.y - n.y * k - d.y * k * 0.7);
      ctx.lineTo(p.x + d.x * k * 0.7, p.y + d.y * k * 0.7);
      ctx.lineTo(p.x + n.x * k - d.x * k * 0.7, p.y + n.y * k - d.y * k * 0.7);
      ctx.stroke();
    });
  }

  private drawGate(sh: StaticShape, a: number, accent: string): void {
    const ctx = this.ctx;
    ctx.globalAlpha = a;
    if (sh.type === 'polyline') {
      pathLine(ctx, sh.points);
      ctx.strokeStyle = alpha(accent, 0.4);
      ctx.lineWidth = sh.thickness;
      ctx.stroke();
      ctx.strokeStyle = alpha('#ffffff', 0.7);
      ctx.lineWidth = 0.06;
      ctx.setLineDash([0.3, 0.25]);
      ctx.stroke();
      ctx.setLineDash([]);
    } else {
      if (sh.type === 'circle') {
        ctx.beginPath();
        ctx.arc(sh.center.x, sh.center.y, sh.radius, 0, Math.PI * 2);
      } else pathPoly(ctx, sh.points);
      ctx.fillStyle = alpha(accent, 0.3);
      ctx.fill();
      const b = shapeBox(sh);
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = alpha(accent, 0.85);
      ctx.lineWidth = 0.07;
      ctx.beginPath();
      const step = 0.32;
      for (let x = b.x0 - (b.y1 - b.y0); x < b.x1 + 0.1; x += step) {
        ctx.moveTo(x, b.y1);
        ctx.lineTo(x + (b.y1 - b.y0), b.y0);
      }
      ctx.stroke();
      ctx.restore();
      if (sh.type === 'circle') {
        ctx.beginPath();
        ctx.arc(sh.center.x, sh.center.y, sh.radius, 0, Math.PI * 2);
      } else pathPoly(ctx, sh.points);
      ctx.strokeStyle = alpha('#ffffff', 0.75);
      ctx.lineWidth = 0.06;
      ctx.setLineDash([0.3, 0.2]);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.globalAlpha = 1;
  }

  private drawLink(shapes: LocalShape[], px: number, py: number, angle: number, color: string, saw: boolean): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(angle);
    ctx.beginPath();
    for (const sh of shapes) {
      if (sh.type === 'box') {
        ctx.save();
        ctx.translate(sh.cx, sh.cy);
        ctx.rotate(sh.angle);
        ctx.rect(-sh.hw, -sh.hh, sh.hw * 2, sh.hh * 2);
        ctx.restore();
      } else if (sh.type === 'circle') {
        ctx.moveTo(sh.cx + sh.r, sh.cy);
        ctx.arc(sh.cx, sh.cy, sh.r, 0, Math.PI * 2);
      } else {
        const p = sh.points;
        if (p.length) {
          ctx.moveTo(p[0].x, p[0].y);
          for (let i = 1; i < p.length; i++) ctx.lineTo(p[i].x, p[i].y);
          ctx.closePath();
        }
      }
    }
    ctx.strokeStyle = darken(color, 0.62);
    ctx.lineWidth = 0.16;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = alpha(lighten(color, 0.55), 0.5);
    ctx.lineWidth = 0.035;
    ctx.stroke();
    if (saw) {
      ctx.strokeStyle = alpha('#2a0505', 0.55);
      ctx.lineWidth = 0.07;
      for (const sh of shapes) {
        if (sh.type === 'circle') {
          ctx.beginPath();
          ctx.arc(sh.cx, sh.cy, sh.r * 0.62, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  private drawBolt(x: number, y: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#d5dbe6';
    ctx.strokeStyle = '#303746';
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.arc(x, y, 0.17, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#4a5366';
    ctx.beginPath();
    ctx.arc(x, y, 0.06, 0, Math.PI * 2);
    ctx.fill();
  }

  private drawField(c: Vec, r: number, effect: EffectType, t: number): void {
    const ctx = this.ctx;
    const col = EFFECT_COLORS[effect];
    ctx.fillStyle = alpha(col, 0.07);
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.lineWidth = 0.07;
    ctx.setLineDash([0.35, 0.3]);
    for (let k = 0; k < 3; k++) {
      const p = (t * 0.55 + k / 3) % 1;
      const rr = effect === 'attract' ? r * (1 - p) : r * p;
      ctx.strokeStyle = alpha(col, Math.sin(Math.PI * p) * 0.6);
      ctx.lineDashOffset = -t * (effect === 'attract' ? -1 : 1);
      ctx.beginPath();
      ctx.arc(c.x, c.y, Math.max(0.05, rr), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    ctx.strokeStyle = alpha(col, 0.35);
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.stroke();
  }

  private drawZone(sh: { type: 'circle'; center: Vec; radius: number } | { type: 'polygon'; points: Vec[] }, effect: EffectType, t: number): void {
    const ctx = this.ctx;
    const col = EFFECT_COLORS[effect];
    const pulse = 0.5 + 0.5 * Math.sin(t * 3);
    ctx.beginPath();
    let c: Vec;
    let r: number;
    if (sh.type === 'circle') {
      ctx.arc(sh.center.x, sh.center.y, sh.radius, 0, Math.PI * 2);
      c = sh.center;
      r = sh.radius;
    } else {
      pathPoly(ctx, sh.points);
      c = shapeCenter(sh);
      const b = shapeBox(sh);
      r = Math.min(b.x1 - b.x0, b.y1 - b.y0) / 2;
    }
    ctx.fillStyle = alpha(col, 0.2 + 0.08 * pulse);
    ctx.fill();
    ctx.strokeStyle = alpha(col, 0.75);
    ctx.lineWidth = 0.1;
    ctx.setLineDash([0.4, 0.3]);
    ctx.lineDashOffset = -t * 0.6;
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineDashOffset = 0;
    drawGlyph(ctx, effect, c.x, c.y, Math.min(r * 0.55, 1.1), alpha(lighten(col, 0.5), 0.95));
  }

  private drawFinish(map: MapDef): void {
    const ctx = this.ctx;
    const { a, b } = map.finish;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L = Math.hypot(dx, dy) || 1;
    const ux = dx / L;
    const uy = dy / L;
    const cell = 0.3;
    const n = Math.ceil(L / cell);
    const cl = L / n;
    ctx.save();
    ctx.translate(a.x, a.y);
    ctx.rotate(Math.atan2(uy, ux));
    for (let row = 0; row < 3; row++) {
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = (i + row) % 2 === 0 ? '#f5f7fb' : '#161a24';
        ctx.fillRect(i * cl, (row - 1.5) * cell, cl + 0.01, cell + 0.01);
      }
    }
    ctx.restore();
    this.labels.push({ text: 'META', x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 1.1, color: '#ffffff', size: 13, bold: true });
  }

  private drawSwitch(p: Vec, hw: number, hh: number, angle: number, st: SwitchState | undefined, t: number): void {
    const ctx = this.ctx;
    const active = !!st?.active;
    ctx.save();
    ctx.translate(p.x, p.y);
    ctx.rotate(angle);
    if (active) {
      const g = ctx.createRadialGradient(0, 0, 0, 0, 0, hw + 1.2);
      g.addColorStop(0, 'rgba(70,240,138,0.6)');
      g.addColorStop(1, 'rgba(70,240,138,0)');
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(0, 0, hw + 1.2 + 0.1 * Math.sin(t * 8), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#2a3140';
    ctx.strokeStyle = '#11141b';
    ctx.lineWidth = 0.06;
    roundRect(ctx, -hw - 0.12, -hh - 0.05, (hw + 0.12) * 2, (hh + 0.05) * 2 + 0.12, 0.08);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = active ? '#46f08a' : '#e0b12f';
    roundRect(ctx, -hw, -hh, hw * 2, hh * 2, Math.min(hh, 0.1));
    ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.45)';
    ctx.fillRect(-hw * 0.9, -hh * 0.8, hw * 1.8, Math.max(0.03, hh * 0.35));
    if (active && st && st.remaining > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.5)';
      ctx.fillRect(-hw, hh + 0.12, hw * 2, 0.08);
      ctx.fillStyle = '#46f08a';
      ctx.fillRect(-hw, hh + 0.12, hw * 2 * Math.min(1, st.remaining / 10), 0.08);
    }
    ctx.restore();
  }

  private drawMarbles(view: View, marbles: readonly MarbleState[]): void {
    const ctx = this.ctx;
    const { s, tx, ty } = view;
    for (const m of marbles) {
      if (m.status === 'eliminated') continue;
      const sx = m.x * s + tx;
      const sy = m.y * s + ty;
      const rPx = m.radius * s;
      if (sx < -rPx * 2 || sy < -rPx * 2 || sx > this.W + rPx * 2 || sy > this.H + rPx * 2) continue;
      if (rPx < 1.6) {
        ctx.fillStyle = skinColor(m.profile.skin);
        ctx.fillRect(sx - 1, sy - 1, 2, 2);
        continue;
      }
      drawMarbleSprite(ctx, m.profile.skin, sx, sy, rPx, m.angle);
    }
  }

  private drawOffscreenWarnings(view: View, marbles: readonly MarbleState[]): void {
    const ctx = this.ctx;
    const { s, tx, ty } = view;
    const grace = Math.max(0.1, this.config.camera.offscreenGrace);
    for (const m of marbles) {
      if (m.status === 'eliminated' || !(m.offscreenTime > 0)) continue;
      const sx = m.x * s + tx;
      const sy = m.y * s + ty;
      const r = m.radius * s + 4 * this.dpr;
      if (sx < -r || sy < -r || sx > this.W + r || sy > this.H + r) continue;
      const f = Math.min(1, m.offscreenTime / grace);
      ctx.strokeStyle = `rgba(255,${Math.round(180 - 140 * f)},60,${0.55 + 0.45 * Math.sin(this.clock * 14)})`;
      ctx.lineWidth = 2.5 * this.dpr;
      ctx.beginPath();
      ctx.arc(sx, sy, r + 2 * this.dpr, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.12, f));
      ctx.stroke();
    }
  }

  private drawLabels(view: View): void {
    const ctx = this.ctx;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const l of this.labels) {
      const px = Math.max(9 * this.dpr, Math.min(l.size * this.dpr, l.size * this.dpr * (view.s / (28 * this.dpr)) + 6 * this.dpr));
      const x = l.x * view.s + view.tx;
      const y = l.y * view.s + view.ty;
      if (x < -100 || y < -30 || x > this.W + 100 || y > this.H + 30) continue;
      ctx.font = FONT.replace('600', l.bold ? '800' : '600').replace('12px', `${px}px`);
      ctx.lineWidth = 3 * this.dpr;
      ctx.strokeStyle = 'rgba(8,10,16,0.85)';
      ctx.lineJoin = 'round';
      ctx.strokeText(l.text, x, y);
      ctx.fillStyle = l.color;
      ctx.fillText(l.text, x, y);
    }
  }

  private drawNameTags(view: View, marbles: readonly MarbleState[]): void {
    const ctx = this.ctx;
    const live = marbles.filter((m) => m.status === 'racing' || m.status === 'finished');
    live.sort((a, b) => {
      if (a.status === 'finished' && b.status === 'finished') return (a.rank ?? 99) - (b.rank ?? 99);
      if (a.status === 'finished') return -1;
      if (b.status === 'finished') return 1;
      return b.progress - a.progress;
    });
    ctx.textAlign = 'center';
    ctx.textBaseline = 'alphabetic';
    ctx.font = FONT.replace('12px', `${11 * this.dpr}px`);
    live.slice(0, 3).forEach((m, i) => {
      const x = m.x * view.s + view.tx;
      const y = m.y * view.s + view.ty - m.radius * view.s - 5 * this.dpr;
      if (x < 0 || y < 0 || x > this.W || y > this.H) return;
      const txt = `${i + 1}º ${m.profile.name}`;
      ctx.lineWidth = 3 * this.dpr;
      ctx.strokeStyle = 'rgba(8,10,16,0.85)';
      ctx.strokeText(txt, x, y);
      ctx.fillStyle = ['#ffd54a', '#dfe5ee', '#f0a36b'][i];
      ctx.fillText(txt, x, y);
    });
  }

  /* ---------------------------------------------------------- minimap */

  private buildMinimap(): void {
    if (!this.mini || !this.map) return;
    const map = this.map;
    const b = this.courseBox;
    const bw = Math.max(1, b.x1 - b.x0);
    const bh = Math.max(1, b.y1 - b.y0);
    const k = Math.min(170 / bw, 300 / bh);
    const cssW = Math.max(24, Math.round(bw * k));
    const cssH = Math.max(24, Math.round(bh * k));
    this.mini.style.width = `${cssW}px`;
    this.mini.style.height = `${cssH}px`;
    this.mini.width = Math.round(cssW * this.dpr);
    this.mini.height = Math.round(cssH * this.dpr);
    this.miniScale = (k * this.dpr);
    this.miniOrigin = { x: b.x0, y: b.y0 };
    const st = document.createElement('canvas');
    st.width = this.mini.width;
    st.height = this.mini.height;
    const g = st.getContext('2d')!;
    g.fillStyle = alpha(map.theme.background, 0.88);
    g.fillRect(0, 0, st.width, st.height);
    g.scale(this.miniScale, this.miniScale);
    g.translate(-b.x0, -b.y0);
    g.lineJoin = 'round';
    g.lineCap = 'round';
    const px = 1 / this.miniScale;
    for (const w of map.walls) {
      const re = this.reactionOf(w);
      const col = re === 'solid' ? alpha(map.theme.wall, 0.75) : (FX_COLORS[re === 'kill' ? 'kill' : re] ?? map.theme.wall);
      g.strokeStyle = col;
      g.fillStyle = col;
      const sh = w.shape;
      if (sh.type === 'polyline') {
        pathLine(g, sh.points);
        g.lineWidth = Math.max(px * 1.2, sh.thickness);
        g.stroke();
      } else if (sh.type === 'polygon') {
        pathPoly(g, sh.points);
        g.fill();
      } else {
        g.beginPath();
        g.arc(sh.center.x, sh.center.y, Math.max(sh.radius, px), 0, Math.PI * 2);
        g.fill();
      }
    }
    for (const m of map.mechanisms) {
      g.fillStyle = m.effect ? EFFECT_COLORS[m.effect] : STEEL;
      g.beginPath();
      g.arc(m.pivot.x, m.pivot.y, Math.max(px * 2, 0.6), 0, Math.PI * 2);
      g.fill();
    }
    g.strokeStyle = '#ffffff';
    g.lineWidth = Math.max(px * 2, 0.4);
    g.beginPath();
    g.moveTo(map.finish.a.x, map.finish.a.y);
    g.lineTo(map.finish.b.x, map.finish.b.y);
    g.stroke();
    this.miniStatic = st;
  }

  private drawMinimap(
    marbles: readonly { x: number; y: number; profile: MarbleProfile; status?: string }[],
    viewBox: Box,
    live: boolean,
    cam?: CameraState,
  ): void {
    const g = this.miniCtx;
    if (!g || !this.mini || !this.miniStatic) return;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.clearRect(0, 0, this.mini.width, this.mini.height);
    g.drawImage(this.miniStatic, 0, 0);
    const k = this.miniScale;
    const o = this.miniOrigin;
    const X = (x: number) => (x - o.x) * k;
    const Y = (y: number) => (y - o.y) * k;
    const r = Math.max(1.6 * this.dpr, 0);
    for (const m of marbles) {
      if (m.status === 'eliminated') continue;
      g.fillStyle = skinColor(m.profile.skin);
      g.fillRect(X(m.x) - r, Y(m.y) - r, r * 2, r * 2);
    }
    g.strokeStyle = 'rgba(255,255,255,0.9)';
    g.lineWidth = 1.2 * this.dpr;
    if (live && cam) g.strokeRect(X(cam.x - cam.width / 2), Y(cam.y - cam.height / 2), cam.width * k, cam.height * k);
    else g.strokeRect(X(viewBox.x0), Y(viewBox.y0), (viewBox.x1 - viewBox.x0) * k, (viewBox.y1 - viewBox.y0) * k);
  }

  /** World coordinates for a CSS-pixel position (used by the minimap/preview interactions). */
  worldAt(xCss: number, yCss: number): Vec | null {
    const v = this.lastView;
    if (!v) return null;
    return { x: (xCss * this.dpr - v.tx) / v.s, y: (yCss * this.dpr - v.ty) / v.s };
  }
}

/* ----------------------------------------------------------- utilities */

function computeCourseBox(map: MapDef): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const add = (b: Box) => {
    x0 = Math.min(x0, b.x0);
    y0 = Math.min(y0, b.y0);
    x1 = Math.max(x1, b.x1);
    y1 = Math.max(y1, b.y1);
  };
  for (const w of map.walls) add(shapeBox(w.shape));
  for (const p of map.path) add({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  for (const p of map.start.area) add({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
  add({ x0: map.finish.a.x, y0: map.finish.a.y, x1: map.finish.b.x, y1: map.finish.b.y });
  if (!isFinite(x0)) return { x0: map.bounds.minX, y0: map.bounds.minY, x1: map.bounds.maxX, y1: map.bounds.maxY };
  return { x0, y0, x1, y1 };
}

function localShapeExtent(sh: LocalShape): number {
  if (sh.type === 'box') return Math.hypot(sh.cx, sh.cy) + Math.hypot(sh.hw, sh.hh);
  if (sh.type === 'circle') return Math.hypot(sh.cx, sh.cy) + sh.r;
  let m = 0;
  for (const p of sh.points) m = Math.max(m, Math.hypot(p.x, p.y));
  return m;
}

function pathLine(ctx: CanvasRenderingContext2D, pts: Vec[]): void {
  ctx.beginPath();
  if (!pts.length) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}

function pathPoly(ctx: CanvasRenderingContext2D, pts: Vec[]): void {
  pathLine(ctx, pts);
  ctx.closePath();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** Vector glyph for a zone effect, centred at (x,y) with size `r`. */
export function drawGlyph(ctx: CanvasRenderingContext2D, effect: EffectType, x: number, y: number, r: number, color: string): void {
  ctx.save();
  ctx.fillStyle = color;
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  switch (effect) {
    case 'grow':
      ctx.fillRect(x - r, y - r * 0.2, r * 2, r * 0.4);
      ctx.fillRect(x - r * 0.2, y - r, r * 0.4, r * 2);
      break;
    case 'shrink':
      ctx.fillRect(x - r, y - r * 0.2, r * 2, r * 0.4);
      break;
    case 'destroy':
      drawSkull(ctx, x, y, r * 0.95, color, 'rgba(20,0,0,0.85)');
      break;
    case 'attract': {
      ctx.lineWidth = r * 0.42;
      ctx.beginPath();
      ctx.arc(x, y + r * 0.15, r * 0.7, Math.PI, 0);
      ctx.lineTo(x + r * 0.7, y + r * 0.75);
      ctx.moveTo(x - r * 0.7, y + r * 0.15);
      ctx.lineTo(x - r * 0.7, y + r * 0.75);
      ctx.stroke();
      break;
    }
    case 'repel': {
      ctx.lineWidth = r * 0.22;
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 2 + Math.PI / 4;
        const c = Math.cos(a);
        const s = Math.sin(a);
        ctx.beginPath();
        ctx.moveTo(x + c * r * 0.25, y + s * r * 0.25);
        ctx.lineTo(x + c * r, y + s * r);
        ctx.moveTo(x + c * r * 0.62 - s * r * 0.3, y + s * r * 0.62 + c * r * 0.3);
        ctx.lineTo(x + c * r, y + s * r);
        ctx.lineTo(x + c * r * 0.62 + s * r * 0.3, y + s * r * 0.62 - c * r * 0.3);
        ctx.stroke();
      }
      break;
    }
  }
  ctx.restore();
}
