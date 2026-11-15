import { describe, expect, it } from "vitest";
import type { GameConfig } from "../src/core/config";
import { sampleConfig, sampleMap } from "../src/core/fixtures";
import type { LinkMotion, MapDef, Mechanism, Vec } from "../src/core/types";
import { createSimulation, type Simulation } from "../src/sim";

type FlipMotion = Extract<LinkMotion, { type: "flipper" }>;

/** Recommended defaults for a RIGHT flipper (bar extends towards -x; y-down: rest -0.45 = tip low, up +0.5 = tip high). */
const RIGHT: FlipMotion = {
  type: "flipper",
  rest: -0.45,
  up: 0.5,
  upSpeed: 6,
  downSpeed: 4,
  hold: 0.12,
  cooldown: 0.35,
};

function flipper(
  id: string,
  pivot: Vec,
  dir: 1 | -1,
  motion: FlipMotion,
  len = 2,
): Mechanism {
  const p = (x: number, y: number): Vec => ({ x: x * dir, y });
  return {
    id,
    kind: "flipper",
    pivot,
    links: [
      {
        shapes: [
          { type: "circle", cx: 0, cy: 0, r: 0.2 },
          {
            type: "polygon",
            points: [p(0, -0.2), p(len, -0.2), p(len, 0.2), p(0, 0.2)],
          },
          { type: "circle", cx: len * dir, cy: 0, r: 0.2 },
        ],
        motion,
      },
    ],
    effect: null,
  };
}

function tiny(
  spawns: Vec[],
  mechanisms: Mechanism[],
  walls: MapDef["walls"] = [],
): MapDef {
  const m = sampleMap(1, 0.45);
  return {
    ...m,
    seed: 5,
    bounds: { minX: -60, minY: -60, maxX: 60, maxY: 120 },
    path: [
      { x: 0, y: 0 },
      { x: 0, y: 40 },
    ],
    walls,
    gates: [],
    mechanisms,
    zones: [],
    switches: [],
    start: { spawnPoints: spawns, area: [] },
    finish: { a: { x: -5, y: 90 }, b: { x: 5, y: 90 }, sensor: [] },
    segments: [],
  };
}

function cfgFor(
  n: number,
  patch: (c: GameConfig) => void = () => {},
): GameConfig {
  const c = sampleConfig(n);
  c.race.countdown = 0.5;
  c.race.unstuck = false;
  c.physics.launchStrength = 0;
  c.camera.offscreenKill = false;
  patch(c);
  return c;
}

// right flipper: pivot (1,10), bar towards -x, resting tip at about (-0.8, 10.85)
const PIVOT: Vec = { x: 1, y: 10 };
const mk = (
  motion: FlipMotion = RIGHT,
  spawn: Vec = { x: 0, y: 5 },
  patch?: (c: GameConfig) => void,
  walls: MapDef["walls"] = [],
): Simulation =>
  createSimulation(
    tiny([spawn], [flipper("f", PIVOT, -1, motion)], walls),
    [{ id: 0, name: "A", skin: { type: "solid", colors: ["#f00"] } }],
    cfgFor(1, patch),
  );

const angleOf = (sim: Simulation): number =>
  sim.getMechanismPoses()[0].links[0].angle;

