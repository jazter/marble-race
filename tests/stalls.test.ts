import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import { createRoster } from '../src/core/roster';
import { generateMap } from '../src/gen';
import { createSimulation } from '../src/sim';

/** Racing, unheld marbles that stay within 0.5 m for more than 6 s. */
function stalls(seed: number, gravity: number): number {
  const cfg = defaultConfig();
  cfg.physics.gravity = gravity;
  const map = generateMap(cfg, seed);
  const sim = createSimulation(map, createRoster(cfg, seed), cfg);
  const anchor = new Map<number, { x: number; y: number; t: number; rep: boolean }>();
  let n = 0;
  while (!sim.isOver() && sim.time < 200) {
    sim.stepMany(12);
    sim.drainEvents();
    for (const m of sim.getMarbles()) {
      if (m.status !== 'racing' || m.heldBy !== undefined) {
        anchor.delete(m.id);
        continue;
      }
      const a = anchor.get(m.id);
      if (!a || Math.hypot(m.x - a.x, m.y - a.y) > 0.5) anchor.set(m.id, { x: m.x, y: m.y, t: sim.time, rep: false });
      else if (!a.rep && sim.time - a.t > 6) {
        a.rep = true;
        n++;
      }
    }
  }
  sim.destroy();
  return n;
}

describe('no stuck marbles (regression seeds)', () => {
  // seeds where marbles used to jam: bumpers on honey ledges / grown marbles beside bumpers and
  // saws in gable lanes, gravity-tilt switches kept on by re-hits, corner pile-ups
  for (const [seed, g] of [
    [8, 9.8],
    [30, 9.8],
    [36, 9.8],
    [8, 6.9],
    [12, 6.9],
  ] as const) {
    it(`seed ${seed}, gravity ${g}`, () => {
      expect(stalls(seed, g)).toBe(0);
    });
  }
});
