/** Usage: npx tsx scripts/gen-monsters.ts [from=1] [to=10] [gravityAngle=0] [marbles=20] [monsters=default]
 *  Runs full races on generated maps and reports grabs / releases / devours per monster. */
import { defaultConfig } from '../src/core/config';
import { sampleRoster } from '../src/core/fixtures';
import { generateMap } from '../src/gen';
import { createSimulation } from '../src/sim';

const from = Number(process.argv[2] ?? 1);
const to = Number(process.argv[3] ?? 10);
const cfg = defaultConfig();
cfg.physics.gravityAngle = Number(process.argv[4] ?? 0);
cfg.marbles.count = Number(process.argv[5] ?? 20);
if (process.argv[6] !== undefined) cfg.monsters.count = Number(process.argv[6]);
const per: Record<string, { n: number; grab: number; release: number; devour: number }> = {};
let ok = 0;
for (let s = from; s <= to; s++) {
  const map = generateMap(cfg, s);
  const sim = createSimulation(map, sampleRoster(cfg.marbles.count), cfg);
  const ev: Record<string, number> = {};
  const kindOf = new Map((map.monsters ?? []).map((m) => [m.id, m.kind]));
  for (const m of map.monsters ?? []) (per[m.kind] ??= { n: 0, grab: 0, release: 0, devour: 0 }).n++;
  let steps = 0;
  while (!sim.isOver() && steps < 120 * 400) {
    sim.step();
    steps++;
    for (const e of sim.drainEvents()) if (e.type === 'monster') { const k = kindOf.get(e.monsterId) ?? e.kind; per[k][e.action]++; ev[`${k}:${e.action}`] = (ev[`${k}:${e.action}`] ?? 0) + 1; }
  }
  const r = sim.getResult();
  if (r.finishers.length > 0) ok++;
  console.log(`seed ${s}: finishers=${r.finishers.length} t=${r.raceTime.toFixed(0)}s reason=${r.reason}`, (map.monsters ?? []).map((m) => m.kind).join(','), JSON.stringify(ev));
  sim.destroy();
}
console.log(`races with finishers ${ok}/${to - from + 1}`);
for (const [k, v] of Object.entries(per)) console.log(k.padEnd(8), `placed=${v.n} grabs/monster/race=${(v.grab / v.n).toFixed(2)} release=${v.release} devour=${v.devour}`);
