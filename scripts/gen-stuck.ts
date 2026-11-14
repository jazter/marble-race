/** Usage: npx tsx scripts/gen-stuck.ts seed gravityAngle count seconds : prints where marbles are after N seconds (canonical y) */
import { defaultConfig, SIM_DT } from '../src/core/config';
import { sampleRoster } from '../src/core/fixtures';
import { generateMap } from '../src/gen';
import { createSimulation } from '../src/sim';
import { rotate, DEG } from '../src/core/math';
const [seed, ga, count, secs] = process.argv.slice(2).map(Number);
const cfg = defaultConfig(); cfg.physics.gravityAngle = ga; cfg.marbles.count = count;
const map = generateMap(cfg, seed);
const sim = createSimulation(map, sampleRoster(count), cfg);
sim.stepMany(Math.round(secs / SIM_DT));
for (const m of sim.getMarbles()) {
  const c = rotate({ x: m.x, y: m.y }, ga * DEG);
  console.log(m.id, m.status, 'canon', c.x.toFixed(1), c.y.toFixed(1), 'v', Math.hypot(m.vx, m.vy).toFixed(2), 'r', m.radius.toFixed(2), m.eliminatedReason ?? '');
}
console.log(map.segments.map((s) => s.type + ':' + s.from.toFixed(0)).join(' '));
console.log('mechs', map.mechanisms.map((m) => `${m.kind}@${rotate(m.pivot, ga * DEG).y.toFixed(0)}:${m.effect}`).join(' '));
