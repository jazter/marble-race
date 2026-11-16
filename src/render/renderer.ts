/**
 * Canvas 2D renderer for the marble race: course, mechanisms, marbles,
 * particles and minimap. Pure presentation — never feeds back into the sim.
 */
import { stunnerOn } from '../core/stun';
import { TextCache } from './textCache';
import type { BackgroundKind, EffectType, GameConfig, WallReaction } from '../core/config';
import { BackgroundPainter, scenePalette, type ScenePalette, type SceneKind } from './backgrounds';
import type { LocalShape, MapDef, MarbleProfile, Monster, StaticShape, Vec, Wall } from '../core/types';
import type { CameraState, MarbleState, MechanismPose, MonsterState, SimEvent, Simulation, SwitchState } from '../sim/api';
import { alpha, darken, lighten, mix } from './color';
import { ParticleSystem, drawSkull } from './particles';
import { MONSTER_COLORS, drawMonster, drawMonsterHint, monsterBounds, restState, type EnvMarble, type MonsterEnv } from './monsters';
import { mechanismPoseAt } from './poses';
import { clearSkinCache, drawMarbleSprite, skinColor } from './skins';

export const EFFECT_COLORS: Record<EffectType, string> = {
  grow: '#3ddc84',
  shrink: '#a463ff',
  destroy: '#ff4747',
  attract: '#4aa3ff',
  repel: '#ff8a2a',
  stun: '#b57cff',
};
const STEEL = '#8d98a8';
/** Fraction of the visible view the race camera is shifted back (uphill) from its target. */
const CAMERA_BACK = 0.15;
const CAMERA_BACK_LANDSCAPE = 0.08;
/** Colour of a stunner while it is switched off. */
const STUN_OFF = '#5f5873';
const FX_COLORS: Record<string, string> = {
  ...EFFECT_COLORS,
  bounce: '#38e07b',
  launch: '#38d6ff',
  slow: '#f2b134',
  kill: '#ff4a1a',
  stun: '#c58cff',
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
interface MonsterItem extends Item {
  def: Monster;
  rest: MonsterState;
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
  private texts = new TextCache();
  private qualityScale = 1;
  private W = 1;
  private H = 1;

  private map: MapDef | null = null;
  private config: GameConfig;
  private walls: WallItem[] = [];
  private gates: GateItem[] = [];
  private reach: number[] = [];
  private poses0: MechanismPose[] = [];
  private monsters: MonsterItem[] = [];
  private bubbleAcc = 0;
  private courseBox: Box = { x0: 0, y0: 0, x1: 1, y1: 1 };
  private gateAlpha = new Map<string, number>();
  private fxLast = new Map<string, number>();
  /** Flipper cosmetics: was it swinging up last frame + recent angles for the motion trail. */
  private flipFx = new Map<string, { active: boolean; trail: number[] }>();
  private particles = new ParticleSystem();
  private clock = 0;
  /** Time used for the stunners' on/off cycle: sim time in a race, wall clock in the preview. */
  private stunClock = 0;
  private bgKind: BackgroundKind;
  private bgPainter = new BackgroundPainter();

  /** Name tags above the top-3 marbles. */
  nameTags = true;
  /** Custom (spectator-given) name of a marble, or null. Named marbles always get a tag + ring. */
  customName: (p: MarbleProfile) => string | null = () => null;
  private liveView: View | null = null;
  /**
   * Staging ("Elige tu canica"): frame the start box instead of the sim camera,
   * leaving `stagingInsetRight` CSS px free on the right for the staging panel.
   * Purely visual — the sim is not stepped while staging.
   */
  staging = false;
  stagingInsetRight = 0;
  private stagingT = 0; // 1 = staging framing, 0 = sim camera (blends after the countdown starts)

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
    this.bgKind = config.display?.background ?? 'auto';
    this.resize();
  }

  setConfig(config: GameConfig): void {
    this.config = config;
  }

  /** Scenic backdrop; read from the live UI config (not the race snapshot) so it switches instantly. */
  setBackground(kind: BackgroundKind): void {
    this.bgKind = kind;
  }

  private scene(): ScenePalette | null {
    return scenePalette(this.bgKind);
  }

  /* ------------------------------------------------------------ setup */

  /**
   * Render resolution as a fraction of the device pixel ratio (1 = sharpest). Lowered by the
   * game loop on devices that can't keep up, so the race stays smooth instead of stuttering.
   */
  get quality(): number {
    return this.qualityScale;
  }

  /** Lighter visuals (fewer passes / particles) once the resolution had to be lowered. */
  private get lite(): boolean {
    return this.qualityScale < 1;
  }

  setQuality(q: number): void {
    const v = Math.max(0.4, Math.min(1, q));
    if (v === this.qualityScale) return;
    this.qualityScale = v;
    this.particles.density = v < 1 ? 0.5 : 1;
    this.resize();
  }

  resize(): void {
    // DPR capped at 2: on 3x phones the extra pixels cost a lot and are barely visible here
    this.dpr = Math.max(0.75, Math.min(window.devicePixelRatio || 1, 2) * this.qualityScale);
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
    this.texts.clear();
  }

  setMap(map: MapDef): void {
    this.map = map;
    this.walls = map.walls.map((wall) => ({ wall, box: shapeBox(wall.shape) }));
    this.gates = map.gates.map((g) => ({ id: g.id, shape: g.shape, box: shapeBox(g.shape), center: shapeCenter(g.shape) }));
    this.poses0 = map.mechanisms.map((m) => mechanismPoseAt(m, 0));
    this.monsters = (map.monsters ?? []).map((def) => ({ def, box: monsterBounds(def), rest: restState(def) }));
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
    this.flipFx.clear();
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
    this.stunClock = this.clock;
    this.drawScene(view, this.poses0, new Set(), new Map(), placeholders.map((m) => ({ ...m, angle: 0, status: 'waiting' as const, offscreenTime: 0, progress: 0, id: m.profile.id })), null, null);
    this.drawMinimap(placeholders, view.box, false, undefined, null);
  }

  /* ------------------------------------------------------------- live */

  /** Draw one frame of a live race. `events` = what `sim.drainEvents()` returned this frame. */
  render(sim: Simulation, dt: number, events: readonly SimEvent[] = []): void {
    if (this.map !== sim.map) this.setMap(sim.map);
    this.clock = performance.now() / 1000;
    this.stunClock = sim.time;
    const cam = sim.getCamera();
    const camView = this.cameraView(cam);
    this.stagingT = this.staging ? 1 : Math.max(0, this.stagingT - dt / 0.8);
    const view = this.stagingT > 0 ? this.blendViews(this.stagingView(camView), camView, this.stagingT) : camView;
    this.liveView = view;
    const marbles = sim.getMarbles();
    const monsterStates = this.monsters.length ? sim.getMonsterStates() : [];
    this.handleEvents(events, marbles);
    this.spawnMonsterAmbient(monsterStates, dt);
    this.particles.update(dt);

    const open = new Set(sim.getOpenGates());
    const sw = new Map<string, SwitchState>();
    for (const st of sim.getSwitchStates()) sw.set(st.id, st);
    for (const g of this.gates) {
      const a = this.gateAlpha.get(g.id) ?? 1;
      const target = open.has(g.id) ? 0 : 1;
      this.gateAlpha.set(g.id, a + (target - a) * Math.min(1, dt * 6 + (open.has(g.id) ? 0.0 : 1)));
    }
    this.drawScene(view, sim.getMechanismPoses(), open, sw, marbles, cam, monsterStates);
    this.drawMinimap(marbles, view.box, true, cam, monsterStates);
  }

  /* ---------------------------------------------------------- helpers */

  private cameraView(cam: CameraState): View {
    const s = Math.min(this.W / cam.width, this.H / cam.height);
    // Show more of the course behind the leader: the view sits CAMERA_BACK of its extent further
    // "uphill" (against the course flow), so the marbles coming behind stay in sight.
    const f = this.map?.flowDir ?? { x: 0, y: 1 };
    const fl = Math.hypot(f.x, f.y) || 1;
    const fx = f.x / fl;
    const fy = f.y / fl;
    // (landscape screens are short and the control bar covers their bottom: shift less there)
    const frac = this.H >= this.W ? CAMERA_BACK : CAMERA_BACK_LANDSCAPE;
    const back = frac * (Math.abs(fx) * (this.W / s) + Math.abs(fy) * (this.H / s));
    return this.makeView(s, cam.x - fx * back, cam.y - fy * back);
  }

  /** Fit the start box (area + spawn points) into the canvas minus the staging panel. */
  private stagingView(camView: View): View {
    const map = this.map;
    if (!map) return camView;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of [...map.start.area, ...map.start.spawnPoints]) {
      x0 = Math.min(x0, p.x);
      y0 = Math.min(y0, p.y);
      x1 = Math.max(x1, p.x);
      y1 = Math.max(y1, p.y);
    }
    if (!Number.isFinite(x0)) return camView;
    const pad = 1.5;
    const availW = Math.max(this.W * 0.45, this.W - this.stagingInsetRight * this.dpr);
    let sc = Math.min((availW * 0.9) / (x1 - x0 + 2 * pad), (this.H * 0.7) / (y1 - y0 + 2 * pad));
    sc = Math.min(Math.max(sc, camView.s * 0.5), camView.s * 2.5);
    const tx = availW / 2 - ((x0 + x1) / 2) * sc;
    const ty = this.H / 2 - ((y0 + y1) / 2) * sc;
    return { s: sc, tx, ty, box: { x0: -tx / sc, y0: -ty / sc, x1: (this.W - tx) / sc, y1: (this.H - ty) / sc } };
  }

  /** t = 1 -> a, t = 0 -> b (eased). */
  private blendViews(a: View, b: View, t: number): View {
    const e = t * t * (3 - 2 * t);
    const sc = b.s + (a.s - b.s) * e;
    const tx = b.tx + (a.tx - b.tx) * e;
    const ty = b.ty + (a.ty - b.ty) * e;
    return { s: sc, tx, ty, box: { x0: -tx / sc, y0: -ty / sc, x1: (this.W - tx) / sc, y1: (this.H - ty) / sc } };
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
          if (e.reason === 'monster') break; // the monster 'devour' event already plays its own effect
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
        case 'monster': {
          const m = find(e.marbleId);
          const col = m ? skinColor(m.profile.skin) : '#ffffff';
          if (e.action === 'grab') {
            this.particles.text(e.x, e.y - 1.1, '!', '#ffe14a', 1.3, 0.8);
            this.particles.dust(e.x, e.y, 'rgba(210,200,230,0.8)', 8, 1.2);
            this.particles.ring(e.x, e.y, '#ffe14a', 1.1, 0.35);
          } else if (e.action === 'devour') {
            this.particles.burst(e.x, e.y, col, 30, 10);
            if (m) for (const c of m.profile.skin.colors.slice(0, 3)) this.particles.burst(e.x, e.y, c, 10, 8);
            this.particles.burst(e.x, e.y, '#ffffff', 8, 7);
            this.particles.ring(e.x, e.y, col, 1.8, 0.5);
            this.particles.text(e.x, e.y - 1.2, 'ÑAM', '#ff8a3d', 1.15, 1.1);
          } else {
            this.particles.dust(e.x, e.y, 'rgba(235,240,250,0.85)', 14, 1.6);
            this.particles.ring(e.x, e.y, '#d8e6ff', 1.2, 0.4);
            this.particles.text(e.x, e.y - 1.0, '¡Uf!', '#9be7ff', 0.8, 0.8);
          }
          break;
        }
        default:
          break;
      }
    }
  }

  /** Ambient monster particles (fish bubbles). Cosmetic only. */
  private spawnMonsterAmbient(states: readonly MonsterState[], dt: number): void {
    if (dt <= 0) return;
    this.bubbleAcc += dt * 6;
    if (this.bubbleAcc < 1) return;
    this.bubbleAcc = 0;
    for (const st of states) {
      if (st.kind !== 'fish' || st.phase === 'hidden' || st.visible < 0.4) continue;
      const def = this.monsters.find((m) => m.def.id === st.id)?.def;
      const size = def?.size ?? 0.8;
      const bx = st.x - Math.cos(st.angle) * size * 0.2;
      const by = st.y - Math.sin(st.angle) * size * 0.2 - size * 0.3;
      this.particles.bubble(bx + (Math.random() - 0.5) * 0.3, by, 0.06 + Math.random() * 0.1);
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
    monsterStates: readonly MonsterState[] | null,
  ): void {
    const map = this.map!;
    const ctx = this.ctx;
    const { s, tx, ty, box } = view;
    this.lastView = view;
    this.labels.length = 0;
    const t = this.clock;

    // background + parallax dots
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const scene = this.scene();
    if (scene) {
      this.bgPainter.draw(ctx, this.bgKind as SceneKind, this.W, this.H, this.dpr, (this.W / 2 - tx) / s, (this.H / 2 - ty) / s, t, this.lite);
    } else {
      ctx.fillStyle = map.theme.background;
      ctx.fillRect(0, 0, this.W, this.H);
      if (!this.lite) this.drawBackdrop(view);
    }

    ctx.setTransform(s, 0, 0, s, tx, ty);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';

    // start area outline
    ctx.strokeStyle = alpha((scene ?? map.theme).accent, 0.35);
    ctx.lineWidth = 0.12;
    ctx.setLineDash([0.5, 0.4]);
    pathPoly(ctx, map.start.area);
    ctx.stroke();
    ctx.setLineDash([]);

    // zones
    for (const z of map.zones) this.drawZone(z.shape, z.effect, t, z.effect !== 'stun' || this.stunOn(z.id));

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
      this.drawGate(g.shape, a, (scene ?? map.theme).accent);
    }

    // mechanisms
    map.mechanisms.forEach((m, i) => {
      const p = poses[i];
      if (!p) return;
      const r = this.reach[i];
      const pv = p.links[0];
      if (pv.x + r < box.x0 || pv.x - r > box.x1 || pv.y + r < box.y0 || pv.y - r > box.y1) return;
      const col = m.effect === 'stun' && !this.stunOn(m.id) ? STUN_OFF : m.effect ? EFFECT_COLORS[m.effect] : STEEL;
      m.links.forEach((link, li) => {
        const lp = p.links[li];
        if (!lp) return;
        if (link.motion.type === 'flipper') this.drawFlipper(m.id + '#' + li, link.shapes, lp);
        else this.drawLink(link.shapes, lp.x, lp.y, lp.angle, col, m.effect === 'destroy');
      });
      if (m.kind !== 'flipper') for (const lp of p.links) this.drawBolt(lp.x, lp.y);
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

    // monsters (above walls and the marbles they hold)
    ctx.setTransform(s, 0, 0, s, tx, ty);
    if (this.monsters.length) this.drawMonsters(box, marbles as readonly EnvMarble[], monsterStates);

    // particles
    this.particles.draw(ctx, box, s);

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
    if (cam) this.drawNameTags(view, marbles as readonly MarbleState[]);
  }

  private drawMonsters(box: Box, marbles: readonly EnvMarble[], states: readonly MonsterState[] | null): void {
    const ctx = this.ctx;
    const env: MonsterEnv = {
      clock: this.clock,
      preview: states === null,
      marbles,
      redraw: (m) => {
        const v = this.lastView;
        const ms = m as unknown as MarbleState;
        if (!v || !ms.profile) return;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        drawMarbleSprite(ctx, ms.profile.skin, m.x * v.s + v.tx, m.y * v.s + v.ty, m.radius * v.s, ms.angle);
        ctx.restore();
      },
    };
    if (states === null) {
      // map preview: monsters at rest + dotted path hints
      for (const m of this.monsters) {
        if (!intersects(m.box, box)) continue;
        drawMonsterHint(ctx, m.def);
        ctx.save();
        if (m.def.kind === 'fish' || m.def.kind === 'snake') ctx.globalAlpha = 0.6;
        drawMonster(ctx, m.def, m.rest, env);
        ctx.restore();
      }
      return;
    }
    for (let i = 0; i < states.length; i++) {
      const st = states[i];
      const item = this.monsters[i]?.def.id === st.id ? this.monsters[i] : this.monsters.find((m) => m.def.id === st.id);
      if (!item || !intersects(item.box, box)) continue;
      ctx.save();
      drawMonster(ctx, item.def, st, env);
      ctx.restore();
    }
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
    return w.boundary && this.config.walls.boundary !== 'mixed' ? this.config.walls.boundary : w.reaction;
  }

  private drawWall(w: Wall, t: number): void {
    const ctx = this.ctx;
    const scene = this.scene();
    const theme = scene ?? this.map!.theme;
    const re = this.reactionOf(w);
    const stunOn = re !== 'stun' || this.stunOn(w.id);
    let fill = theme.wall;
    let edge = scene ? scene.wallEdge : darken(theme.wall, 0.55);
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
      case 'stun': {
        if (!stunOn) {
          // switched off: dull grey-violet, no glow, no sparks
          fill = STUN_OFF;
          edge = '#2a2438';
          break;
        }
        // electric: violet with a crackling yellow flicker
        const k = 0.5 + 0.5 * Math.sin(t * 9 + w.id.length * 1.7);
        fill = mix('#a86bff', '#ffe066', k * 0.35);
        edge = '#3b1a73';
        glow = '#c58cff';
        break;
      }
    }
    const sh = w.shape;
    const style = w.style ?? 'wall';
    const glowA = re === 'kill' ? 0.22 + 0.15 * Math.sin(t * 5) : 0.2;
    const lite = this.lite;
    if (lite && re !== 'kill' && re !== 'stun') glow = null; // colour alone tells the reaction
    if (sh.type === 'polyline') {
      pathLine(ctx, sh.points);
      if (scene && !lite) {
        ctx.strokeStyle = scene.wallShadow;
        ctx.lineWidth = sh.thickness + 0.5;
        ctx.stroke();
      }
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
      if (!lite) {
        ctx.strokeStyle = re === 'solid' ? alpha('#ffffff', 0.12) : alpha(lighten(fill, 0.5), 0.45);
        ctx.lineWidth = Math.max(0.06, sh.thickness * 0.28);
        ctx.stroke();
      }
      if (re === 'kill') this.drawLavaSpikes(sh.points, sh.thickness, t);
      if (re === 'stun' && stunOn && !lite) this.drawSparks(sh.points, t, w.id.length);
    } else if (sh.type === 'polygon') {
      pathPoly(ctx, sh.points);
      if (scene && !lite) {
        ctx.strokeStyle = scene.wallShadow;
        ctx.lineWidth = 0.5;
        ctx.stroke();
      }
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
      if (scene && !lite) {
        ctx.fillStyle = scene.wallShadow;
        ctx.beginPath();
        ctx.arc(c.x, c.y, r + 0.25, 0, Math.PI * 2);
        ctx.fill();
      }
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
      if (!lite) {
        ctx.fillStyle = alpha('#ffffff', 0.35);
        ctx.beginPath();
        ctx.arc(c.x - r * 0.3, c.y - r * 0.3, r * 0.22, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    if (re === 'launch' && w.launchDir) this.drawChevrons(sh, w.launchDir, t);
    if (re === 'stun' && sh.type === 'circle') this.drawStunBolt(sh.center.x, sh.center.y, sh.radius * 0.75, stunOn);
  }

  private stunOn(id: string): boolean {
    return stunnerOn(id, this.stunClock);
  }

  /** Zig-zag electric arcs crackling along a 'stun' wall (cosmetic). */
  private drawSparks(points: Vec[], t: number, seed: number): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const l = Math.hypot(b.x - a.x, b.y - a.y);
      if (l < 0.3) continue;
      const ux = (b.x - a.x) / l;
      const uy = (b.y - a.y) / l;
      const n = Math.max(3, Math.floor(l / 0.35));
      const ph = Math.floor(t * 14) + seed * 7 + i * 3; // re-roll the zigzag ~14 times/s
      ctx.strokeStyle = 'rgba(255,240,150,0.9)';
      ctx.lineWidth = 0.06;
      ctx.beginPath();
      for (let k = 0; k <= n; k++) {
        const f = k / n;
        const off = k === 0 || k === n ? 0 : (((Math.sin((ph + k) * 12.9898) * 43758.5453) % 1) - 0.5) * 0.28;
        const x = a.x + ux * l * f - uy * off;
        const y = a.y + uy * l * f + ux * off;
        if (k === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
    }
    ctx.restore();
  }

  /** Lightning-bolt glyph (stun nubs). */
  private drawStunBolt(cx: number, cy: number, r: number, on = true): void {
    const ctx = this.ctx;
    ctx.fillStyle = on ? '#fff3a0' : '#8f8aa0';
    ctx.strokeStyle = '#3b1a73';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.moveTo(cx + r * 0.15, cy - r);
    ctx.lineTo(cx - r * 0.45, cy + r * 0.1);
    ctx.lineTo(cx - r * 0.02, cy + r * 0.1);
    ctx.lineTo(cx - r * 0.2, cy + r);
    ctx.lineTo(cx + r * 0.45, cy - r * 0.15);
    ctx.lineTo(cx + r * 0.02, cy - r * 0.15);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
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

  private flipperPath(shapes: LocalShape[]): void {
    const ctx = this.ctx;
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
      } else if (sh.points.length) {
        // consistent winding, so overlapping shapes union under the nonzero rule
        let area = 0;
        const n = sh.points.length;
        for (let i = 0; i < n; i++) {
          const a = sh.points[i];
          const b = sh.points[(i + 1) % n];
          area += a.x * b.y - b.x * a.y;
        }
        const pts = area < 0 ? sh.points.slice().reverse() : sh.points;
        ctx.moveTo(pts[0].x, pts[0].y);
        for (let i = 1; i < n; i++) ctx.lineTo(pts[i].x, pts[i].y);
        ctx.closePath();
      }
    }
  }

  /**
   * Pinball flipper: glossy red body with a white highlight and dark outline, chrome pivot
   * cap; brightens + leaves a short trail and a "thwack" burst while swinging up.
   */
  private drawFlipper(key: string, shapes: LocalShape[], lp: MechanismPose['links'][number]): void {
    const ctx = this.ctx;
    let fx = this.flipFx.get(key);
    if (!fx) this.flipFx.set(key, (fx = { active: false, trail: [] }));
    const active = !!lp.active;
    // local tip = farthest shape point from the pivot (for particles)
    let tx = 0;
    let ty = 0;
    let best = -1;
    let pivotR = 0.3;
    for (const sh of shapes) {
      const pts = sh.type === 'polygon' ? sh.points : sh.type === 'circle' ? [{ x: sh.cx + sh.r, y: sh.cy }] : [{ x: sh.cx + sh.hw, y: sh.cy }];
      for (const q of pts) {
        const d = Math.hypot(q.x, q.y);
        if (d > best) ((best = d), (tx = q.x), (ty = q.y));
      }
      if (sh.type === 'circle' && Math.hypot(sh.cx, sh.cy) < 0.05) pivotR = Math.max(pivotR, sh.r);
    }
    if (active && !fx.active) {
      const c = Math.cos(lp.angle);
      const sn = Math.sin(lp.angle);
      const wx = lp.x + tx * c - ty * sn;
      const wy = lp.y + tx * sn + ty * c;
      this.particles.burst(wx, wy, '#ffffff', 8, 6);
      this.particles.burst(wx, wy, '#ff5a4a', 8, 5);
      this.particles.ring(wx, wy, '#ffd9d2', 1.1, 0.3);
    }
    fx.active = active;
    // trail of the last few angles while moving
    const last = fx.trail[fx.trail.length - 1];
    if (last === undefined || Math.abs(lp.angle - last) > 0.03) {
      fx.trail.push(lp.angle);
      if (fx.trail.length > 5) fx.trail.shift();
    } else if (fx.trail.length > 1) fx.trail.shift();
    ctx.save();
    ctx.translate(lp.x, lp.y);
    if (fx.trail.length > 1) {
      for (let i = 0; i < fx.trail.length - 1; i++) {
        ctx.save();
        ctx.rotate(fx.trail[i]);
        this.flipperPath(shapes);
        ctx.fillStyle = `rgba(255,120,100,${0.06 + 0.07 * i})`;
        ctx.fill();
        ctx.restore();
      }
    }
    ctx.rotate(lp.angle);
    this.flipperPath(shapes);
    const body = active ? '#ff6f5e' : '#d8323a';
    ctx.lineJoin = 'round';
    ctx.strokeStyle = '#2a0a10';
    ctx.lineWidth = 0.17;
    ctx.stroke();
    const g = ctx.createLinearGradient(0, -pivotR * 1.1, 0, pivotR * 1.1);
    g.addColorStop(0, lighten(body, 0.45));
    g.addColorStop(0.45, body);
    g.addColorStop(1, darken(body, 0.45));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = active ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 0.07;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pivotR * 0.9, -pivotR * 0.45);
    ctx.lineTo(tx * 0.92, ty - 0.02 - pivotR * 0.1);
    ctx.stroke();
    ctx.restore();
    // chrome pivot cap
    const cap = ctx.createRadialGradient(-0.06, -0.06, 0.02, 0, 0, 0.26);
    cap.addColorStop(0, '#ffffff');
    cap.addColorStop(0.6, '#b9c2d0');
    cap.addColorStop(1, '#6b7587');
    ctx.fillStyle = cap;
    ctx.strokeStyle = '#2a0a10';
    ctx.lineWidth = 0.06;
    ctx.beginPath();
    ctx.arc(0, 0, 0.26, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#4a5366';
    ctx.beginPath();
    ctx.arc(0, 0, 0.08, 0, Math.PI * 2);
    ctx.fill();
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

  private drawZone(sh: { type: 'circle'; center: Vec; radius: number } | { type: 'polygon'; points: Vec[] }, effect: EffectType, t: number, on = true): void {
    if (effect === 'stun' && sh.type === 'circle') {
      this.drawTesla(sh.center, sh.radius, t, on);
      return;
    }
    const ctx = this.ctx;
    const col = effect === 'stun' && !on ? STUN_OFF : EFFECT_COLORS[effect];
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

  /** Tesla coil: a metal electrode orb with crackling arcs filling its (dazing) field. */
  private drawTesla(c: Vec, r: number, t: number, on = true): void {
    const ctx = this.ctx;
    const col = on ? EFFECT_COLORS.stun : STUN_OFF;
    const pulse = on ? 0.5 + 0.5 * Math.sin(t * 6) : 0;
    ctx.save();
    // field (barely visible while the coil is switched off)
    if (this.lite) ctx.fillStyle = alpha(col, on ? 0.18 : 0.06);
    else {
      const g = ctx.createRadialGradient(c.x, c.y, r * 0.1, c.x, c.y, r);
      g.addColorStop(0, alpha(col, on ? 0.32 + 0.1 * pulse : 0.12));
      g.addColorStop(1, alpha(col, on ? 0.05 : 0.02));
      ctx.fillStyle = g;
    }
    ctx.beginPath();
    ctx.arc(c.x, c.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = alpha(col, on ? 0.7 : 0.4);
    ctx.lineWidth = 0.07;
    ctx.setLineDash([0.25, 0.2]);
    ctx.lineDashOffset = on ? -t * 1.2 : 0;
    ctx.stroke();
    ctx.setLineDash([]);
    // arcs: re-rolled ~12 times per second (none while off)
    const roll = Math.floor(t * 12) + Math.floor(c.x * 13 + c.y * 7);
    const rnd = (k: number): number => {
      const v = Math.sin((roll + k) * 12.9898 + k * 78.233) * 43758.5453;
      return v - Math.floor(v);
    };
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let a = 0; a < (on ? 5 : 0); a++) {
      const ang = rnd(a * 17) * Math.PI * 2;
      const len = r * (0.65 + 0.35 * rnd(a * 17 + 1));
      const steps = 6;
      ctx.strokeStyle = a % 2 === 0 ? 'rgba(255,240,160,0.95)' : alpha(lighten(col, 0.4), 0.9);
      ctx.lineWidth = a % 2 === 0 ? 0.06 : 0.04;
      ctx.beginPath();
      ctx.moveTo(c.x, c.y);
      for (let k = 1; k <= steps; k++) {
        const f = k / steps;
        const jit = k === steps ? 0 : (rnd(a * 17 + k * 3) - 0.5) * r * 0.35;
        const px = c.x + Math.cos(ang) * len * f - Math.sin(ang) * jit;
        const py = c.y + Math.sin(ang) * len * f + Math.cos(ang) * jit;
        ctx.lineTo(px, py);
      }
      ctx.stroke();
    }
    // electrode orb
    const er = Math.min(0.5, r * 0.32);
    const og = ctx.createRadialGradient(c.x - er * 0.35, c.y - er * 0.35, er * 0.1, c.x, c.y, er);
    og.addColorStop(0, '#f4f0ff');
    og.addColorStop(0.45, '#9aa3b8');
    og.addColorStop(1, '#3a3f52');
    ctx.fillStyle = alpha(col, 0.35 + 0.25 * pulse);
    ctx.beginPath();
    ctx.arc(c.x, c.y, er * 1.6, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = og;
    ctx.strokeStyle = '#2a1a4a';
    ctx.lineWidth = 0.05;
    ctx.beginPath();
    ctx.arc(c.x, c.y, er, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
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
      if (m.stunned && m.stunned > 0) this.drawDizzy(sx, sy, rPx, m.stunned);
    }
  }

  /** Dazed marble: a violet haze and little stars circling above it. */
  private drawDizzy(sx: number, sy: number, rPx: number, left: number): void {
    const ctx = this.ctx;
    const fade = Math.min(1, left / 0.3);
    ctx.save();
    ctx.globalAlpha = 0.35 * fade;
    ctx.fillStyle = '#b07cff';
    ctx.beginPath();
    ctx.arc(sx, sy, rPx * 1.05, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = fade;
    const n = 3;
    const ry = rPx * 0.35;
    const rx = rPx * 1.0;
    const cy = sy - rPx * 1.15;
    const spin = this.clock * 5;
    for (let i = 0; i < n; i++) {
      const a = spin + (i / n) * Math.PI * 2;
      const x = sx + Math.cos(a) * rx;
      const y = cy + Math.sin(a) * ry;
      const sz = Math.max(3 * this.dpr, rPx * 0.36) * (0.75 + 0.25 * Math.sin(a));
      ctx.fillStyle = '#ffe066';
      ctx.strokeStyle = '#6b3fb3';
      ctx.lineWidth = Math.max(1, this.dpr * 0.8);
      ctx.beginPath();
      for (let k = 0; k < 10; k++) {
        const rr = k % 2 === 0 ? sz : sz * 0.45;
        const aa = -Math.PI / 2 + (k * Math.PI) / 5;
        const px = x + Math.cos(aa) * rr;
        const py = y + Math.sin(aa) * rr;
        if (k === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
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
    for (const l of this.labels) {
      const px = Math.round(Math.max(9 * this.dpr, Math.min(l.size * this.dpr, l.size * this.dpr * (view.s / (28 * this.dpr)) + 6 * this.dpr)));
      const x = l.x * view.s + view.tx;
      const y = l.y * view.s + view.ty;
      if (x < -100 || y < -30 || x > this.W + 100 || y > this.H + 30) continue;
      this.texts.draw(ctx, l.text, x, y, {
        font: FONT.replace('600', l.bold ? '800' : '600').replace('12px', `${px}px`),
        px,
        fill: l.color,
        stroke: 'rgba(8,10,16,0.85)',
        lineWidth: Math.round(3 * this.dpr),
        baseline: 'middle',
      });
    }
  }

  /** Nearest non-eliminated marble under a CSS-pixel point of the canvas (live race / staging). */
  hitTest(marbles: readonly MarbleState[], xCss: number, yCss: number, touch = false): MarbleState | null {
    const view = this.liveView;
    if (!view) return null;
    const wx = (xCss * this.dpr - view.tx) / view.s;
    const wy = (yCss * this.dpr - view.ty) / view.s;
    const minWorld = ((touch ? 26 : 12) * this.dpr) / view.s; // generous minimum target
    let best: MarbleState | null = null;
    let bestD = Infinity;
    for (const m of marbles) {
      if (m.status === 'eliminated') continue;
      const reach = Math.max(m.radius * 1.6, minWorld);
      const d = Math.hypot(m.x - wx, m.y - wy);
      if (d <= reach && d / reach < bestD) {
        best = m;
        bestD = d / reach;
      }
    }
    return best;
  }

  private drawNameTags(view: View, marbles: readonly MarbleState[]): void {
    const ctx = this.ctx;
    const dpr = this.dpr;
    const live = marbles.filter((m) => m.status === 'racing' || m.status === 'finished' || m.status === 'waiting');
    const rankOf = (m: MarbleState) => (m.status === 'finished' ? m.rank ?? 99 : 1000 - m.progress);
    live.sort((a, b) => {
      const fa = a.status === 'finished' ? 0 : 1;
      const fb = b.status === 'finished' ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return rankOf(a) - rankOf(b);
    });
    const topIds = new Set<number>();
    if (this.nameTags && live.some((m) => m.status !== 'waiting')) {
      for (const m of live.slice(0, 3)) topIds.add(m.id);
    }
    const fontPx = Math.round(11 * dpr);
    const font = FONT.replace('12px', `${fontPx}px`);
    const tagStyle = (fill: string) => ({ font, px: fontPx, fill, stroke: 'rgba(8,10,16,0.9)', lineWidth: Math.round(3 * dpr), baseline: 'alphabetic' as const });
    const placed: { x0: number; y0: number; x1: number; y1: number }[] = [];
    // highlight rings for named marbles
    for (const m of live) {
      if (!this.customName(m.profile)) continue;
      const x = m.x * view.s + view.tx;
      const y = m.y * view.s + view.ty;
      if (x < -50 || y < -50 || x > this.W + 50 || y > this.H + 50) continue;
      const r = m.radius * view.s + 4 * dpr;
      ctx.lineWidth = 3 * dpr;
      ctx.strokeStyle = 'rgba(8,10,16,0.55)';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,224,122,0.9)';
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
    }
    let rankIdx = 0;
    for (const m of live) {
      const custom = this.customName(m.profile);
      const top = topIds.has(m.id);
      const idx = top ? rankIdx++ : -1;
      if (!custom && !top) continue;
      const x = m.x * view.s + view.tx;
      let y = m.y * view.s + view.ty - m.radius * view.s - 8 * dpr;
      if (x < 0 || y < 0 || x > this.W || y > this.H) continue;
      const txt = top ? `${idx + 1}º ${custom ?? m.profile.name}` : (custom as string);
      const st = tagStyle(top ? ['#ffd54a', '#dfe5ee', '#f0a36b'][Math.min(idx, 2)] : '#ffe9a6');
      const sprite = this.texts.get(txt, st);
      if (!sprite) continue;
      const w = sprite.textW + 6 * dpr;
      const h = fontPx + 4 * dpr;
      // nudge upwards to avoid piling tags on top of each other
      for (let tries = 0; tries < 4; tries++) {
        const box = { x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y };
        if (!placed.some((p) => box.x0 < p.x1 && box.x1 > p.x0 && box.y0 < p.y1 && box.y1 > p.y0)) break;
        y -= h;
      }
      if (y < 0) continue;
      placed.push({ x0: x - w / 2, x1: x + w / 2, y0: y - h, y1: y });
      ctx.drawImage(sprite.canvas, Math.round(x - sprite.ax), Math.round(y - sprite.ay));
    }
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
    monsterStates: readonly MonsterState[] | null = null,
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
    // monsters
    if (this.monsters.length) {
      const mr = 2.6 * this.dpr;
      const marks: { kind: Monster['kind']; x: number; y: number; a: number }[] = [];
      if (live && monsterStates) {
        for (const st of monsterStates) if (st.visible > 0.15 && st.phase !== 'hidden') marks.push({ kind: st.kind, x: st.x, y: st.y, a: st.visible });
      } else {
        for (const m of this.monsters) marks.push({ kind: m.def.kind, x: m.rest.x, y: m.rest.y, a: 0.8 });
      }
      for (const mk of marks) {
        const x = X(mk.x);
        const y = Y(mk.y);
        g.globalAlpha = mk.a;
        g.fillStyle = MONSTER_COLORS[mk.kind];
        g.strokeStyle = 'rgba(8,10,16,0.9)';
        g.lineWidth = 1 * this.dpr;
        g.beginPath();
        if (mk.kind === 'spider') {
          g.moveTo(x, y - mr * 1.3);
          g.lineTo(x + mr * 1.2, y + mr);
          g.lineTo(x - mr * 1.2, y + mr);
          g.closePath();
        } else if (mk.kind === 'fish') {
          g.ellipse(x, y, mr * 1.5, mr * 0.9, 0, 0, Math.PI * 2);
        } else if (mk.kind === 'snake') {
          g.moveTo(x - mr * 1.5, y + mr * 0.5);
          g.quadraticCurveTo(x - mr * 0.5, y - mr * 1.2, x, y);
          g.quadraticCurveTo(x + mr * 0.5, y + mr * 1.2, x + mr * 1.5, y - mr * 0.5);
          g.lineWidth = 2.4 * this.dpr;
          g.strokeStyle = MONSTER_COLORS.snake;
          g.stroke();
          g.globalAlpha = 1;
          continue;
        } else {
          g.arc(x, y, mr * 1.25, 0, Math.PI * 2);
        }
        g.fill();
        g.stroke();
      }
      g.globalAlpha = 1;
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
    case 'stun':
      // lightning bolt
      ctx.beginPath();
      ctx.moveTo(x + r * 0.15, y - r);
      ctx.lineTo(x - r * 0.45, y + r * 0.1);
      ctx.lineTo(x - r * 0.02, y + r * 0.1);
      ctx.lineTo(x - r * 0.2, y + r);
      ctx.lineTo(x + r * 0.45, y - r * 0.15);
      ctx.lineTo(x + r * 0.02, y - r * 0.15);
      ctx.closePath();
      ctx.fill();
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
