/**
 * Find marbles that get stuck: racing, not held by a monster, and staying within 0.5 m for
 * more than 6 s. Reports per segment type.
 * Usage: npx tsx scripts/gen-stalls.ts [from=1] [to=20] [gravity=9.8]
 */
import { defaultConfig } from '../src/core/config';
import { createRoster } from '../src/core/roster';
import { generateMap } from '../src/gen';
import { createSimulation } from '../src/sim';

const from = Number(process.argv[2] ?? 1);
const to = Number(process.argv[3] ?? 20);
const gravity = Number(process.argv[4] ?? 9.8);
const bySeg: Record<string, number> = {};
let stalls = 0;
for (let seed = from; seed <= to; seed++) {
  const cfg = defaultConfig();
  cfg.physics.gravity = gravity;
  const map = generateMap(cfg, seed);
  const sim = createSimulation(map, createRoster(cfg, seed), cfg);
  const anchor = new Map<number, { x: number; y: number; t: number; reported: boolean }>();
  while (!sim.isOver() && sim.time < 200) {
    sim.stepMany(12); // 0.1 s
    sim.drainEvents();
    for (const m of sim.getMarbles()) {
      if (m.status !== 'racing' || m.heldBy !== undefined) {
        anchor.delete(m.id);
        continue;
      }
      const a = anchor.get(m.id);
      if (!a || Math.hypot(m.x - a.x, m.y - a.y) > 0.5) {
        anchor.set(m.id, { x: m.x, y: m.y, t: sim.time, reported: false });
      } else if (!a.reported && sim.time - a.t > 6) {
        a.reported = true;
        stalls++;
        const seg = map.segments.find((g) => m.progress >= g.from - 0.5 && m.progress <= g.to + 0.5)?.type ?? '?';
        bySeg[seg] = (bySeg[seg] ?? 0) + 1;
        console.log(`seed ${seed} t=${sim.time.toFixed(1)} stuck in ${seg} at (${m.x.toFixed(1)}, ${m.y.toFixed(1)})`);
      }
    }
  }
  sim.destroy();
}
console.log(`stalls ${stalls} over seeds ${from}-${to} (gravity ${gravity})`, bySeg);
