/** Usage: npx tsx scripts/gen-monsters.ts [from=1] [to=10] [gravityAngle=0] [marbles=20] [monsters=default] [groupSize=default]
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
if (process.argv[7] !== undefined) cfg.monsters.groupSize = Number(process.argv[7]);
const per: Record<string, { n: number; groups: number; grab: number; release: number; devour: number }> = {};
let totalMonsters = 0;
let totalFinishers = 0;
const groupKey = (m: NonNullable<ReturnType<typeof generateMap>['monsters']>[number]): string =>
  m.kind === 'fish' ? `f${m.speed}${m.rest}` : m.kind === 'snake' ? `s${JSON.stringify(m.passes[0])}` : m.kind === 'spider' ? `p${Math.round(m.anchor.y / 10)}` : m.id;
let ok = 0;
for (let s = from; s <= to; s++) {
  const map = generateMap(cfg, s);
  const sim = createSimulation(map, sampleRoster(cfg.marbles.count), cfg);
  const ev: Record<string, number> = {};
  const kindOf = new Map((map.monsters ?? []).map((m) => [m.id, m.kind]));
  const seen = new Set<string>();
  for (const m of map.monsters ?? []) {
    const e = (per[m.kind] ??= { n: 0, groups: 0, grab: 0, release: 0, devour: 0 });
    e.n++;
    if (!seen.has(groupKey(m))) (seen.add(groupKey(m)), e.groups++);
  }
  totalMonsters += (map.monsters ?? []).length;
  let steps = 0;
  while (!sim.isOver() && steps < 120 * 400) {
    sim.step();
    steps++;
    for (const e of sim.drainEvents()) if (e.type === 'monster') { const k = kindOf.get(e.monsterId) ?? e.kind; (per[k] as Record<string, number>)[e.action]++; ev[`${k}:${e.action}`] = (ev[`${k}:${e.action}`] ?? 0) + 1; }
  }
  const r = sim.getResult();
  totalFinishers += r.finishers.length;
  if (r.finishers.length > 0) ok++;
  console.log(`seed ${s}: finishers=${r.finishers.length} t=${r.raceTime.toFixed(0)}s reason=${r.reason}`, (map.monsters ?? []).map((m) => m.kind).join(','), JSON.stringify(ev));
  sim.destroy();
}
console.log(`races with finishers ${ok}/${to - from + 1}  monsters/map=${(totalMonsters / (to - from + 1)).toFixed(1)}  finishers/race=${(totalFinishers / (to - from + 1)).toFixed(1)}`);
for (const [k, v] of Object.entries(per)) console.log(k.padEnd(8), `members=${v.n} groups=${v.groups} grabs/group/race=${(v.grab / Math.max(1, v.groups)).toFixed(2)} grabs/member/race=${(v.grab / v.n).toFixed(2)} release=${v.release} devour=${v.devour}`);
