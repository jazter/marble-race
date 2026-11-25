/**
 * Monster behaviour (spider, octopus, fish, snake). Monsters are scripted and
 * catch marbles geometrically; only the octopus body is a physics body (built
 * by the simulation). All randomness comes from the dedicated monster Rng
 * handed in by the simulation, drawn in a stable order.
 */
import type { Rng } from '../core/rng';
import type { Monster, MonsterOf, Vec } from '../core/types';
import type { MarbleState, MonsterPhase, MonsterState, SimEvent, TentacleState } from './api';

export interface MonsterHost {
  readonly marbles: readonly MarbleState[];
  readonly rng: Rng;
  readonly flowDir: Vec;
  readonly holdTime: number;
  readonly destroyChance: number;
  readonly speed: number;
  /** Take the marble out of the physics world; x/y/heldBy are set by the monster. */
  hold(m: MarbleState, monsterId: string): void;
  /** Put a held marble back into the world at (x, y) with the given velocity. */
  release(m: MarbleState, x: number, y: number, vx: number, vy: number): void;
  devour(m: MarbleState): void;
  emit(e: SimEvent): void;
}

const EPS = 1e-9;
/** Seconds a released marble can't be caught again by ANY monster (avoids grab loops). */
const RELEASE_IMMUNITY = 2;
/** A monster can catch the same marble at most this many times per race (breaks loops). */
const MAX_GRABS_SAME_MARBLE = 2;
interface Shared {
  now: number;
  immuneUntil: Map<number, number>;
  /** `${monsterId}|${marbleId}` -> times caught. */
  grabs: Map<string, number>;
}
const SHARED = new WeakMap<MonsterHost, Shared>();
/** Spider silk drop speed (m/s, x monsters.speed): fast enough to reach rolling marbles. */
const SPIDER_DROP_SPEED = 12;
/** Fish / snake can swerve sideways off their lane toward a nearby marble. */
const SWERVE = {
  fish: { maxDev: 1.6, speed: 5, ahead: 3.5, side: 2.6 },
  snake: { maxDev: 2.0, speed: 5.5, ahead: 4, side: 3.2 },
} as const;

abstract class Base<M extends Monster> {
  phase: MonsterPhase = 'idle';
  phaseTime = 0;
  /** Times this monster caught each marble (indexed by marble id). */
  private readonly grabCount: number[] = [];
  private sh: Shared | undefined;

  constructor(
    readonly def: M,
    protected readonly h: MonsterHost,
  ) {}

  abstract update(t: number, dt: number): void;
  abstract state(): MonsterState;

  protected setPhase(p: MonsterPhase): void {
    if (p !== this.phase) {
      this.phase = p;
      this.phaseTime = 0;
    }
  }

  protected catchable(m: MarbleState): boolean {
    if (m.status !== 'racing' || m.heldBy !== undefined || m.portal !== undefined) return false;
    if ((this.grabCount[m.id] ?? 0) >= MAX_GRABS_SAME_MARBLE) return false;
    const sh = (this.sh ??= SHARED.get(this.h));
    if (!sh) return true;
    const until = sh.immuneUntil.get(m.id);
    return until === undefined || sh.now >= until - EPS;
  }

  protected place(m: MarbleState, x: number, y: number): void {
    m.x = x;
    m.y = y;
    m.vx = 0;
    m.vy = 0;
  }

  protected grab(t: number, m: MarbleState, x: number, y: number): void {
    this.grabCount[m.id] = (this.grabCount[m.id] ?? 0) + 1;
    this.h.hold(m, this.def.id);
    m.heldBy = this.def.id;
    this.place(m, x, y);
    this.h.emit({ t, type: 'monster', action: 'grab', monsterId: this.def.id, kind: this.def.kind, marbleId: m.id, x, y });
  }

  /** Devour or release (monster Rng). Returns true when devoured. */
  protected decide(t: number, m: MarbleState, x: number, y: number, vx: number, vy: number): boolean {
    const devour = this.h.rng.next() < this.h.destroyChance;
    const base = { t, type: 'monster' as const, monsterId: this.def.id, kind: this.def.kind, marbleId: m.id, x, y };
    if (devour) {
      this.h.emit({ ...base, action: 'devour' });
      this.h.devour(m);
    } else {
      this.h.release(m, x, y, vx, vy);
      SHARED.get(this.h)?.immuneUntil.set(m.id, t + RELEASE_IMMUNITY);
      this.h.emit({ ...base, action: 'release' });
    }
    return devour;
  }

