import { describe, expect, it } from 'vitest';
import type { GameConfig } from '../src/core/config';
import { sampleConfig, sampleMap, sampleMapWithMonsters, sampleRoster } from '../src/core/fixtures';
import type { MapDef, Monster, Vec } from '../src/core/types';
import { createSimulation, type SimEvent, type Simulation } from '../src/sim';

type MonsterEvent = Extract<SimEvent, { type: 'monster' }>;

function tiny(spawns: Vec[], monsters?: Monster[]): MapDef {
  const m = sampleMap(1, 0.45);
  return {
    ...m,
    seed: 11,
    bounds: { minX: -60, minY: -60, maxX: 60, maxY: 120 },
    path: [
      { x: 0, y: 0 },
      { x: 0, y: 40 },
    ],
    walls: [],
    gates: [],
    mechanisms: [],
    zones: [],
    switches: [],
    monsters,
    start: { spawnPoints: spawns, area: [] },
    finish: { a: { x: -5, y: 90 }, b: { x: 5, y: 90 }, sensor: [] },
    segments: [],
  };
}

function cfgFor(n: number, patch: (c: GameConfig) => void = () => {}): GameConfig {
  const c = sampleConfig(n);
  c.race.countdown = 0.5;
  c.race.unstuck = false;
  c.physics.launchStrength = 0;
  c.physics.linearDamping = 0;
  c.camera.offscreenKill = false;
  c.monsters.holdTime = 1;
  c.monsters.speed = 1;
  patch(c);
  return c;
}

/** Steps until pred() or maxSeconds; collects monster events. */
function until(sim: Simulation, maxSeconds: number, pred: () => boolean, evs: MonsterEvent[] = []): MonsterEvent[] {
  for (let i = 0; i < maxSeconds * 120 && !pred(); i++) {
    sim.step();
    for (const e of sim.drainEvents()) if (e.type === 'monster') evs.push(e);
  }
  return evs;
}

const spider = (extra: Partial<Extract<Monster, { kind: 'spider' }>> = {}): Monster => ({
  id: 's1',
  kind: 'spider',
  anchor: { x: 0, y: 0 },
  down: { x: 0, y: 1 },
  restLength: 3,
  maxLength: 12,
  huntWidth: 1.5,
  size: 0.6,
  ...extra,
});

