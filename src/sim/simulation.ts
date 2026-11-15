/**
 * Deterministic marble-race simulation on top of planck.js.
 *
 * Determinism rules: fixed SIM_DT, only `Rng(map.seed)` for randomness, stable
 * iteration order (marbles by id), contact callbacks only RECORD data; all game
 * logic and world mutations happen after world.step().
 */
import { Circle, Vec2, World, type Body, type Contact, type Fixture } from 'planck';
import { SIM_DT, type EffectType, type GameConfig, type WallReaction } from '../core/config';
import { cross, pointInPolygon } from '../core/math';
import { Rng } from '../core/rng';
import type { MapDef, MarbleProfile } from '../core/types';
import type {
  CameraState,
  CreateSimulation,
  EliminationReason,
  MarbleState,
  MechanismPose,
  PhysicsState,
  RaceEndReason,
  RaceResult,
  SimEvent,
  Simulation,
  SwitchState,
  MonsterState,
} from './api';
import {
  addFixtures,
  K_GATE,
  K_MONSTER,
  K_MARBLE,
  K_MECH,
  K_SWITCH,
  K_WALL,
  K_ZONE,
  localShape,
  makePolygon,
  polygonCentroidRadius,
  staticShapes,
  type FixTag,
} from './build';
import { SimCamera } from './camera';
import { advanceState, computePoses, initFlip, initState, type MechRuntime } from './mechanisms';
import { MonsterSystem } from './monsters';
import { PathProgress } from './progress';
import { combinePhysics, type SwitchRuntime } from './switches';

/** Each marble can trigger flippers at most this many times per race. */
const MAX_FLIPS_PER_MARBLE = 3;
const VEL_ITERS = 8;
const POS_ITERS = 3;
const EFFECT_COOLDOWN = 1; // s, grow/shrink/destroy/field per (marble, object)
const BOUNCE_COOLDOWN = 0.25;
const LAUNCH_COOLDOWN = 0.3;
const SLOW_FX_COOLDOWN = 0.5;
const PODIUM_HOLD = 3; // s after the podium fills
const NEVER = -1e9;

interface ContactRec {
  begin: boolean;
  marble: number;
  kind: number;
  idx: number;
  nx: number;
  ny: number;
}

interface FieldSrc {
  /** objKey for cooldowns */
  key: number;
  mech: MechRuntime | null;
  cx: number;
  cy: number;
  radius: number;
  strength: number;
  sign: 1 | -1; // +1 attract, -1 repel
}

class SimImpl implements Simulation {
  readonly map: MapDef;
  readonly config: GameConfig;
  time = 0;
  stepCount = 0;

  private world: World;
  private rng: Rng;
  private monsterRng: Rng;
  private monsters!: MonsterSystem;
  private marbles: MarbleState[] = [];
  private bodies: (Body | null)[] = [];
  private fixtures: (Fixture | null)[] = [];
  private prevX: number[] = [];
  private prevY: number[] = [];
  private segHint: number[] = [];
  private slowCount: number[] = [];
  /** Times each marble has triggered a flipper (capped by MAX_FLIPS_PER_MARBLE). */
  private flipCount: number[] = [];
  private lastKick: number[] = [];
  private hist: number[][] = [];

  private wallReaction: WallReaction[] = [];
  private gateBodies = new Map<string, Body>();
  private openGates: string[] = [];
  private mechs: MechRuntime[] = [];
  private switches: SwitchRuntime[] = [];
  private fields: FieldSrc[] = [];
  private cooldown: Float64Array[] = [];
  private keyOfWall: number[] = [];
  private keyOfMech: number[] = [];
  private keyOfZone: number[] = [];
  private zoneEffects: { effect: EffectType; strength: number }[] = [];

  private prog: PathProgress;
  private cam: SimCamera;
  private phys: PhysicsState;

  private events: SimEvent[] = [];
  private contactRecs: ContactRec[] = [];
  private started = false;
  private raceSteps = 0;
  private over = false;
  private endReason?: RaceEndReason;
  private podiumAt: number | null = null;
  private finishedCount = 0;
  private eliminatedCount = 0;
  private finishOrder: number[] = [];
  private destroyed = false;