  protected baseState(x: number, y: number, angle: number, visible: number, holding: number[]): MonsterState {
    return { id: this.def.id, kind: this.def.kind, phase: this.phase, phaseTime: this.phaseTime, x, y, angle, visible, holding };
  }
}

/* ----------------------------------------------------------------- spider */

class Spider extends Base<MonsterOf<'spider'>> {
  private len: number;
  private dx: number;
  private dy: number;
  private target = -1;
  private held = -1;
  private heldAt = 0;
  private cooldown = 0;
  private sway = 0;

  constructor(def: MonsterOf<'spider'>, h: MonsterHost) {
    super(def, h);
    const l = Math.hypot(def.down.x, def.down.y) || 1;
    this.dx = def.down.x / l;
    this.dy = def.down.y / l;
    this.len = def.restLength;
  }

  private bx(): number {
    return this.def.anchor.x + this.dx * this.len;
  }
  private by(): number {
    return this.def.anchor.y + this.dy * this.len;
  }

  update(t: number, dt: number): void {
    const d = this.def;
    const S = this.h.speed;
    this.phaseTime += dt;
    this.cooldown = Math.max(0, this.cooldown - dt);
    this.sway = 0.06 * Math.sin(t * 1.6);

    if (this.phase === 'holding') {
      const m = this.h.marbles[this.held];
      if (this.len > d.restLength) this.len = Math.max(d.restLength, this.len - 3 * S * dt);
      const off = d.size + m.radius;
      const px = this.bx() + this.dx * off;
      const py = this.by() + this.dy * off;
      this.place(m, px, py);
      if (this.len <= d.restLength + EPS && t - this.heldAt >= this.h.holdTime - EPS) {
        this.decide(t, m, px, py, 0, 0);
        this.held = -1;
        this.cooldown = 2;
        this.target = -1;
        this.setPhase('returning');
      }
      return;
    }

    // catch anything touching the body (after the cooldown)
    if (this.cooldown <= 0) {
      const bx = this.bx();
      const by = this.by();
      let best: MarbleState | null = null;
      let bestD = Infinity;
      for (const m of this.h.marbles) {
        const ddx = m.x - bx;
        const ddy = m.y - by;
        const rr = d.size + m.radius;
        if (ddx > rr || ddx < -rr || ddy > rr || ddy < -rr) continue;
        if (!this.catchable(m)) continue;
        const dist = Math.hypot(ddx, ddy);
        if (dist < rr && dist < bestD) {
          best = m;
          bestD = dist;
        }
      }
      if (best) {
        this.held = best.id;
        this.heldAt = t;
        this.target = -1;
        this.setPhase('holding');
        this.grab(t, best, bx + this.dx * (d.size + best.radius), by + this.dy * (d.size + best.radius));
        return;
      }
    }

    if (this.phase === 'hunting') {
      const m = this.h.marbles[this.target];
      let ok = this.catchable(m);
      let along = 0;
      if (ok) {
        const rx = m.x - d.anchor.x;
        const ry = m.y - d.anchor.y;
        along = rx * this.dx + ry * this.dy;
        const lat = Math.abs(rx * this.dy - ry * this.dx);
        ok = lat < d.huntWidth;
      }
      if (!ok) {
        this.target = -1;
        this.setPhase('returning');
        return;
      }
      const step = SPIDER_DROP_SPEED * S * dt;
      if (along > this.len) this.len = Math.min(along, this.len + step);
      else this.len = Math.max(along, this.len - step);
      if (this.len >= d.maxLength - EPS) {
        this.len = d.maxLength;
        this.target = -1;
        this.cooldown = 1;
        this.setPhase('returning');
      }
      return;
    }

    // idle / returning: look for prey
    if (this.cooldown <= 0) {
      let best = -1;
      let bestAlong = Infinity;
      for (const m of this.h.marbles) {
        const rx = m.x - d.anchor.x;
        const ry = m.y - d.anchor.y;
        const along = rx * this.dx + ry * this.dy;
        const lat = Math.abs(rx * this.dy - ry * this.dx);
        if (lat < d.huntWidth && along >= this.len && along <= d.maxLength && along < bestAlong && this.catchable(m)) {
          best = m.id;
          bestAlong = along;
        }
      }
      if (best >= 0) {
        this.target = best;
        this.setPhase('hunting');
        return;
      }
    }
    if (this.len > d.restLength) {
      this.len = Math.max(d.restLength, this.len - 3 * S * dt);
    } else if (this.phase === 'returning') {
      this.setPhase('idle');
    }
  }

  state(): MonsterState {
    const s = this.baseState(this.bx(), this.by(), this.sway, 1, this.held >= 0 ? [this.held] : []);
    s.threadLength = this.len;
    return s;
  }
}

