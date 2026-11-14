import { sampleConfig, sampleMap, sampleRoster } from '../src/core/fixtures';
import { createSimulation } from '../src/sim';

const n = Number(process.argv[2] ?? 20);
const cfg = sampleConfig(n);
const map = sampleMap(n, cfg.marbles.radius);
const roster = sampleRoster(n);
const sim = createSimulation(map, roster, cfg);
const t0 = performance.now();
let steps = 0;
while (!sim.isOver() && steps < 120 * 400) {
  sim.step();
  steps++;
}
const ms = performance.now() - t0;
const res = sim.getResult();
const byReason: Record<string, number> = {};
for (const m of sim.getMarbles()) if (m.eliminatedReason) byReason[m.eliminatedReason] = (byReason[m.eliminatedReason] ?? 0) + 1;
console.log(`marbles=${n} steps=${steps} simTime=${sim.time.toFixed(1)}s raceTime=${res.raceTime.toFixed(1)}s over=${res.over} reason=${res.reason}`);
console.log(`finishers=${res.finishers.length} first=${res.finishers[0]?.time.toFixed(2)}s eliminated=${res.eliminated}`, byReason);
console.log(`wall time ${ms.toFixed(0)} ms (${(ms / (steps / 120)).toFixed(0)} ms per sim second)`);
const evc: Record<string, number> = {};
for (const e of sim.drainEvents()) { const k = e.type === 'effect' ? 'effect:' + e.effect : e.type; evc[k] = (evc[k] ?? 0) + 1; }
console.log('events', evc);
sim.destroy();
