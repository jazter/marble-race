import { describe, expect, it } from 'vitest';
import type { GameConfig } from '../src/core/config';
import { sampleConfig, sampleMap, sampleRoster } from '../src/core/fixtures';
import type { MapDef, Wall } from '../src/core/types';
import { createSimulation, type SimEvent, type Simulation } from '../src/sim';

function snapshot(sim: Simulation): string {
  return JSON.stringify(
    sim.getMarbles().map((m) => [m.x, m.y, m.angle, m.radius, m.status, m.vx, m.vy, m.progress, m.offscreenTime]),
  );
}

/** Minimal map: one marble above a floor at y=10, finish far away. */
function tiny(spawns = [{ x: 0, y: 0 }]): MapDef {
  const m = sampleMap(1, 0.45);
  return {
    ...m,
    seed: 7,
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
    start: { spawnPoints: spawns, area: [] },
    finish: { a: { x: -5, y: 90 }, b: { x: 5, y: 90 }, sensor: [] },
    segments: [],
  };
}

function floor(y: number, reaction: Wall['reaction'] = 'solid', extra: Partial<Wall> = {}): Wall {
  return {
    id: 'floor',
    reaction,
    shape: { type: 'polyline', thickness: 0.4, points: [{ x: -10, y }, { x: 10, y }] },
    ...extra,
  };
}

function cfgFor(n: number, patch: (c: GameConfig) => void = () => {}): GameConfig {
  const c = sampleConfig(n);
  c.race.countdown = 0.5;
  c.race.unstuck = false;
  c.physics.launchStrength = 0;
  c.physics.linearDamping = 0;
  patch(c);
  return c;
}

function run(sim: Simulation, seconds: number): SimEvent[] {
  sim.stepMany(Math.round(seconds * 120));
  return sim.drainEvents();
}