/* ---------------------------------------------------------------- octopus */

interface Tentacle {
  ang: number;
  state: TentacleState['state'];
  cd: number;
  cdNext: number;
  marble: number;
  heldAt: number;
  x: number;
  y: number;
}

class Octopus extends Base<MonsterOf<'octopus'>> {
  private ten: Tentacle[] = [];

  constructor(def: MonsterOf<'octopus'>, h: MonsterHost) {
    super(def, h);
    const n = Math.max(1, Math.round(def.tentacles));
    for (let i = 0; i < n; i++) {
      const ang = def.facing + (2 * Math.PI * (i + 0.5)) / n;
      const t: Tentacle = { ang, state: 'idle', cd: 0, cdNext: 0, marble: -1, heldAt: 0, x: 0, y: 0 };
      const r = this.rest(i, 0);
      t.x = r.x;
      t.y = r.y;
      this.ten.push(t);
    }
  }

  private rest(i: number, t: number): Vec {
    const d = this.def;
    const a = this.ten[i]?.ang ?? d.facing + (2 * Math.PI * (i + 0.5)) / Math.max(1, Math.round(d.tentacles));
    const r = d.bodyRadius + 0.74 * (d.reach - d.bodyRadius) + 0.15 * Math.sin(1.7 * t + i);
    const off = 0.3 * Math.sin(2.3 * t + i * 1.3);
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    return { x: d.center.x + ca * r - sa * off, y: d.center.y + sa * r + ca * off };
  }

  private moveToward(t: Tentacle, tx: number, ty: number, step: number): number {
    const dx = tx - t.x;
    const dy = ty - t.y;
    const dist = Math.hypot(dx, dy);
    if (dist <= step || dist < EPS) {
      t.x = tx;
      t.y = ty;
      return 0;
    }
    t.x += (dx / dist) * step;
    t.y += (dy / dist) * step;
    return dist - step;
  }

  update(t: number, dt: number): void {
    const d = this.def;
    const S = this.h.speed;
    this.phaseTime += dt;
    const targeted = new Set<number>();
    for (const tn of this.ten) if (tn.state === 'reach') targeted.add(tn.marble);

    for (let i = 0; i < this.ten.length; i++) {
      const tn = this.ten[i];
      const rest = this.rest(i, t);
      if (tn.state === 'idle') {
        tn.cd = Math.max(0, tn.cd - dt);
        this.moveToward(tn, rest.x, rest.y, 4 * S * dt);
        if (tn.cd <= 0) {
          let best = -1;
          let bestD = Infinity;
          for (const m of this.h.marbles) {
            if (Math.hypot(m.x - d.center.x, m.y - d.center.y) > d.reach) continue;
            if (targeted.has(m.id) || !this.catchable(m)) continue;
            const dist = Math.hypot(m.x - tn.x, m.y - tn.y);
            if (dist < bestD) {
              best = m.id;
              bestD = dist;
            }
          }
          if (best >= 0) {
            tn.state = 'reach';
            tn.marble = best;
            targeted.add(best);
          }
        }
      }
      if (tn.state === 'reach') {
        const m = this.h.marbles[tn.marble];
        if (!this.catchable(m) || Math.hypot(m.x - d.center.x, m.y - d.center.y) > d.reach) {
          tn.state = 'retract';
          tn.cdNext = 0.3;
          tn.marble = -1;
        } else {
          this.moveToward(tn, m.x, m.y, 8 * S * dt);
          if (Math.hypot(m.x - tn.x, m.y - tn.y) < d.size + m.radius) {
            tn.state = 'hold';
            tn.heldAt = t;
            this.grab(t, m, tn.x, tn.y);
          }
        }
      } else if (tn.state === 'hold') {
        const m = this.h.marbles[tn.marble];
        const hr = d.bodyRadius + 0.5;
        const ca = Math.cos(tn.ang);
        const sa = Math.sin(tn.ang);
        this.moveToward(tn, d.center.x + ca * hr, d.center.y + sa * hr, 5 * S * dt);
        this.place(m, tn.x, tn.y);
        if (t - tn.heldAt >= this.h.holdTime - EPS) {
          const f = this.h.flowDir;
          this.decide(t, m, tn.x, tn.y, f.x * 3 + ca * 1.5, f.y * 3 + sa * 1.5);
          tn.marble = -1;
          tn.state = 'retract';
          tn.cdNext = 1.5;
        }
      } else if (tn.state === 'retract') {
        if (this.moveToward(tn, rest.x, rest.y, 8 * S * dt) === 0) {
          tn.state = 'idle';
          tn.cd = tn.cdNext;
        }
      }
    }

    let holding = false;
    let reaching = false;
    for (const tn of this.ten) {
      if (tn.state === 'hold') holding = true;
      else if (tn.state === 'reach') reaching = true;
    }
    this.setPhase(holding ? 'holding' : reaching ? 'hunting' : 'idle');
  }