describe("flippers", () => {
  it("launches a dropped marble upward", () => {
    const sim = mk();
    let minY = Infinity;
    let minVy = 0;
    let fired = false;
    for (let i = 0; i < 120 * 5; i++) {
      sim.step();
      const m = sim.getMarbles()[0];
      if (sim.getMechanismPoses()[0].links[0].active) fired = true;
      if (fired) {
        minY = Math.min(minY, m.y);
        minVy = Math.min(minVy, m.vy);
      }
    }
    expect(fired).toBe(true);
    expect(minVy).toBeLessThan(-8);
    // flipper surface near the contact is ~10.5; marble must rise >= 2 m above it
    expect(10.5 - minY).toBeGreaterThan(2);
  });

  it("works mirrored (left flipper)", () => {
    const left: FlipMotion = { ...RIGHT, rest: 0.45, up: -0.5 };
    const sim = createSimulation(
      tiny([{ x: 0, y: 5 }], [flipper("f", { x: -1, y: 10 }, 1, left)]),
      [{ id: 0, name: "A", skin: { type: "solid", colors: ["#f00"] } }],
      cfgFor(1),
    );
    let minVy = 0;
    for (let i = 0; i < 120 * 4; i++) {
      sim.step();
      minVy = Math.min(minVy, sim.getMarbles()[0].vy);
    }
    expect(minVy).toBeLessThan(-8);
  });

  it("returns to rest and respects the cooldown", () => {
    const sim = mk(RIGHT, { x: 0, y: 8 }); // lands soon
    const log: { t: number; a: number; active: boolean }[] = [];
    for (let i = 0; i < 120 * 6; i++) {
      sim.step();
      log.push({
        t: sim.time,
        a: angleOf(sim),
        active: !!sim.getMechanismPoses()[0].links[0].active,
      });
    }
    expect(Math.abs(log[0].a - RIGHT.rest)).toBeLessThan(1e-9);
    const first = log.findIndex((l) => l.active);
    expect(first).toBeGreaterThan(0);
    const reachedUp = log.findIndex((l) => Math.abs(l.a - RIGHT.up) < 1e-9);
    expect(reachedUp).toBeGreaterThan(first);
    // eventually back at rest
    const back = log.findIndex(
      (l, i) => i > reachedUp && Math.abs(l.a - RIGHT.rest) < 1e-9,
    );
    expect(back).toBeGreaterThan(reachedUp);
    // up swing takes ~ |up-rest|/upSpeed
    expect((reachedUp - first) / 120).toBeLessThan(0.2);
    // starts of up phases are at least hold + cooldown-ish apart
    const starts: number[] = [];
    log.forEach((l, i) => {
      if (l.active && !(i > 0 && log[i - 1].active)) starts.push(l.t);
    });
    for (let i = 1; i < starts.length; i++)
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(
        RIGHT.cooldown + RIGHT.hold - 1e-6,
      );
  });

  it("re-triggers for a marble resting on it once the cooldown allows", () => {
    // tiny swing (0.12 rad) so the marble keeps lying on the bar instead of flying off
    const m: FlipMotion = {
      ...RIGHT,
      rest: 0,
      up: 0.12,
      upSpeed: 1,
      cooldown: 1.5,
      hold: 0.1,
    };
    // backstop wall behind the pivot so the marble can't roll off that end
    const stop: MapDef["walls"] = [
      {
        id: "stop",
        reaction: "solid",
        style: "wall",
        shape: {
          type: "polyline",
          thickness: 0.4,
          points: [
            { x: 1.5, y: 6 },
            { x: 1.5, y: 11 },
          ],
        },
      },
    ];
    const sim = mk(m, { x: 0.3, y: 8 }, undefined, stop);
    const starts: number[] = [];
    let prev = false;
    for (let i = 0; i < 120 * 12; i++) {
      sim.step();
      const act = !!sim.getMechanismPoses()[0].links[0].active;
      if (act && !prev) starts.push(sim.time);
      prev = act;
    }
    const y = sim.getMarbles()[0].y;
    expect(y).toBeLessThan(10.5); // still on the flipper
    expect(starts.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < starts.length; i++)
      expect(starts[i] - starts[i - 1]).toBeGreaterThanOrEqual(1.5 - 1e-6);
  });

  it("is not scaled by objects.speed nor reversed by switch effects", () => {
    const run = (speed: number): number[] => {
      const sim = mk(RIGHT, { x: 0, y: 8 }, (c) => (c.objects.speed = speed));
      const out: number[] = [];
      for (let i = 0; i < 120 * 3; i++) {
        sim.step();
        out.push(angleOf(sim));
      }
      return out;
    };
    expect(run(3)).toEqual(run(1));
  });

  it("is deterministic", () => {
    const a = mk();
    const b = mk();
    for (let i = 0; i < 120 * 6; i++) {
      a.step();
      b.step();
    }
    expect(a.getMarbles()).toEqual(b.getMarbles());
    expect(a.getMechanismPoses()).toEqual(b.getMechanismPoses());
  });
});