describe('simulation', () => {
  it('is deterministic (state + events)', () => {
    const cfg = sampleConfig(12);
    const mk = () => createSimulation(sampleMap(12, cfg.marbles.radius), sampleRoster(12), cfg);
    const a = mk();
    const b = mk();
    const ea: SimEvent[] = [];
    const eb: SimEvent[] = [];
    for (let i = 0; i < 4000; i++) {
      a.step();
      b.step();
      if (i % 50 === 0) {
        expect(snapshot(a)).toBe(snapshot(b));
        ea.push(...a.drainEvents());
        eb.push(...b.drainEvents());
      }
    }
    ea.push(...a.drainEvents());
    eb.push(...b.drainEvents());
    expect(snapshot(a)).toBe(snapshot(b));
    expect(JSON.stringify(ea)).toBe(JSON.stringify(eb));
    expect(JSON.stringify(a.getCamera())).toBe(JSON.stringify(b.getCamera()));
    expect(JSON.stringify(a.getMechanismPoses())).toBe(JSON.stringify(b.getMechanismPoses()));
    expect(ea.length).toBeGreaterThan(0);
    a.destroy();
    b.destroy();
  });

  it('opens the start gate at the end of the countdown', () => {
    const cfg = sampleConfig(12);
    const sim = createSimulation(sampleMap(12, cfg.marbles.radius), sampleRoster(12), cfg);
    sim.stepMany(Math.round(cfg.race.countdown * 120) - 5);
    expect(sim.getOpenGates()).toEqual([]);
    expect(sim.getMarbles().every((m) => m.status === 'waiting')).toBe(true);
    sim.stepMany(10);
    expect(sim.getOpenGates()).toContain('startGate');
    expect(sim.getMarbles().every((m) => m.status === 'racing')).toBe(true);
    const evs = sim.drainEvents();
    expect(evs.some((e) => e.type === 'gateOpen' && e.gateId === 'startGate')).toBe(true);
    sim.destroy();
  });

  it('sample map: marbles finish and the race ends with ordered ranks', () => {
    const cfg = sampleConfig(12);
    const sim = createSimulation(sampleMap(12, cfg.marbles.radius), sampleRoster(12), cfg);
    let steps = 0;
    while (!sim.isOver() && steps < 120 * 200) {
      sim.step();
      steps++;
    }
    const res = sim.getResult();
    expect(res.over).toBe(true);
    expect(res.finishers.length).toBeGreaterThanOrEqual(1);
    expect(res.finishers.map((f) => f.rank)).toEqual(res.finishers.map((_, i) => i + 1));
    for (let i = 1; i < res.finishers.length; i++) expect(res.finishers[i].time).toBeGreaterThanOrEqual(res.finishers[i - 1].time);
    expect(res.finishers[0].time).toBeLessThan(cfg.race.timeLimit);
    const evs = sim.drainEvents();
    expect(evs.filter((e) => e.type === 'raceEnd').length).toBe(1);
    const t = sim.time;
    sim.step();
    expect(sim.time).toBe(t); // no-op after the end
    sim.destroy();
  });

  it('kill wall eliminates a marble', () => {
    const map = tiny();
    map.walls = [floor(5, 'kill')];
    const sim = createSimulation(map, sampleRoster(1), cfgFor(1));
    const evs = run(sim, 4);
    const m = sim.getMarbles()[0];
    expect(m.status).toBe('eliminated');
    expect(m.eliminatedReason).toBe('wall');
    expect(evs.some((e) => e.type === 'eliminated' && e.reason === 'wall')).toBe(true);
    expect(sim.getResult().reason).toBe('noMarbles');
    sim.destroy();
  });

  it('launch wall adds speed along launchDir', () => {
    const map = tiny();
    map.walls = [floor(5, 'launch', { launchDir: { x: 0, y: -1 } })];
    const cfg = cfgFor(1);
    const sim = createSimulation(map, sampleRoster(1), cfg);
    let minVy = 0;
    for (let i = 0; i < 400; i++) {
      sim.step();
      minVy = Math.min(minVy, sim.getMarbles()[0].vy);
    }
    expect(minVy).toBeLessThan(-cfg.walls.launchStrength * 0.7);
    expect(sim.drainEvents().some((e) => e.type === 'effect' && e.effect === 'launch')).toBe(true);
    sim.destroy();
  });

  it('launch wall without launchDir kicks along the contact normal', () => {
    const map = tiny();
    map.walls = [floor(5, 'launch')];
    const cfg = cfgFor(1);
    const sim = createSimulation(map, sampleRoster(1), cfg);
    let minVy = 0;
    for (let i = 0; i < 400; i++) {
      sim.step();
      minVy = Math.min(minVy, sim.getMarbles()[0].vy);
    }
    expect(minVy).toBeLessThan(-cfg.walls.launchStrength * 0.7);
    sim.destroy();
  });

  it('boundary walls take their reaction from config.walls.boundary', () => {
    const map = tiny();
    map.walls = [floor(5, 'solid', { boundary: true })];
    const sim = createSimulation(map, sampleRoster(1), cfgFor(1, (c) => (c.walls.boundary = 'kill')));
    run(sim, 4);
    expect(sim.getMarbles()[0].eliminatedReason).toBe('wall');
    sim.destroy();
  });

  it('slow wall damps velocity while touching', () => {
    const slowMap = tiny();
    slowMap.walls = [{ ...floor(5, 'slow'), shape: { type: 'polyline', thickness: 0.4, points: [{ x: -30, y: 5 }, { x: 30, y: 5 }] } }];
    const solidMap = tiny();
    solidMap.walls = [{ ...floor(5, 'solid'), shape: { type: 'polyline', thickness: 0.4, points: [{ x: -30, y: 5 }, { x: 30, y: 5 }] } }];
    const patch = (c: GameConfig) => {
      c.physics.launchStrength = 6;
      c.map.width = 10;
    };
    const run1 = (map: MapDef) => {
      const sim = createSimulation(map, sampleRoster(1), cfgFor(1, patch));
      sim.getMarbles(); // ensure access
      run(sim, 2.5);
      const m = sim.getMarbles()[0];
      const speed = Math.hypot(m.vx, m.vy);
      const x = m.x;
      sim.destroy();
      return { speed, x };
    };
    const slow = run1(slowMap);
    const solid = run1(solidMap);
    expect(Math.abs(slow.x)).toBeLessThan(Math.abs(solid.x));
  });

  it('offscreenKill eliminates marbles outside the camera', () => {
    const map = tiny([{ x: -10, y: 0 }, { x: 10, y: 0 }]);
    map.walls = [floor(8)];
    const cfg = cfgFor(2, (c) => {
      c.camera.viewWidth = 2;
      c.camera.offscreenKill = true;
      c.camera.offscreenGrace = 0.2;
    });
    const sim = createSimulation(map, sampleRoster(2), cfg);
    run(sim, 3);
    const ms = sim.getMarbles();
    expect(ms.some((m) => m.eliminatedReason === 'offscreen')).toBe(true);
    sim.destroy();
  });

  it('offscreenTime accumulates without kill', () => {
    const map = tiny([{ x: -10, y: 0 }, { x: 10, y: 0 }]);
    map.walls = [floor(8)];
    const cfg = cfgFor(2, (c) => {
      c.camera.viewWidth = 2;
      c.camera.offscreenKill = false;
    });
    const sim = createSimulation(map, sampleRoster(2), cfg);
    run(sim, 3);
    expect(sim.getMarbles().some((m) => m.status === 'racing' && m.offscreenTime > 0.5)).toBe(true);
    sim.destroy();
  });

  it('outOfBounds eliminates', () => {
    const map = tiny();
    map.bounds.maxY = 6;
    const sim = createSimulation(map, sampleRoster(1), cfgFor(1));
    run(sim, 3);
    expect(sim.getMarbles()[0].eliminatedReason).toBe('outOfBounds');
    sim.destroy();
  });

  it('switch emits an event and changes gravity, then reverts', () => {
    const map = tiny();
    map.walls = [floor(8)];
    map.switches = [
      {
        id: 'sw',
        position: { x: 0, y: 3 },
        halfWidth: 1,
        halfHeight: 0.2,
        angle: 0,
        action: { type: 'lowGravity', value: 0.4 },
        mode: 'timed',
        duration: 1,
        label: 'Gravedad baja',
      },
    ];
    const cfg = cfgFor(1);
    const sim = createSimulation(map, sampleRoster(1), cfg);
    let sawActive = false;
    const evs: SimEvent[] = [];
    for (let i = 0; i < 600; i++) {
      sim.step();
      evs.push(...sim.drainEvents());
      if (sim.getSwitchStates()[0].active && !sawActive) {
        sawActive = true;
        expect(sim.getPhysicsState().gravity.y).toBeCloseTo(cfg.physics.gravity * 0.4, 6);
        expect(sim.getPhysicsState().activeLabels).toEqual(['Gravedad baja']);
      }
    }
    expect(sawActive).toBe(true);
    expect(evs.filter((e) => e.type === 'switch').map((e) => (e as { active: boolean }).active)).toEqual([true, false]);
    expect(sim.getPhysicsState().gravity.y).toBeCloseTo(cfg.physics.gravity, 6);
    sim.destroy();
  });

  it('openGate switch removes the gate', () => {
    const map = tiny();
    map.gates = [{ id: 'g', role: 'switch', shape: { type: 'polygon', points: [{ x: -3, y: 6 }, { x: 3, y: 6 }, { x: 3, y: 6.3 }, { x: -3, y: 6.3 }] } }];
    map.switches = [
      { id: 'sw', position: { x: 0, y: 3 }, halfWidth: 1, halfHeight: 0.2, angle: 0, action: { type: 'openGate', value: 0, gateId: 'g' }, mode: 'once', duration: 0, label: 'Abrir' },
    ];
    const sim = createSimulation(map, sampleRoster(1), cfgFor(1));
    run(sim, 3);
    expect(sim.getOpenGates()).toEqual(['g']);
    expect(sim.getMarbles()[0].y).toBeGreaterThan(7);
    sim.destroy();
  });

  it('grow zone enlarges, shrink mechanism shrinks, caps respected', () => {
    const map = tiny();
    map.zones = [{ id: 'z', effect: 'grow', strength: 1.25, shape: { type: 'circle', center: { x: 0, y: 4 }, radius: 1.5 } }];
    map.walls = [floor(20)];
    const cfg = cfgFor(1);
    const sim = createSimulation(map, sampleRoster(1), cfg);
    run(sim, 2);
    expect(sim.getMarbles()[0].radius).toBeCloseTo(cfg.marbles.radius * 1.25, 9);
    sim.destroy();

    const map2 = tiny();
    map2.walls = [floor(20)];
    map2.mechanisms = [
      {
        id: 'm',
        kind: 'triangle',
        pivot: { x: 0, y: 4 },
        links: [{ shapes: [{ type: 'circle', cx: 0, cy: 0, r: 1.5 }], motion: { type: 'rotate', speed: 1, phase: 0 } }],
        effect: 'shrink',
      },
    ];
    const sim2 = createSimulation(map2, sampleRoster(1), cfg);
    for (let i = 0; i < 600 && sim2.getMarbles()[0].radius === cfg.marbles.radius; i++) sim2.step();
    expect(sim2.getMarbles()[0].radius).toBeCloseTo(cfg.marbles.radius * 0.8, 9);
    sim2.destroy();
  });

  it('destroy mechanism eliminates', () => {
    const map = tiny();
    map.mechanisms = [
      { id: 'm', kind: 'saw', pivot: { x: 0, y: 4 }, links: [{ shapes: [{ type: 'circle', cx: 0, cy: 0, r: 1.5 }], motion: { type: 'rotate', speed: 1, phase: 0 } }], effect: 'destroy' },
    ];
    const sim = createSimulation(map, sampleRoster(1), cfgFor(1));
    run(sim, 2);
    expect(sim.getMarbles()[0].eliminatedReason).toBe('destroy');
    sim.destroy();
  });

  it('attract field pulls marbles', () => {
    const map = tiny();
    map.zones = [{ id: 'a', effect: 'attract', strength: 40, shape: { type: 'circle', center: { x: 5, y: 0 }, radius: 6 } }];
    const noField = tiny();
    const cfg = cfgFor(1);
    const a = createSimulation(map, sampleRoster(1), cfg);
    const b = createSimulation(noField, sampleRoster(1), cfg);
    run(a, 1.5);
    run(b, 1.5);
    expect(a.getMarbles()[0].x).toBeGreaterThan(b.getMarbles()[0].x + 0.5);
    a.destroy();
    b.destroy();
  });

  it('mechanism poses follow link chain and motion', () => {
    const cfg = sampleConfig(12);
    const sim = createSimulation(sampleMap(12, cfg.marbles.radius), sampleRoster(12), cfg);
    const p0 = sim.getMechanismPoses().find((p) => p.id === 'arm1')!;
    expect(p0.links[1].x).toBeCloseTo(-4 + 3, 9);
    sim.stepMany(120);
    const p1 = sim.getMechanismPoses().find((p) => p.id === 'arm1')!;
    expect(p1.links[0].angle).toBeCloseTo(1, 6);
    expect(p1.links[1].angle).toBeCloseTo(1 - 2, 6);
    expect(p1.field).toBeDefined();
    const ham = sim.getMechanismPoses().find((p) => p.id === 'hammer1')!;
    expect(ham.links[0].angle).toBeCloseTo(0.9 * Math.sin(2 * Math.PI * 0.5 * 1), 6);
    sim.destroy();
  });

  it('rough performance: 20-marble race', () => {
    const cfg = sampleConfig(20);
    const sim = createSimulation(sampleMap(20, cfg.marbles.radius), sampleRoster(20), cfg);
    const t0 = performance.now();
    let steps = 0;
    while (!sim.isOver() && steps < 120 * 60) {
      sim.step();
      steps++;
    }
    const ms = performance.now() - t0;
    console.log(`[perf] 20 marbles, ${(steps / 120).toFixed(1)} sim-seconds in ${ms.toFixed(0)} ms`);
    expect(ms).toBeLessThan(5000);
    sim.destroy();
  });
});