  constructor(map: MapDef, roster: MarbleProfile[], config: GameConfig) {
    this.map = map;
    this.config = config;
    // raceSeed 0/undefined keeps the original race bit-identical; a rematch mixes it in.
    const rs = config.race.raceSeed ? Math.imul(config.race.raceSeed >>> 0, 0x9e3779b1) >>> 0 : 0;
    this.rng = new Rng((map.seed ^ rs) >>> 0);
    this.monsterRng = new Rng((map.seed ^ 0x6d6f6e73 ^ rs) >>> 0);
    this.prog = new PathProgress(map.path);
    this.cam = new SimCamera(map, config, this.prog);

    this.world = new World({ gravity: new Vec2(0, 0), allowSleep: true });

    this.buildWalls();
    this.buildGates();
    this.buildZones();
    this.buildSwitches();
    this.buildMechanisms();

    // cooldown tables: [walls..., mechs..., zones...]
    const n = roster.length;
    const objects = map.walls.length + map.mechanisms.length + map.zones.length;
    for (let i = 0; i < objects; i++) this.cooldown.push(new Float64Array(n).fill(NEVER));

    this.phys = combinePhysics(config, this.switches);
    this.world.setGravity(new Vec2(this.phys.gravity.x, this.phys.gravity.y));
    this.buildMarbles(roster);
    this.buildMonsters();

    this.world.on('begin-contact', (c) => this.onContact(c, true));
    this.world.on('end-contact', (c) => this.onContact(c, false));

    this.cam.update(this.marbles, false);
  }

  /* ------------------------------------------------------------- building */

  private buildWalls(): void {
    const { map, config } = this;
    map.walls.forEach((w, i) => {
      const reaction: WallReaction = w.boundary && config.walls.boundary !== 'mixed' ? config.walls.boundary : w.reaction;
      this.wallReaction.push(reaction);
      this.keyOfWall.push(i);
      const body = this.world.createBody({ type: 'static', position: new Vec2(0, 0) });
      addFixtures(body, staticShapes(w.shape), {
        restitution: reaction === 'bounce' ? config.walls.bounceRestitution : 0,
        friction: 0.2,
        userData: { k: K_WALL, i },
      });
    });
  }

  private buildGates(): void {
    for (let i = 0; i < this.map.gates.length; i++) {
      const g = this.map.gates[i];
      const body = this.world.createBody({ type: 'static', position: new Vec2(0, 0) });
      addFixtures(body, staticShapes(g.shape), { userData: { k: K_GATE, i } });
      this.gateBodies.set(g.id, body);
    }
  }

  private buildZones(): void {
    const { map } = this;
    const base = map.walls.length + map.mechanisms.length;
    map.zones.forEach((z, i) => {
      this.keyOfZone.push(base + i);
      this.zoneEffects.push({ effect: z.effect, strength: z.strength });
      if (z.effect === 'attract' || z.effect === 'repel') {
        let cx: number, cy: number, r: number;
        if (z.shape.type === 'circle') {
          cx = z.shape.center.x;
          cy = z.shape.center.y;
          r = z.shape.radius;
        } else {
          const c = polygonCentroidRadius(z.shape.points);
          cx = c.cx;
          cy = c.cy;
          r = c.r;
        }
        this.fields.push({
          key: base + i,
          mech: null,
          cx,
          cy,
          radius: r,
          strength: z.strength,
          sign: z.effect === 'attract' ? 1 : -1,
        });
        return;
      }
      const body = this.world.createBody({ type: 'static', position: new Vec2(0, 0) });
      const shapes =
        z.shape.type === 'circle'
          ? staticShapes({ type: 'circle', center: z.shape.center, radius: z.shape.radius })
          : staticShapes({ type: 'polygon', points: z.shape.points });
      addFixtures(body, shapes, { isSensor: true, userData: { k: K_ZONE, i } });
    });
  }

  private buildSwitches(): void {
    this.map.switches.forEach((s, i) => {
      this.switches.push({ def: s, active: false, remaining: 0, hits: 0 });
      const body = this.world.createBody({ type: 'static', position: new Vec2(s.position.x, s.position.y), angle: s.angle });
      const poly = makePolygon([
        { x: -s.halfWidth, y: -s.halfHeight },
        { x: s.halfWidth, y: -s.halfHeight },
        { x: s.halfWidth, y: s.halfHeight },
        { x: -s.halfWidth, y: s.halfHeight },
      ]);
      if (poly) addFixtures(body, [poly], { isSensor: true, userData: { k: K_SWITCH, i } });
    });
  }

