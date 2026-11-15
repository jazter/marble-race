/**
 * Races seeds from..to (default config, gravityAngle 0) and measures:
 *  - pinball: flipper fires per race, time marbles spend inside the segment (mean / max), marbles that never left
 *  - gableSplit: left / right traffic, eliminations per lane, mean transit time per lane, trap sets
 * Usage: npx tsx scripts/gen-pinball.ts [from=1] [to=20] [maxSeconds=170] [count=20]
 */
import { defaultConfig, SIM_DT } from '../src/core/config';
import { createRoster } from '../src/core/roster';
import { cumulativeLengths } from '../src/core/math';
import { generateMap } from '../src/gen';
import { gableLog } from '../src/gen/pinball';
import { createSimulation } from '../src/sim';
import type { MapDef } from '../src/core/types';

const from = Number(process.argv[2] ?? 1);
const to = Number(process.argv[3] ?? 20);
const maxSec = Number(process.argv[4] ?? 170);
const cfg = defaultConfig();
cfg.physics.gravityAngle = 0;
cfg.race.endMode = 'all';
cfg.marbles.count = Number(process.argv[5] ?? 20);

function yAtArc(map: MapDef, cum: number[], s: number): number {
  for (let i = 0; i < cum.length - 1; i++) if (s <= cum[i + 1]) return map.path[i].y + ((map.path[i + 1].y - map.path[i].y) * (s - cum[i])) / Math.max(1e-9, cum[i + 1] - cum[i]);
  return map.path[map.path.length - 1].y;
}
const avg = (a: number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);
const f1 = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : '-');

