/** Usage: npx tsx scripts/gen-solvability.ts [from=1] [to=30] [gravityAngle=0] [count=20] */
import { defaultConfig } from '../src/core/config';
import { sampleRoster } from '../src/core/fixtures';
import { generateMap } from '../src/gen';
import { runValidation } from '../src/validate/validator';

const from = Number(process.argv[2] ?? 1);
const to = Number(process.argv[3] ?? 30);
const cfg = defaultConfig();
cfg.physics.gravityAngle = Number(process.argv[4] ?? 0);
cfg.marbles.count = Number(process.argv[5] ?? 20);
if (process.argv[6] !== undefined) cfg.monsters.count = Number(process.argv[6]);
let pass = 0;
const reasons: Record<string, number> = {};
const times: number[] = [];
for (let s = from; s <= to; s++) {
  const map = generateMap(cfg, s);
  const t0 = Date.now();
  const r = runValidation(map, sampleRoster(cfg.marbles.count), cfg);
  const types = map.segments.map((x) => x.type).join(',');
  console.log(`seed ${s}: ${r.ok ? 'OK ' : 'FAIL'} first=${r.firstFinishTime.toFixed(1)}s fin=${r.finishers} sim=${r.simSeconds.toFixed(0)}s (${Date.now() - t0}ms) ${r.ok ? '' : r.reason} | ${types}`);
  if (r.ok) { pass++; times.push(r.firstFinishTime); } else reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
}
const n = to - from + 1;
console.log(`pass ${pass}/${n} = ${((100 * pass) / n).toFixed(0)}%`, reasons);
if (times.length) console.log('first-finish times: min', Math.min(...times).toFixed(0), 'avg', (times.reduce((a, b) => a + b, 0) / times.length).toFixed(0), 'max', Math.max(...times).toFixed(0));