  private buildMechanisms(): void {
    const { map } = this;
    map.mechanisms.forEach((def, i) => {
      this.keyOfMech.push(map.walls.length + i);
      const rt: MechRuntime = {
        def,
        bodies: [],
        state: initState(def),
        poses: def.links.map(() => ({ x: 0, y: 0, angle: 0 })),
        flip: initFlip(def),
        touch: def.links.map(() => false),
      };
      computePoses(rt);
      def.links.forEach((link, li) => {
        const p = rt.poses[li];
        const body = this.world.createBody({
          type: 'kinematic',
          position: new Vec2(p.x, p.y),
          angle: p.angle,
        });
        const shapes = [];
        for (const ls of link.shapes) {
          const s = localShape(ls);
          if (s) shapes.push(s);
        }
        addFixtures(body, shapes, { friction: 0.2, userData: { k: K_MECH, i } });
        rt.bodies.push(body);
      });
      this.mechs.push(rt);
      if (def.effect === 'attract' || def.effect === 'repel') {
        this.fields.push({
          key: map.walls.length + i,
          mech: rt,
          cx: 0,
          cy: 0,
          radius: def.fieldRadius ?? 3,
          strength: def.fieldStrength ?? 10,
          sign: def.effect === 'attract' ? 1 : -1,
        });
      }
    });
  }

  private buildMonsters(): void {
    const defs = this.map.monsters ?? [];
    for (let i = 0; i < defs.length; i++) {
      const d = defs[i];
      if (d.kind !== 'octopus') continue;
      const body = this.world.createBody({ type: 'static', position: new Vec2(0, 0) });
      addFixtures(body, staticShapes({ type: 'circle', center: d.center, radius: d.bodyRadius }), {
        restitution: 0,
        friction: 0.2,
        userData: { k: K_MONSTER, i },
      });
    }
    const mc = this.config.monsters;
    const sim = this;
    this.monsters = new MonsterSystem(defs, {
      marbles: this.marbles,
      rng: this.monsterRng,
      flowDir: this.map.flowDir,
      holdTime: mc.holdTime,
      destroyChance: mc.destroyChance,
      speed: mc.speed,
      hold: (m) => {
        const b = sim.bodies[m.id];
        if (!b) return;
        b.setLinearVelocity(new Vec2(0, 0));
        b.setAngularVelocity(0);
        b.setActive(false);
      },
      release: (m, x, y, vx, vy) => {
        m.heldBy = undefined;
        m.x = x;
        m.y = y;
        m.vx = vx;
        m.vy = vy;
        const b = sim.bodies[m.id];
        if (!b) return;
        b.setPosition(new Vec2(x, y));
        b.setActive(true);
        b.setLinearVelocity(new Vec2(vx, vy));
        b.setAwake(true);
        sim.prevX[m.id] = x;
        sim.prevY[m.id] = y;
      },
      devour: (m) => {
        m.heldBy = undefined;
        sim.eliminate(m, 'monster');
      },
      emit: (e) => sim.emit(e),
    });
  }

  private buildMarbles(roster: MarbleProfile[]): void {
    const { config, map } = this;
    for (let idx = 0; idx < roster.length; idx++) {
      const profile = roster[idx];
      const sp = map.start.spawnPoints[profile.id] ?? map.start.spawnPoints[idx] ?? { x: 0, y: 0 };
      const body = this.world.createBody({
        type: 'dynamic',
        position: new Vec2(sp.x, sp.y),
        bullet: true,
        allowSleep: false,
        linearDamping: config.physics.linearDamping,
      });
      const fix = body.createFixture({
        shape: new Circle(config.marbles.radius),
        density: config.marbles.density,
        friction: config.marbles.friction,
        restitution: this.phys.marbleRestitution,
        userData: { k: K_MARBLE, i: idx } as FixTag,
      });
      this.bodies.push(body);
      this.fixtures.push(fix);
      this.marbles.push({
        id: idx,
        profile,
        x: sp.x,
        y: sp.y,
        angle: 0,
        radius: config.marbles.radius,
        vx: 0,
        vy: 0,
        status: 'waiting',
        progress: 0,
        offscreenTime: 0,
      });
      this.prevX.push(sp.x);
      this.prevY.push(sp.y);
      this.segHint.push(-1);
      this.slowCount.push(0);
      this.lastKick.push(NEVER);
      this.hist.push([]);
    }
    const seg = [0];
    for (const m of this.marbles) {
      m.progress = this.prog.project(m, -1, seg);
      this.segHint[m.id] = seg[0];
    }
  }

  /* ------------------------------------------------------ contact recording */