describe('scroll camera', () => {
  it('starts at the pack and never lets the leader escape below the view', () => {
    const cfg = sampleConfig(12);
    cfg.camera.mode = 'scroll';
    cfg.camera.scrollSpeed = 0.5; // much slower than the marbles
    cfg.camera.offscreenKill = true;
    const sim = createSimulation(sampleMap(12), sampleRoster(12), cfg);
    while (!sim.isOver() && sim.time < 120) sim.step();
    // with a slow scroll the leader must survive (the camera follows it), so someone finishes
    expect(sim.getResult().finishers.length).toBeGreaterThan(0);
    sim.destroy();
  });
});

describe('rematch (race.raceSeed)', () => {
  const run = (raceSeed?: number) => {
    const cfg = sampleConfig(12);
    if (raceSeed !== undefined) cfg.race.raceSeed = raceSeed;
    const sim = createSimulation(sampleMap(12), sampleRoster(12), cfg);
    while (!sim.isOver() && sim.time < 120) sim.step();
    const r = sim.getResult();
    sim.destroy();
    return JSON.stringify(r.finishers);
  };
  it('raceSeed 0 / undefined replays the original race exactly', () => {
    expect(run(0)).toBe(run(undefined));
  });
  it('a rematch is deterministic but plays out differently', () => {
    expect(run(1)).toBe(run(1));
    expect(run(1)).not.toBe(run(0));
  });
});