const fires: number[] = [];
const allDur: number[] = [];
let stuck = 0;
const ramps: number[] = [];
let gSegs = 0;
let gUnused = 0;
const gElim = { risky: 0, safe: 0 };
const gTraffic = { risky: 0, safe: 0 };
const gTime = { risky: [] as number[], safe: [] as number[] };
const RISKY = new Set(['sierra', 'martillo', 'triangulos', 'asesina', 'impulso']);
for (let seed = from; seed <= to; seed++) {
  const map = generateMap(cfg, seed);
  const cum = cumulativeLengths(map.path);
  const gl = gableLog.map((l) => l.slice());
  const pins: { y0: number; y1: number; tin: Map<number, number> }[] = [];
  const gabs: { y0: number; y1: number; cx: number; yIn: number; tin: Map<number, number>; side: Map<number, number>; k: number }[] = [];
  let gk = 0;
  for (const sg of map.segments) {
    const y0 = yAtArc(map, cum, sg.from);
    const y1 = yAtArc(map, cum, sg.to);
    if (sg.type === 'pinball') pins.push({ y0, y1, tin: new Map() });
    if (sg.type === 'gableSplit') {
      const div = map.walls.find((w) => w.shape.type === 'polygon' && w.shape.points.length === 5 && w.shape.points[0].y >= y0 - 1 && w.shape.points[0].y <= y1);
      const p = div && div.shape.type === 'polygon' ? div.shape.points[0] : { x: 0, y: y0 + 2 };
      gabs.push({ y0, y1, cx: p.x, yIn: p.y + 7, tin: new Map(), side: new Map(), k: gk });
      gk += 2;
    }
  }
  const flipIds = map.mechanisms.filter((m) => m.kind === 'flipper' && pins.some((p) => m.pivot.y >= p.y0 && m.pivot.y <= p.y1)).map((m) => m.id);
  if (!pins.length && !gabs.length) continue;
  const sim = createSimulation(map, createRoster(cfg, seed), cfg);
  const was = new Map<string, boolean>();
  let nf = 0;
  const yDone = Math.max(...pins.map((p) => p.y1 + 1), ...gabs.map((g) => g.y1 + 1));
  const elim = gabs.map(() => [0, 0]);
  const seenElim = new Set<number>();
  const durs: number[] = [];
  const gd = gabs.map(() => [[], []] as number[][]);
  const gc = gabs.map(() => [0, 0]);
  const total = Math.round(maxSec / SIM_DT);
  for (let i = 0; i < total && !sim.isOver(); i++) {
    sim.step();
    for (const mp of sim.getMechanismPoses()) {
      if (!flipIds.includes(mp.id)) continue;
      const a = !!mp.links[0].active;
      if (a && !was.get(mp.id)) nf++;
      was.set(mp.id, a);
    }
    if (i % 4) continue;
    if (i % 240 === 0 && sim.getMarbles().every((m) => m.status === 'eliminated' || m.status === 'finished' || m.y > yDone)) break;
    const t = sim.time;
    for (const m of sim.getMarbles()) {
      if (m.status === 'waiting') continue;
      for (const P of pins) {
        if (!P.tin.has(m.id) && m.y >= P.y0 && m.y < P.y1) P.tin.set(m.id, t);
        else if (P.tin.has(m.id) && P.tin.get(m.id) !== -1 && m.y >= P.y1) {
          durs.push(t - (P.tin.get(m.id) as number));
          P.tin.set(m.id, -1);
        }
      }
      gabs.forEach((G, gi) => {
        if (!G.tin.has(m.id) && m.y >= G.yIn && m.y < G.y1) {
          G.tin.set(m.id, t);
          const s = m.x < G.cx ? 0 : 1;
          G.side.set(m.id, s);
          gc[gi][s]++;
        } else if (G.tin.has(m.id) && G.tin.get(m.id) !== -1 && m.y >= G.y1 - 4) {
          gd[gi][G.side.get(m.id) as number].push(t - (G.tin.get(m.id) as number));
          G.tin.set(m.id, -1);
        }
        if (m.status === 'eliminated' && !seenElim.has(m.id) && m.y >= G.yIn - 2 && m.y <= G.y1 && G.side.has(m.id)) {
          seenElim.add(m.id);
          elim[gi][G.side.get(m.id) as number]++;
        }
      });
    }
  }
  for (const P of pins) for (const [, v] of P.tin) if (v !== -1) stuck++;
  if (pins.length) {
    fires.push(nf);
    allDur.push(...durs);
    console.log(`seed ${seed} pinball: fires ${nf}, marbles ${durs.length}/${cfg.marbles.count} passed, time mean ${f1(avg(durs))}s max ${f1(Math.max(...durs))}s`);
  }
  gabs.forEach((G, gi) => {
    gSegs++;
    const sets = [gl[G.k] ?? [], gl[G.k + 1] ?? []];
    const rIdx = sets[0].some((t) => RISKY.has(t)) ? 0 : 1;
    const sIdx = 1 - rIdx;
    if (gc[gi][0] === 0 || gc[gi][1] === 0) gUnused++;
    gTraffic.risky += gc[gi][rIdx];
    gTraffic.safe += gc[gi][sIdx];
    gElim.risky += elim[gi][rIdx];
    gElim.safe += elim[gi][sIdx];
    gTime.risky.push(...gd[gi][rIdx]);
    gTime.safe.push(...gd[gi][sIdx]);
    console.log(`seed ${seed} gableSplit: traffic L/R ${gc[gi].join('/')} elim L/R ${elim[gi].join('/')} transit L/R ${f1(avg(gd[gi][0]))}/${f1(avg(gd[gi][1]))}s | L=${sets[0].join('+')} R=${sets[1].join('+')}`);
  });
}
console.log(`pinball: races ${fires.length}, flipper fires/race mean ${f1(avg(fires))} (min ${Math.min(...fires)}), time inside mean ${f1(avg(allDur))}s max ${f1(Math.max(...allDur))}s, marbles still inside at end ${stuck}`);
console.log(`gableSplit: segments ${gSegs}, with an unused lane ${gUnused}, traffic risky/safe ${gTraffic.risky}/${gTraffic.safe}, eliminations risky/safe ${gElim.risky}/${gElim.safe}, transit risky ${f1(avg(gTime.risky))}s safe ${f1(avg(gTime.safe))}s`);
void ramps;