  private onContact(c: Contact, begin: boolean): void {
    const fa = c.getFixtureA();
    const fb = c.getFixtureB();
    const ta = fa.getUserData() as FixTag;
    const tb = fb.getUserData() as FixTag;
    let mt: FixTag, ot: FixTag, marbleIsA: boolean;
    if (ta.k === K_MARBLE) {
      if (tb.k === K_MARBLE || tb.k === K_GATE) return;
      mt = ta;
      ot = tb;
      marbleIsA = true;
    } else if (tb.k === K_MARBLE) {
      if (ta.k === K_GATE) return;
      mt = tb;
      ot = ta;
      marbleIsA = false;
    } else return;
    let nx = 0;
    let ny = 0;
    if (begin && ot.k === K_WALL && this.wallReaction[ot.i] === 'launch') {
      const wm = c.getWorldManifold(null);
      if (wm) {
        const n = wm.normal;
        // normal points A -> B; we want "away from wall" = towards the marble
        nx = marbleIsA ? -n.x : n.x;
        ny = marbleIsA ? -n.y : n.y;
      }
    }
    this.contactRecs.push({ begin, marble: mt.i, kind: ot.k, idx: ot.i, nx, ny });
  }

  /* ----------------------------------------------------------------- events */

  private emit(e: SimEvent): void {
    this.events.push(e);
  }

  private raceTime(): number {
    return this.time - this.config.race.countdown;
  }

  private eliminate(m: MarbleState, reason: EliminationReason): void {
    if (m.status === 'eliminated' || m.status === 'finished') return;
    m.status = 'eliminated';
    m.eliminatedReason = reason;
    m.eliminatedAt = this.raceTime();
    this.eliminatedCount++;
    this.emit({ t: this.time, type: 'eliminated', marbleId: m.id, reason, x: m.x, y: m.y });
    const b = this.bodies[m.id];
    if (b) this.world.destroyBody(b);
    this.bodies[m.id] = null;
    this.fixtures[m.id] = null;
  }

  private fxCooldownOk(key: number, marbleId: number, cd: number): boolean {
    const arr = this.cooldown[key];
    if (this.time - arr[marbleId] < cd) return false;
    arr[marbleId] = this.time;
    return true;
  }

  private setRadius(m: MarbleState, r: number): void {
    if (r === m.radius) return;
    const body = this.bodies[m.id];
    const old = this.fixtures[m.id];
    if (!body || !old) return;
    body.destroyFixture(old);
    this.fixtures[m.id] = body.createFixture({
      shape: new Circle(r),
      density: this.config.marbles.density,
      friction: this.config.marbles.friction,
      restitution: this.phys.marbleRestitution,
      userData: { k: K_MARBLE, i: m.id } as FixTag,
    });
    m.radius = r;
  }

  private applyObjectEffect(m: MarbleState, effect: EffectType | null, strength: number | null, key: number): void {
    if (!effect || (effect !== 'grow' && effect !== 'shrink' && effect !== 'destroy')) return;
    if (!this.fxCooldownOk(key, m.id, EFFECT_COOLDOWN)) return;
    const mc = this.config.marbles;
    if (effect === 'destroy') {
      this.emit({ t: this.time, type: 'effect', marbleId: m.id, effect, x: m.x, y: m.y });
      this.eliminate(m, 'destroy');
      return;
    }
    const factor = effect === 'grow' ? (strength ?? 1.25) : (strength ?? 0.8);
    const r = Math.min(mc.maxScale * mc.radius, Math.max(mc.minScale * mc.radius, m.radius * factor));
    this.emit({ t: this.time, type: 'effect', marbleId: m.id, effect, x: m.x, y: m.y });
    this.setRadius(m, r);
  }

  private openGate(id: string): void {
    const b = this.gateBodies.get(id);
    if (!b) return;
    this.gateBodies.delete(id);
    this.world.destroyBody(b);
    this.openGates.push(id);
    this.emit({ t: this.time, type: 'gateOpen', gateId: id });
  }

  private triggerSwitch(idx: number): void {
    const s = this.switches[idx];
    const def = s.def;
    if (def.mode === 'once') {
      if (s.active) return;
      s.active = true;
      s.remaining = 0;
      s.hits++;
      this.emit({ t: this.time, type: 'switch', switchId: def.id, active: true });
    } else {
      const was = s.active;
      s.active = true;
      s.remaining = def.duration;
      s.hits++;
      if (!was) this.emit({ t: this.time, type: 'switch', switchId: def.id, active: true });
    }
    if (def.action.type === 'openGate' && def.action.gateId) this.openGate(def.action.gateId);
  }