  state(): MonsterState {
    const d = this.def;
    const holding: number[] = [];
    const tentacles: TentacleState[] = this.ten.map((tn) => {
      const s: TentacleState = { x: tn.x, y: tn.y, state: tn.state };
      if (tn.state === 'hold' || tn.state === 'reach') s.marbleId = tn.marble;
      if (tn.state === 'hold') holding.push(tn.marble);
      return s;
    });
    const s = this.baseState(d.center.x, d.center.y, d.facing, 1, holding);
    s.tentacles = tentacles;
    return s;
  }
}

/* ------------------------------------------------- fish and snake (passes) */

type Traveller = MonsterOf<'fish'> | MonsterOf<'snake'>;

class Crosser extends Base<Traveller> {
  private waiting = true;
  private timer: number;
  private passT = 0;
  private total = 1;
  private from: Vec = { x: 0, y: 0 };
  private dir: Vec = { x: 1, y: 0 };
  private plen = 1;
  private hx = 0;
  private hy = 0;
  private vis = 0;
  private held = -1;
  private heldAt = 0;
  private caught = false;
  private ignore: number[] = [];
  /** Sideways offset of the head from the lane (perpendicular to dir, metres). */
  private off = 0;

  constructor(def: Traveller, h: MonsterHost) {
    super(def, h);
    this.timer = def.phase;
    this.phase = 'hidden';
    if (def.kind === 'fish') this.setLine(def.a, def.b);
    else if (def.passes.length) this.setLine(def.passes[0].a, def.passes[0].b);
    this.hx = this.from.x;
    this.hy = this.from.y;
  }

  private setLine(a: Vec, b: Vec): void {
    this.from = a;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    this.plen = Math.hypot(dx, dy) || 1e-6;
    this.dir = { x: dx / this.plen, y: dy / this.plen };
  }

  private speed(): number {
    return this.def.speed * this.h.speed;
  }

  private mouth(): Vec {
    // fish carries the marble slightly in front of the head
    const k = this.def.kind === 'fish' ? this.def.size * 0.8 : 0;
    return { x: this.hx + this.dir.x * k, y: this.hy + this.dir.y * k };
  }

  private startPass(): void {
    const d = this.def;
    if (d.kind === 'fish') this.setLine(d.a, d.b);
    else if (d.passes.length) {
      // random pick first (keeps the Rng sequence stable), then head for the crossing line
      // that has the most catchable marbles near it, so snakes go where the marbles are
      let pi = this.h.rng.int(0, d.passes.length - 1);
      let rev = this.h.rng.bool();
      let best = 0;
      for (let k = 0; k < d.passes.length; k++) {
        const { a, b } = d.passes[k];
        const vx = b.x - a.x;
        const vy = b.y - a.y;
        const l2 = vx * vx + vy * vy || 1;
        let score = 0;
        let nearA = 0;
        for (const m of this.h.marbles) {
          if (!this.catchable(m)) continue;
          const u = ((m.x - a.x) * vx + (m.y - a.y) * vy) / l2;
          if (u < 0 || u > 1) continue;
          const px = a.x + vx * u - m.x;
          const py = a.y + vy * u - m.y;
          if (px * px + py * py > 2.4 * 2.4) continue;
          score++;
          nearA += 1 - u;
        }
        if (score > best) {
          best = score;
          pi = k;
          // start from the end closest to where those marbles are
          rev = nearA < score / 2;
        }
      }
      const p = d.passes[pi];
      if (rev) this.setLine(p.b, p.a);
      else this.setLine(p.a, p.b);
    }
    this.waiting = false;
    this.passT = 0;
    this.total = Math.max(0.01, this.plen / Math.max(this.speed(), 1e-6));
    this.caught = false;
    this.ignore = [];
    this.hx = this.from.x;
    this.hy = this.from.y;
    this.off = 0;
    this.vis = 0;
    this.setPhase('hunting');
  }

