import { sampleConfig, sampleMapWithMonsters, sampleRoster } from '../src/core/fixtures';
import { createSimulation } from '../src/sim';

const n = Number(process.argv[2] ?? 20);
const cfg = sampleConfig(n);
cfg.monsters.holdTime = 1.5;
const map = sampleMapWithMonsters(n, cfg.marbles.radius);
const sim = createSimulation(map, sampleRoster(n), cfg);
const t0 = performance.now();
let steps = 0;
const counts: Record<string, number> = {};
while (!sim.isOver() && steps < 120 * 400) {
  sim.step();
  steps++;
  for (const e of sim.drainEvents()) {
    if (e.type === 'monster') {
      const k = `${e.kind}:${e.action}`;
      counts[k] = (counts[k] ?? 0) + 1;
    }
  }
}
const ms = performance.now() - t0;
const res = sim.getResult();
const byReason: Record<string, number> = {};
for (const m of sim.getMarbles()) if (m.eliminatedReason) byReason[m.eliminatedReason] = (byReason[m.eliminatedReason] ?? 0) + 1;
console.log(`steps=${steps} raceTime=${res.raceTime.toFixed(1)}s reason=${res.reason} finishers=${res.finishers.length} eliminated=${res.eliminated}`, byReason);
console.log('monster events', counts);
console.log(`wall time ${ms.toFixed(0)} ms`);
sim.destroy();
