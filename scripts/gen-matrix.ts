/**
 * Solvability across several configurations (seeds from..to each).
 * Usage: npx tsx scripts/gen-matrix.ts [from=1] [to=15]
 */
import { defaultConfig, type GameConfig } from '../src/core/config';
import { createRoster } from '../src/core/roster';
import { generateMap } from '../src/gen';
import { runValidation } from '../src/validate/validator';

const from = Number(process.argv[2] ?? 1);
const to = Number(process.argv[3] ?? 15);

const variants: [string, (c: GameConfig) => void][] = [
  ['default', () => {}],
  ['1 marble', (c) => (c.marbles.count = 1)],
  ['100 marbles', (c) => (c.marbles.count = 100)],
  ['gravity 35deg', (c) => (c.physics.gravityAngle = 35)],
  ['gravity -90deg (sideways)', (c) => (c.physics.gravityAngle = -90)],
  ['hard (difficulty 1, density 1)', (c) => { c.map.difficulty = 1; c.objects.density = 1; }],
  ['solid boundary walls', (c) => (c.walls.boundary = 'solid')],
  ['mixed boundary walls', (c) => (c.walls.boundary = 'mixed')],
  ['launch boundary walls', (c) => (c.walls.boundary = 'launch')],
  ['kill boundary walls', (c) => (c.walls.boundary = 'kill')],
  ['minFinishers 3', (c) => (c.race.minFinishers = 3)],
];

for (const [name, mutate] of variants) {
  const cfg = defaultConfig();
  mutate(cfg);
  let pass = 0;
  const times: number[] = [];
  const reasons: Record<string, number> = {};
  const t0 = Date.now();
  for (let s = from; s <= to; s++) {
    try {
      const map = generateMap(cfg, s);
      const r = runValidation(map, createRoster(cfg, s), cfg);
      if (r.ok) { pass++; times.push(r.firstFinishTime); } else reasons[r.reason] = (reasons[r.reason] ?? 0) + 1;
    } catch (e) {
      reasons['error: ' + (e as Error).message] = (reasons['error: ' + (e as Error).message] ?? 0) + 1;
    }
  }
  const n = to - from + 1;
  const avg = times.length ? (times.reduce((a, b) => a + b, 0) / times.length).toFixed(0) : '-';
  console.log(`${name.padEnd(32)} pass ${String(pass).padStart(2)}/${n}  avg first ${avg}s  (${((Date.now() - t0) / 1000).toFixed(0)}s)`, Object.keys(reasons).length ? reasons : '');
}