describe('monsters', () => {
  it('is deterministic with monsters (state + events)', () => {
    const cfg = sampleConfig(14);
    cfg.monsters.holdTime = 1;
    const mk = () => createSimulation(sampleMapWithMonsters(14, cfg.marbles.radius), sampleRoster(14), cfg);
    const a = mk();
    const b = mk();
    const ea: SimEvent[] = [];
    const eb: SimEvent[] = [];
    const snap = (s: Simulation) => JSON.stringify([s.getMarbles().map((m) => [m.x, m.y, m.status, m.heldBy]), s.getMonsterStates()]);
    for (let i = 0; i < 4000; i++) {
      a.step();
      b.step();
      if (i % 40 === 0) expect(snap(a)).toBe(snap(b));
      ea.push(...a.drainEvents());
      eb.push(...b.drainEvents());
    }
    expect(snap(a)).toBe(snap(b));
    expect(JSON.stringify(ea)).toBe(JSON.stringify(eb));
    expect(ea.some((e) => e.type === 'monster' && e.action === 'grab')).toBe(true);
    expect(a.getMonsterStates().length).toBe(4);
    a.destroy();
    b.destroy();
  });

  it('maps with monsters undefined or [] are bit-identical', () => {
    const cfg = sampleConfig(12);
    const run = (monsters: Monster[] | undefined) => {
      const map = sampleMap(12, cfg.marbles.radius);
      if (monsters) map.monsters = monsters;
      const sim = createSimulation(map, sampleRoster(12), cfg);
      sim.stepMany(3000);
      const out = JSON.stringify([sim.getMarbles().map((m) => [m.x, m.y, m.status, m.finishTime]), sim.getResult().finishers]);
      expect(sim.getMonsterStates()).toEqual([]);
      sim.destroy();
      return out;
    };
    const a = run(undefined);
    expect(run([])).toBe(a);
    expect(JSON.parse(a)[1].length).toBeGreaterThan(0);
  });

  describe('spider', () => {
    const drop = (chance: number) => {
      const cfg = cfgFor(1, (c) => {
        c.monsters.destroyChance = chance;
        c.physics.gravity = 2; // the spider (7 m/s) outruns a slow fall
      });
      const map = tiny([{ x: 0.2, y: 6 }], [spider()]);
      return { sim: createSimulation(map, sampleRoster(1), cfg), cfg };
    };

    it('catches a marble below the anchor, lifts it, then devours (chance 1)', () => {
      const { sim } = drop(1);
      const m = sim.getMarbles()[0];
      const evs = until(sim, 10, () => m.heldBy !== undefined);
      expect(evs.some((e) => e.action === 'grab' && e.kind === 'spider')).toBe(true);
      expect(m.heldBy).toBe('s1');
      const y0 = m.y;
      expect(sim.getMonsterStates()[0].holding).toEqual([0]);
      sim.stepMany(60);
      expect(m.y).toBeLessThan(y0); // rising with the spider
      const st = sim.getMonsterStates()[0];
      expect(m.y).toBeGreaterThan(st.y);
      expect(m.vy).toBe(0);
      until(sim, 10, () => m.status === 'eliminated', evs);
      expect(m.eliminatedReason).toBe('monster');
      expect(evs.some((e) => e.action === 'devour')).toBe(true);
      expect(sim.isOver()).toBe(true);
      sim.destroy();
    });

    it('releases (chance 0): marble drops and keeps racing', () => {
      const { sim } = drop(0);
      const m = sim.getMarbles()[0];
      const evs = until(sim, 10, () => m.heldBy !== undefined);
      until(sim, 10, () => m.heldBy === undefined, evs);
      expect(evs.some((e) => e.action === 'release')).toBe(true);
      expect(m.status).toBe('racing');
      const y = m.y;
      sim.stepMany(30);
      expect(m.y).toBeGreaterThan(y);
      expect(m.vy).toBeGreaterThan(0);
      sim.destroy();
    });
  });

  describe('octopus', () => {
    const octo = (): Monster => ({
      id: 'o1',
      kind: 'octopus',
      center: { x: 0, y: 10 },
      bodyRadius: 1,
      reach: 5,
      tentacles: 8,
      facing: -Math.PI / 2,
      size: 0.4,
    });

    it('holds several marbles at once (never > 8) and releases them', () => {
      const n = 14;
      const spawns: Vec[] = [];
      for (let i = 0; i < n; i++) spawns.push({ x: -5 + (i % 7) * 1.5, y: 0 - Math.floor(i / 7) * 1.5 });
      const cfg = cfgFor(n, (c) => {
        c.monsters.destroyChance = 0;
        c.monsters.holdTime = 2;
        c.physics.gravity = 3;
      });
      const map = tiny(spawns, [octo()]);
      map.walls = [{ id: 'floor', reaction: 'solid', shape: { type: 'polyline', thickness: 0.4, points: [{ x: -12, y: 30 }, { x: 12, y: 30 }] } }];
      const sim = createSimulation(map, sampleRoster(n), cfg);
      let maxHeld = 0;
      let released = 0;
      for (let i = 0; i < 120 * 25; i++) {
        sim.step();
        const held = sim.getMarbles().filter((m) => m.heldBy !== undefined).length;
        maxHeld = Math.max(maxHeld, held);
        const st = sim.getMonsterStates()[0];
        expect(st.tentacles!.length).toBe(8);
        expect(st.holding.length).toBeLessThanOrEqual(8);
        for (const e of sim.drainEvents()) if (e.type === 'monster' && e.action === 'release') released++;
      }
      expect(maxHeld).toBeGreaterThanOrEqual(3);
      expect(maxHeld).toBeLessThanOrEqual(8);
      expect(released).toBeGreaterThan(0);
      expect(sim.getMarbles().some((m) => m.eliminatedReason === 'monster')).toBe(false); // destroyChance 0
      sim.destroy();
    });

    it('the body is solid', () => {
      const cfg = cfgFor(1, (c) => (c.monsters.holdTime = 100));
      const map = tiny([{ x: 0.1, y: 0 }], [{ ...(octo() as Extract<Monster, { kind: 'octopus' }>), reach: 1.0 }]);
      const sim = createSimulation(map, sampleRoster(1), cfg);
      let minDist = Infinity;
      for (let i = 0; i < 120 * 8; i++) {
        sim.step();
        const m = sim.getMarbles()[0];
        minDist = Math.min(minDist, Math.hypot(m.x, m.y - 10) - m.radius);
      }
      // the marble hit the body and never penetrated it
      expect(minDist).toBeGreaterThan(1 - 0.08);
      expect(minDist).toBeLessThan(1 + 0.1);
      sim.destroy();
    });
  });

  describe('fish', () => {
    const fish: Monster = { id: 'f1', kind: 'fish', a: { x: -10, y: 5 }, b: { x: 10, y: 5 }, speed: 4, rest: 1, phase: 1, size: 0.7 };

    it('swims a->b, carries a marble (max 1), devours with chance 1', () => {
      // marbles floating (gravity 0) on the path
      const cfg = cfgFor(2, (c) => {
        c.monsters.destroyChance = 1;
        c.monsters.holdTime = 1;
        c.physics.gravity = 0;
      });
      const map = tiny([{ x: -2, y: 5 }, { x: -1.6, y: 5.4 }], [fish]);
      const sim = createSimulation(map, sampleRoster(2), cfg);
      let lastX = -Infinity;
      let maxHeld = 0;
      const evs: MonsterEvent[] = [];
      let wasHunting = false;
      for (let i = 0; i < 120 * 12; i++) {
        sim.step();
        for (const e of sim.drainEvents()) if (e.type === 'monster') evs.push(e);
        const st = sim.getMonsterStates()[0];
        maxHeld = Math.max(maxHeld, st.holding.length);
        if (st.phase === 'hunting' || st.phase === 'holding') {
          if (wasHunting) expect(st.x).toBeGreaterThanOrEqual(lastX);
          lastX = st.x;
          wasHunting = true;
          expect(st.passFrom).toEqual({ x: -10, y: 5 });
          expect(Math.abs(st.angle)).toBeLessThan(1e-9);
        } else wasHunting = false;
      }
      expect(maxHeld).toBe(1);
      expect(evs.filter((e) => e.action === 'grab').length).toBeGreaterThanOrEqual(1);
      expect(evs.some((e) => e.action === 'devour')).toBe(true);
      expect(sim.getMarbles().some((m) => m.eliminatedReason === 'monster')).toBe(true);
      sim.destroy();
    });

    it('releases with chance 0 and the marble keeps racing', () => {
      const cfg = cfgFor(1, (c) => {
        c.monsters.destroyChance = 0;
        c.monsters.holdTime = 0.5;
        c.physics.gravity = 0;
      });
      const sim = createSimulation(tiny([{ x: -2, y: 5 }], [fish]), sampleRoster(1), cfg);
      const evs = until(sim, 8, () => false);
      expect(evs.map((e) => e.action).slice(0, 2)).toEqual(['grab', 'release']);
      const m = sim.getMarbles()[0];
      expect(m.status).toBe('racing');
      expect(m.vx).toBeGreaterThan(1);
      sim.destroy();
    });
  });

  describe('snake', () => {
    const snake: Monster = {
      id: 'k1',
      kind: 'snake',
      passes: [
        { a: { x: -10, y: 5 }, b: { x: 10, y: 5 } },
        { a: { x: -10, y: 20 }, b: { x: 10, y: 28 } },
        { a: { x: 0, y: -10 }, b: { x: 0, y: 30 } },
      ],
      length: 3,
      speed: 6,
      rest: 0.5,
      phase: 0.5,
      size: 0.6,
    };

    it('catches one marble per pass, carries it, devours', () => {
      const cfg = cfgFor(3, (c) => {
        c.monsters.destroyChance = 1;
        c.monsters.holdTime = 5;
        c.physics.gravity = 0;
      });
      // three marbles in a cluster across every possible line near (0,5)
      const map = tiny([{ x: 0, y: 5 }, { x: 0.3, y: 5.3 }, { x: -0.3, y: 4.7 }], [snake]);
      map.monsters = [{ ...(snake as Extract<Monster, { kind: 'snake' }>), passes: [snake.kind === 'snake' ? snake.passes[0] : { a: { x: 0, y: 0 }, b: { x: 0, y: 0 } }] }];
      const sim = createSimulation(map, sampleRoster(3), cfg);
      let maxHeld = 0;
      const evs: MonsterEvent[] = [];
      let carriedOk = false;
      for (let i = 0; i < 120 * 6; i++) {
        sim.step();
        for (const e of sim.drainEvents()) if (e.type === 'monster') evs.push(e);
        const st = sim.getMonsterStates()[0];
        maxHeld = Math.max(maxHeld, st.holding.length);
        if (st.holding.length === 1) {
          const m = sim.getMarbles()[st.holding[0]];
          if (Math.hypot(m.x - st.x, m.y - st.y) < 1e-6) carriedOk = true;
        }
      }
      expect(maxHeld).toBe(1);
      expect(carriedOk).toBe(true);
      expect(evs.filter((e) => e.action === 'grab').length).toBeGreaterThanOrEqual(1);
      expect(evs.some((e) => e.action === 'devour')).toBe(true);
      sim.destroy();
    });

    it('uses different passes over time (seeded, deterministic)', () => {
      const cfg = cfgFor(1, (c) => (c.physics.gravity = 0));
      const seen = (seed: number) => {
        const map = tiny([{ x: 50, y: 50 }], [snake]);
        map.seed = seed;
        const sim = createSimulation(map, sampleRoster(1), cfg);
        const froms = new Set<string>();
        for (let i = 0; i < 120 * 40; i++) {
          sim.step();
          const st = sim.getMonsterStates()[0];
          if (st.passFrom && st.phase !== 'hidden') froms.add(`${st.passFrom.x},${st.passFrom.y}`);
        }
        sim.destroy();
        return [...froms].sort().join('|');
      };
      expect(seen(11).split('|').length).toBeGreaterThan(1);
      expect(seen(11)).toBe(seen(11));
    });
  });

  it('held marbles are never eliminated offscreen/outOfBounds while held', () => {
    const cfg = cfgFor(1, (c) => {
      c.camera.offscreenKill = true;
      c.camera.offscreenGrace = 0;
      c.camera.viewWidth = 2;
      c.monsters.holdTime = 3;
      c.monsters.destroyChance = 0;
      c.physics.gravity = 2;
    });
    const map = tiny([{ x: 0.2, y: 6 }], [spider()]);
    map.bounds = { minX: -60, minY: -60, maxX: 60, maxY: 120 };
    const sim = createSimulation(map, sampleRoster(1), cfg);
    const m = sim.getMarbles()[0];
    let heldSteps = 0;
    for (let i = 0; i < 120 * 6; i++) {
      sim.step();
      if (m.heldBy !== undefined) {
        heldSteps++;
        expect(m.status).toBe('racing');
      }
    }
    expect(heldSteps).toBeGreaterThan(120);
    sim.destroy();
  });

  it('race still ends with a monster fixture and getResult is consistent', () => {
    const cfg = sampleConfig(12);
    const sim = createSimulation(sampleMapWithMonsters(12, cfg.marbles.radius), sampleRoster(12), cfg);
    let steps = 0;
    while (!sim.isOver() && steps < 120 * 300) {
      sim.step();
      steps++;
    }
    const r = sim.getResult();
    expect(r.over).toBe(true);
    const elim = sim.getMarbles().filter((m) => m.status === 'eliminated').length;
    expect(r.eliminated).toBe(elim);
    sim.destroy();
  });
});

describe('release immunity', () => {
  it('a released marble is not grabbed again by any monster for 2 s', async () => {
    const { defaultConfig } = await import('../src/core/config');
    const { generateMap } = await import('../src/gen');
    const { createRoster } = await import('../src/core/roster');
    let releases = 0;
    for (const seed of [1, 2, 3, 4]) {
      const cfg = defaultConfig();
      cfg.monsters.destroyChance = 0; // only releases, so marbles can be re-caught
      cfg.monsters.count = 8;
      const map = generateMap(cfg, seed);
      const sim = createSimulation(map, createRoster(cfg, seed), cfg);
      const lastRelease = new Map<number, number>();
      while (!sim.isOver() && sim.time < 150) {
        sim.step();
        for (const e of sim.drainEvents()) {
          if (e.type !== 'monster') continue;
          if (e.action === 'release') {
            lastRelease.set(e.marbleId, e.t);
            releases++;
          } else if (e.action === 'grab') {
            const r = lastRelease.get(e.marbleId);
            if (r !== undefined) expect(e.t - r).toBeGreaterThanOrEqual(2 - 1e-6);
          }
        }
      }
      sim.destroy();
    }
    expect(releases).toBeGreaterThan(5);
  });
});