  /* ------------------------------------------------------------------ start */

  private startRace(): void {
    this.started = true;
    for (const g of this.map.gates) {
      if (g.role === 'start') this.openGate(g.id);
    }
    const flow = this.map.flowDir;
    const base = Math.atan2(flow.x, flow.y); // angle from +y
    const launch = this.config.physics.launchStrength;
    for (const m of this.marbles) {
      if (m.status !== 'waiting') continue;
      m.status = 'racing';
      const body = this.bodies[m.id]!;
      const mag = launch * this.rng.range(0.4, 1);
      const a = base + this.rng.range(-60, 60) * (Math.PI / 180);
      const v = body.getLinearVelocity();
      body.setLinearVelocity(new Vec2(v.x + Math.sin(a) * mag, v.y + Math.cos(a) * mag));
    }
  }

  /* ------------------------------------------------------------------- step */

  step(): void {
    if (this.over || this.destroyed) return;
    const dt = SIM_DT;
    const cfg = this.config;

    if (!this.started && this.time + 1e-9 >= cfg.race.countdown) this.startRace();

    const phys = this.phys;
    this.world.setGravity(new Vec2(phys.gravity.x, phys.gravity.y));

    // mechanisms: advance + kinematic targets
    for (const rt of this.mechs) {
      this.scanFlipperTouch(rt);
      advanceState(rt, phys.mechanismSpeed, dt);
      const prev = rt.poses.map((p) => ({ x: p.x, y: p.y, angle: p.angle }));
      computePoses(rt);
      for (let i = 0; i < rt.bodies.length; i++) {
        const b = rt.bodies[i];
        const t = rt.poses[i];
        const pos = b.getPosition();
        b.setLinearVelocity(new Vec2((t.x - pos.x) / dt, (t.y - pos.y) / dt));
        b.setAngularVelocity((t.angle - prev[i].angle) / dt);
      }
    }

    // per-marble forces (racing only)
    const wind = phys.wind;
    const slowMul = Math.pow(1 - cfg.walls.slowFactor, dt);
    for (const m of this.marbles) {
      if (m.status !== 'racing' || m.heldBy !== undefined) continue;
      const body = this.bodies[m.id]!;
      let ax = wind.x;
      let ay = wind.y;
      for (const f of this.fields) {
        let cx = f.cx;
        let cy = f.cy;
        if (f.mech) {
          const fp = f.mech.field;
          if (!fp) continue;
          cx = fp.x;
          cy = fp.y;
        }
        const dx = cx - m.x;
        const dy = cy - m.y;
        const d = Math.hypot(dx, dy);
        if (d >= f.radius || d < 1e-9) continue;
        const a = f.strength * (1 - d / f.radius) * f.sign;
        ax += (dx / d) * a;
        ay += (dy / d) * a;
        if (this.fxCooldownOk(f.key, m.id, EFFECT_COOLDOWN)) {
          this.emit({ t: this.time, type: 'effect', marbleId: m.id, effect: f.sign > 0 ? 'attract' : 'repel', x: m.x, y: m.y });
        }
      }
      if (ax !== 0 || ay !== 0) {
        const mass = body.getMass();
        body.applyForceToCenter(new Vec2(mass * ax, mass * ay), true);
      }
      if (this.slowCount[m.id] > 0) {
        const v = body.getLinearVelocity();
        body.setLinearVelocity(new Vec2(v.x * slowMul, v.y * slowMul));
      }
    }

    for (const m of this.marbles) {
      this.prevX[m.id] = m.x;
      this.prevY[m.id] = m.y;
    }

    this.world.step(dt, VEL_ITERS, POS_ITERS);
    this.stepCount++;
    this.time = this.stepCount * dt;
    if (this.started) this.raceSteps++;

    this.syncMarbles();
    this.processContacts();
    this.updateSwitchTimers();
    this.processFinish();
    this.processProgressAndBounds();
    if (this.monsters.count > 0 && this.started) this.monsters.update(this.time, dt);

    this.cam.update(this.marbles, this.started);
    this.processOffscreen();
    if (cfg.race.unstuck && this.started) this.processUnstuck();

    this.updatePhysicsState();
    this.checkRaceEnd();
  }

  stepMany(n: number): void {
    for (let i = 0; i < n; i++) this.step();
  }