  private finishHold(t: number): void {
    const m = this.h.marbles[this.held];
    const k = this.def.kind === 'fish' ? 0.5 : 0.4;
    // release on the lane itself (generator-guaranteed free space), not at a swerved head
    const px = -this.dir.y;
    const py = this.dir.x;
    const base = this.mouth();
    const mo = { x: base.x - px * this.off, y: base.y - py * this.off };
    const sp = this.speed() * k;
    if (this.def.kind === 'fish') this.ignore.push(m.id);
    this.decide(t, m, mo.x, mo.y, this.dir.x * sp, this.dir.y * sp);
    this.held = -1;
    if (!this.waiting) this.setPhase('hunting');
  }

  update(t: number, dt: number): void {
    const d = this.def;
    this.phaseTime += dt;
    if (this.waiting) {
      this.timer -= dt;
      if (this.timer > 0) return;
      this.startPass();
    }
    this.passT += dt;
    const dist = Math.min(this.plen, this.speed() * this.passT);
    const lx = this.from.x + this.dir.x * dist;
    const ly = this.from.y + this.dir.y * dist;
    // Swerve toward the nearest catchable marble just ahead; drift back to the
    // lane while holding (releases happen on the lane, which the generator keeps clear).
    const sw = SWERVE[d.kind];
    const px = -this.dir.y;
    const py = this.dir.x;
    let want = 0;
    if (this.held < 0 && !(d.kind === 'snake' && this.caught) && this.passT < this.total - 0.3) {
      let best = Infinity;
      for (const m of this.h.marbles) {
        const rx = m.x - lx;
        const ry = m.y - ly;
        const along = rx * this.dir.x + ry * this.dir.y;
        const side = rx * px + ry * py;
        if (along < -0.5 || along > sw.ahead || Math.abs(side - this.off) > sw.side) continue;
        if (!this.catchable(m) || this.ignore.includes(m.id)) continue;
        const score = Math.abs(side - this.off) + Math.max(0, along) * 0.5;
        if (score < best) {
          best = score;
          want = Math.max(-sw.maxDev, Math.min(sw.maxDev, side));
        }
      }
    }
    const maxStep = sw.speed * this.h.speed * dt;
    this.off += Math.max(-maxStep, Math.min(maxStep, want - this.off));
    this.hx = lx + px * this.off;
    this.hy = ly + py * this.off;
    this.vis = Math.max(0, Math.min(1, this.passT / 0.4, (this.total - this.passT) / 0.4));

    if (this.held < 0 && !(d.kind === 'snake' && this.caught) && this.vis >= 0.5) {
      for (const m of this.h.marbles) {
        const hdx = m.x - this.hx;
        const hdy = m.y - this.hy;
        const hr = d.size + m.radius;
        if (hdx > hr || hdx < -hr || hdy > hr || hdy < -hr) continue;
        if (!this.catchable(m) || this.ignore.includes(m.id)) continue;
        if (Math.hypot(hdx, hdy) < hr) {
          const mo = this.mouth();
          this.held = m.id;
          this.heldAt = t;
          this.caught = true;
          this.setPhase('holding');
          this.grab(t, m, mo.x, mo.y);
          break;
        }
      }
    } else if (this.held >= 0) {
      const mo = this.mouth();
      this.place(this.h.marbles[this.held], mo.x, mo.y);
    }

    const ended = this.passT >= this.total - EPS;
    const back = Math.abs(this.off) < 0.05;
    if (this.held >= 0 && (ended || (back && t - this.heldAt >= this.h.holdTime - EPS))) this.finishHold(t);
    if (ended) {
      this.waiting = true;
      this.timer = d.rest;
      this.vis = 0;
      this.setPhase('hidden');
    }
  }

  state(): MonsterState {
    const s = this.baseState(this.hx, this.hy, Math.atan2(this.dir.y, this.dir.x), this.waiting ? 0 : this.vis, this.held >= 0 ? [this.held] : []);
    s.passFrom = { x: this.from.x, y: this.from.y };
    return s;
  }
}

/* ----------------------------------------------------------------- system */

export class MonsterSystem {
  private list: (Spider | Octopus | Crosser)[] = [];

  private readonly shared: Shared = { now: 0, immuneUntil: new Map(), grabs: new Map() };

  constructor(defs: readonly Monster[], host: MonsterHost) {
    SHARED.set(host, this.shared);
    for (const d of defs) {
      switch (d.kind) {
        case 'spider':
          this.list.push(new Spider(d, host));
          break;
        case 'octopus':
          this.list.push(new Octopus(d, host));
          break;
        default:
          this.list.push(new Crosser(d, host));
      }
    }
  }

  get count(): number {
    return this.list.length;
  }

  update(t: number, dt: number): void {
    this.shared.now = t;
    for (const m of this.list) m.update(t, dt);
  }

  states(): MonsterState[] {
    return this.list.map((m) => m.state());
  }
}