describe('course outline containment', () => {
  it('eliminates a racing marble that ends up outside the outline', () => {
    const map = sampleMap(6);
    // pretend the course ends at y = 9: anything that falls below is "outside the walls"
    map.outline = [
      { x: -8, y: -30 },
      { x: 8, y: -30 },
      { x: 8, y: 9 },
      { x: -8, y: 9 },
    ];
    const sim = createSimulation(map, sampleRoster(6), sampleConfig(6));
    while (!sim.isOver() && sim.time < 20) sim.step();
    const out = sim.getMarbles().filter((m) => m.eliminatedReason === 'outOfBounds');
    expect(out.length).toBeGreaterThan(0);
    sim.destroy();
  });
  it('maps without an outline only use the bounds box', () => {
    const sim = createSimulation(sampleMap(6), sampleRoster(6), sampleConfig(6));
    while (!sim.isOver() && sim.time < 20) sim.step();
    expect(sim.getMarbles().filter((m) => m.eliminatedReason === 'outOfBounds').length).toBe(0);
    sim.destroy();
  });
});

describe('timed switches', () => {
  it('re-hits while active do not extend it, and it rests before it can fire again', () => {
    const map = sampleMap(12);
    const cfg = sampleConfig(12);
    const sim = createSimulation(map, sampleRoster(12), cfg);
    const on: number[] = [];
    const off: number[] = [];
    while (!sim.isOver() && sim.time < 60) {
      sim.step();
      for (const e of sim.drainEvents()) {
        if (e.type !== 'switch' || e.switchId !== 'sw1') continue;
        (e.active ? on : off).push(e.t);
      }
    }
    sim.destroy();
    const dur = map.switches.find((s) => s.id === 'sw1')!.duration;
    for (let i = 0; i < off.length; i++) expect(off[i] - on[i]).toBeCloseTo(dur, 1); // never extended
    for (let i = 1; i < on.length; i++) expect(on[i] - off[i - 1]).toBeGreaterThanOrEqual(4 - 1e-6); // rest
  });
});

describe('stun walls', () => {
  it('daze a marble (slow + float) without eliminating it, then it carries on', () => {
    const map = sampleMap(1);
    map.walls = map.walls.map((w) => (w.id === 'ramp1' ? { ...w, reaction: 'stun' as const } : w));
    const cfg = sampleConfig(1);
    const sim = createSimulation(map, sampleRoster(1), cfg);
    let stunnedSeen = false;
    let stunEvent = false;
    let recovered = false;
    while (!sim.isOver() && sim.time < 40) {
      sim.step();
      for (const e of sim.drainEvents()) if (e.type === 'effect' && e.effect === 'stun') stunEvent = true;
      const m = sim.getMarbles()[0];
      if ((m.stunned ?? 0) > 0) {
        stunnedSeen = true;
        expect(Math.hypot(m.vx, m.vy)).toBeLessThan(4); // floating, not falling
      } else if (stunnedSeen) recovered = true;
    }
    const m = sim.getMarbles()[0];
    expect(stunEvent && stunnedSeen && recovered).toBe(true);
    expect(m.eliminatedReason).not.toBe('wall');
    sim.destroy();
  });
});