  private syncMarbles(): void {
    for (const m of this.marbles) {
      const b = this.bodies[m.id];
      if (!b || m.heldBy !== undefined) continue;
      const p = b.getPosition();
      const v = b.getLinearVelocity();
      m.x = p.x;
      m.y = p.y;
      m.angle = b.getAngle();
      m.vx = v.x;
      m.vy = v.y;
    }
  }

  /**
   * Flipper trigger: true when a racing, un-held marble is touching the link (checked on the
   * live contact list every step, so a marble resting on a flipper re-triggers it after the
   * cooldown). The launch itself is just the kinematic surface velocity of the swing.
   */
  /**
   * Flippers fire when a racing marble touches them, but each marble can only trigger
   * flippers MAX_FLIPS_PER_MARBLE times per race: after that it no longer fires them and
   * rolls off toward the drain, so no marble bounces on a pinball table forever.
   */
  private scanFlipperTouch(rt: MechRuntime): void {
    for (let i = 0; i < rt.bodies.length; i++) {
      const f = rt.flip[i];
      if (!f) continue;
      const motion = rt.def.links[i].motion;
      const ready = motion.type === 'flipper' && (f.phase === 'rest' || f.phase === 'down') && f.sinceDown + SIM_DT >= motion.cooldown;
      const touching: number[] = [];
      for (let e = rt.bodies[i].getContactList(); e; e = e.next) {
        const c = e.contact;
        if (!c.isTouching() || !c.isEnabled()) continue;
        const other = e.other;
        const fa = c.getFixtureA();
        const tag = (fa.getBody() === other ? fa : c.getFixtureB()).getUserData() as FixTag;
        if (tag.k !== K_MARBLE) continue;
        const m = this.marbles[tag.i];
        if (m && m.status === 'racing' && m.heldBy === undefined && (this.flipCount[m.id] ?? 0) < MAX_FLIPS_PER_MARBLE) touching.push(m.id);
      }
      rt.touch[i] = touching.length > 0;
      if (ready && touching.length) for (const id of touching) this.flipCount[id] = (this.flipCount[id] ?? 0) + 1;
    }
  }

  private processContacts(): void {
    const recs = this.contactRecs;
    if (recs.length === 0) return;
    this.contactRecs = [];
    const cfg = this.config;
    for (const r of recs) {
      const m = this.marbles[r.marble];
      if (r.kind === K_WALL) {
        const reaction = this.wallReaction[r.idx];
        if (reaction === 'slow') {
          if (r.begin) {
            this.slowCount[m.id]++;
            if (m.status === 'racing' && this.fxCooldownOk(this.keyOfWall[r.idx], m.id, SLOW_FX_COOLDOWN)) {
              this.emit({ t: this.time, type: 'effect', marbleId: m.id, effect: 'slow', x: m.x, y: m.y });
            }
          } else if (this.slowCount[m.id] > 0) this.slowCount[m.id]--;
          continue;
        }
        if (!r.begin || m.status !== 'racing' || m.heldBy !== undefined) continue;
        if (reaction === 'bounce') {
          if (this.fxCooldownOk(this.keyOfWall[r.idx], m.id, BOUNCE_COOLDOWN)) {
            this.emit({ t: this.time, type: 'effect', marbleId: m.id, effect: 'bounce', x: m.x, y: m.y });
          }
        } else if (reaction === 'kill') {
          this.eliminate(m, 'wall');
        } else if (reaction === 'launch') {
          if (!this.fxCooldownOk(this.keyOfWall[r.idx], m.id, LAUNCH_COOLDOWN)) continue;
          const wall = this.map.walls[r.idx];
          let dx = r.nx;
          let dy = r.ny;
          if (wall.launchDir) {
            const l = Math.hypot(wall.launchDir.x, wall.launchDir.y);
            if (l > 1e-12) {
              dx = wall.launchDir.x / l;
              dy = wall.launchDir.y / l;
            }
          }
          const body = this.bodies[m.id];
          if (!body) continue;
          const v = body.getLinearVelocity();
          const s = cfg.walls.launchStrength;
          body.setLinearVelocity(new Vec2(v.x + dx * s, v.y + dy * s));
          this.emit({ t: this.time, type: 'effect', marbleId: m.id, effect: 'launch', x: m.x, y: m.y });
        }
      } else if (r.begin && m.status === 'racing' && m.heldBy === undefined) {
        if (r.kind === K_MECH) {
          this.applyObjectEffect(m, this.mechs[r.idx].def.effect, null, this.keyOfMech[r.idx]);
        } else if (r.kind === K_ZONE) {
          const z = this.zoneEffects[r.idx];
          this.applyObjectEffect(m, z.effect, z.strength, this.keyOfZone[r.idx]);
        } else if (r.kind === K_SWITCH) {
          this.triggerSwitch(r.idx);
        }
      }
    }
  }

  private updateSwitchTimers(): void {
    for (const s of this.switches) {
      if (!s.active || s.def.mode !== 'timed') continue;
      s.remaining -= SIM_DT;
      if (s.remaining <= 1e-9) {
        s.remaining = 0;
        s.active = false;
        this.emit({ t: this.time, type: 'switch', switchId: s.def.id, active: false });
      }
    }
  }

  private processFinish(): void {
    const { a, b, sensor } = this.map.finish;
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const ab2 = abx * abx + aby * aby;
    const cand: { m: MarbleState; f: number }[] = [];
    for (const m of this.marbles) {
      if (m.status !== 'racing' || m.heldBy !== undefined) continue;
      const s0 = cross({ x: abx, y: aby }, { x: this.prevX[m.id] - a.x, y: this.prevY[m.id] - a.y });
      const s1 = cross({ x: abx, y: aby }, { x: m.x - a.x, y: m.y - a.y });
      let hit = false;
      let f = 1;
      if ((s0 <= 0 && s1 > 0) || (s0 >= 0 && s1 < 0)) {
        const ff = s0 / (s0 - s1);
        const px = this.prevX[m.id] + ff * (m.x - this.prevX[m.id]);
        const py = this.prevY[m.id] + ff * (m.y - this.prevY[m.id]);
        const t = ab2 > 0 ? ((px - a.x) * abx + (py - a.y) * aby) / ab2 : 0;
        if (t >= 0 && t <= 1) {
          hit = true;
          f = ff;
        }
      }
      if (!hit && sensor.length >= 3 && pointInPolygon(m, sensor)) hit = true;
      if (hit) cand.push({ m, f });
    }
    if (cand.length === 0) return;
    cand.sort((p, q) => p.f - q.f || p.m.id - q.m.id);
    const n = this.marbles.length;
    for (const { m } of cand) {
      this.finishedCount++;
      m.status = 'finished';
      m.rank = this.finishedCount;
      m.finishTime = this.raceTime();
      m.progress = this.prog.total + 0.01 * (n - m.rank + 1);
      m.offscreenTime = 0;
      this.finishOrder.push(m.id);
      this.emit({ t: this.time, type: 'finish', marbleId: m.id, rank: m.rank, time: m.finishTime });
    }
  }

  private processProgressAndBounds(): void {
    const bd = this.map.bounds;
    const seg = [0];
    const outline = this.map.outline && this.map.outline.length >= 3 ? this.map.outline : null;
    const checkOutline = outline !== null && this.stepCount % 4 === 0;
    for (const m of this.marbles) {
      if (m.status !== 'racing' || m.heldBy !== undefined) continue;
      if (m.x < bd.minX || m.x > bd.maxX || m.y < bd.minY || m.y > bd.maxY || (checkOutline && !pointInPolygon(m, outline))) {
        // escaped through a wall (or left the map): never let it keep racing outside the course
        this.eliminate(m, 'outOfBounds');
        continue;
      }
      m.progress = this.prog.project(m, this.segHint[m.id], seg);
      this.segHint[m.id] = seg[0];
    }
  }

  private processOffscreen(): void {
    const c = this.cam.state;
    const hw = c.width / 2;
    const hh = c.height / 2;
    const { offscreenKill, offscreenGrace } = this.config.camera;
    for (const m of this.marbles) {
      if (m.status !== 'racing' || m.heldBy !== undefined) continue;
      const outside = Math.abs(m.x - c.x) > hw + m.radius || Math.abs(m.y - c.y) > hh + m.radius;
      if (outside) m.offscreenTime += SIM_DT;
      else m.offscreenTime = 0;
      if (offscreenKill && m.offscreenTime > offscreenGrace) this.eliminate(m, 'offscreen');
    }
  }

  private processUnstuck(): void {
    const every = Math.round(1 / SIM_DT);
    if (this.raceSteps % every !== 0) return;
    const flow = this.map.flowDir;
    const fl = Math.hypot(flow.x, flow.y) || 1;
    const ux = -flow.x / fl;
    const uy = -flow.y / fl;
    for (const m of this.marbles) {
      if (m.status !== 'racing') continue;
      if (m.heldBy !== undefined) {
        this.hist[m.id].length = 0;
        continue;
      }
      const h = this.hist[m.id];
      h.push(m.x, m.y);
      if (h.length > 10) h.splice(0, 2);
      if (h.length < 10) continue;
      if (Math.hypot(m.x - h[0], m.y - h[1]) >= 0.25) continue;
      if (this.time - this.lastKick[m.id] < 4) continue;
      const side = this.rng.range(-0.8, 0.8);
      const speed = this.rng.range(4, 6);
      let kx = ux + -uy * side;
      let ky = uy + ux * side;
      const kl = Math.hypot(kx, ky) || 1;
      kx = (kx / kl) * speed;
      ky = (ky / kl) * speed;
      const body = this.bodies[m.id];
      if (!body) continue;
      const v = body.getLinearVelocity();
      body.setLinearVelocity(new Vec2(v.x + kx, v.y + ky));
      this.lastKick[m.id] = this.time;
      h.length = 0;
    }
  }

  private updatePhysicsState(): void {
    const prev = this.phys.marbleRestitution;
    this.phys = combinePhysics(this.config, this.switches);
    const r = this.phys.marbleRestitution;
    if (r === prev) return;
    for (const m of this.marbles) {
      const f = this.fixtures[m.id];
      const b = this.bodies[m.id];
      if (!f || !b) continue;
      f.setRestitution(r);
      for (let e = b.getContactList(); e; e = e.next) e.contact.resetRestitution();
    }
  }

  private checkRaceEnd(): void {
    if (!this.started || this.over) return;
    const rc = this.config.race;
    const rt = this.raceTime();
    let racing = 0;
    for (const m of this.marbles) if (m.status === 'racing') racing++;
    const podiumTarget = Math.min(rc.podiumSize, this.marbles.length);
    if (rc.endMode === 'podium' && this.podiumAt === null && this.finishedCount >= podiumTarget && podiumTarget > 0) {
      this.podiumAt = rt;
    }
    let reason: RaceEndReason | undefined;
    if (racing === 0) reason = this.finishedCount > 0 ? 'allDone' : 'noMarbles';
    else if (this.podiumAt !== null && rt - this.podiumAt >= PODIUM_HOLD - 1e-9) reason = 'podium';
    else if (rt >= rc.timeLimit) reason = 'timeout';
    if (reason) {
      this.over = true;
      this.endReason = reason;
      this.emit({ t: this.time, type: 'raceEnd', reason });
    }
  }

  /* ---------------------------------------------------------------- getters */

  getMarbles(): readonly MarbleState[] {
    return this.marbles;
  }

  getMechanismPoses(): readonly MechanismPose[] {
    return this.mechs.map((rt) => ({
      id: rt.def.id,
      links: rt.poses.map((p) => (p.active === undefined ? { x: p.x, y: p.y, angle: p.angle } : { x: p.x, y: p.y, angle: p.angle, active: p.active })),
      field: rt.field ? { x: rt.field.x, y: rt.field.y } : undefined,
    }));
  }

  getOpenGates(): readonly string[] {
    return this.openGates;
  }

  getSwitchStates(): readonly SwitchState[] {
    return this.switches.map((s) => ({ id: s.def.id, active: s.active, remaining: s.remaining, hits: s.hits }));
  }

  getCamera(): CameraState {
    return this.cam.state;
  }

  getMonsterStates(): readonly MonsterState[] {
    return this.monsters.states();
  }

  getPhysicsState(): PhysicsState {
    return this.phys;
  }

  drainEvents(): SimEvent[] {
    const e = this.events;
    this.events = [];
    return e;
  }

  isOver(): boolean {
    return this.over;
  }

  getResult(): RaceResult {
    const finishers = this.finishOrder.map((id) => {
      const m = this.marbles[id];
      return { marbleId: id, name: m.profile.name, time: m.finishTime ?? 0, rank: m.rank ?? 0 };
    });
    return {
      over: this.over,
      reason: this.endReason,
      finishers,
      eliminated: this.eliminatedCount,
      raceTime: this.raceTime(),
    };
  }

  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    for (let b = this.world.getBodyList(); b; ) {
      const next = b.getNext();
      this.world.destroyBody(b);
      b = next;
    }
    this.bodies.fill(null);
    this.fixtures.fill(null);
    this.contactRecs = [];
  }
}

export const createSimulation: CreateSimulation = (map, roster, config) => new SimImpl(map, roster, config);
