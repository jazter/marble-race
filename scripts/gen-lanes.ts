/**
 * Races seeds from..to (default config, gravityAngle 0) and measures, for every `lanes` segment, how many marbles
 * go through each lane and the mean transit time per lane (slowest / fastest ratio); also the longest time any
 * marble spends inside a `galton` segment.
 * Usage: npx tsx scripts/gen-lanes.ts [from=1] [to=20] [maxSeconds=170] [count=20]
 */
import { defaultConfig, SIM_DT } from '../src/core/config';
import { createRoster } from '../src/core/roster';
import { cumulativeLengths } from '../src/core/math';
import { generateMap } from '../src/gen';
import { laneLog } from '../src/gen/boards';
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

interface LaneSeg {
  seed: number;
  y0: number;
  y1: number;
  /** lane edges: xs[k]..xs[k+1] */
  xs: number[];
  yIn: number;
  yOut: number;
  tin: Map<number, number>;
  lane: Map<number, number>;
  trans: number[][];
}
interface GalSeg {
  seed: number;
  y0: number;
  y1: number;
  tin: Map<number, number>;
  dur: number[];
}

const ratios: number[] = [];
const styleT: Record<string, number[]> = {};
const laneCount: number[][] = []; // by n lanes: traffic per lane (sum)
let unused = 0;
let totalSegs = 0;
let galMax = 0;
let galAll: number[] = [];
let galUnfinished = 0;
for (let seed = from; seed <= to; seed++) {
  const map = generateMap(cfg, seed);
  const cum = cumulativeLengths(map.path);
  const logs = laneLog.map((l) => l.slice());
  const lanes: LaneSeg[] = [];
  const gals: GalSeg[] = [];
  for (const sg of map.segments) {
    const y0 = yAtArc(map, cum, sg.from);
    const y1 = yAtArc(map, cum, sg.to);
    if (sg.type === 'galton') gals.push({ seed, y0, y1, tin: new Map(), dur: [] });
    if (sg.type === 'lanes') {
      const divs = map.walls.filter((w) => w.shape.type === 'polygon' && w.shape.points.length === 5 && w.shape.points[0].y >= y0 - 1 && w.shape.points[0].y <= y1);
      const dx = divs.map((w) => (w.shape.type === 'polygon' ? w.shape.points[0].x : 0)).sort((a, b) => a - b);
      const yTop = Math.min(...divs.map((w) => (w.shape.type === 'polygon' ? w.shape.points[0].y : 0)));
      const yBot = Math.max(...divs.map((w) => (w.shape.type === 'polygon' ? w.shape.points[2].y : 0)));
      lanes.push({ seed, y0, y1, xs: [-1e9, ...dx, 1e9], yIn: yTop + 1.2, yOut: yBot, tin: new Map(), lane: new Map(), trans: dx.map(() => []).concat([[]]) });
    }
  }
  if (lanes.length === 0 && gals.length === 0) continue;
  const sim = createSimulation(map, createRoster(cfg, seed), cfg);
  const total = Math.round(maxSec / SIM_DT);
  const yDone = Math.max(...lanes.map((l) => l.yOut + 12), ...gals.map((g) => g.y1 + 1));
  for (let i = 0; i < total && !sim.isOver(); i++) {
    sim.step();
    if (i % 4) continue;
    if (i % 240 === 0 && sim.getMarbles().every((m) => m.status === 'eliminated' || m.status === 'finished' || m.y > yDone)) break;
    const t = sim.time;
    for (const m of sim.getMarbles()) {
      if (m.status === 'waiting') continue;
      for (const L of lanes) {
        if (!L.tin.has(m.id) && m.y >= L.yIn && m.y < L.yOut) {
          L.tin.set(m.id, t);
          let k = 0;
          while (k + 1 < L.xs.length - 1 && m.x > L.xs[k + 1]) k++;
          L.lane.set(m.id, k);
        } else if (L.tin.has(m.id) && L.lane.has(m.id) && m.y >= L.yOut) {
          L.trans[L.lane.get(m.id) as number].push(t - (L.tin.get(m.id) as number));
          L.lane.delete(m.id);
        }
      }
      for (const G of gals) {
        if (!G.tin.has(m.id) && m.y >= G.y0 && m.y < G.y1) G.tin.set(m.id, t);
        else if (G.tin.has(m.id) && m.y >= G.y1 && G.tin.get(m.id) !== -1) {
          G.dur.push(t - (G.tin.get(m.id) as number));
          G.tin.set(m.id, -1);
        }
      }
    }
  }
  for (const G of gals) {
    for (const [, v] of G.tin) if (v !== -1) galUnfinished++;
    galAll = galAll.concat(G.dur);
    galMax = Math.max(galMax, ...G.dur);
    console.log(`seed ${seed} galton: ${G.dur.length}/${cfg.marbles.count} marbles passed, transit max ${Math.max(...G.dur).toFixed(1)}s mean ${(G.dur.reduce((a, b) => a + b, 0) / G.dur.length).toFixed(1)}s`);
  }
  lanes.forEach((L, li) => {
    totalSegs++;
    const cnt = L.trans.map((x) => x.length);
    const means = L.trans.map((x) => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : NaN));
    const valid = means.filter((m) => Number.isFinite(m));
    const ratio = valid.length >= 2 ? Math.max(...valid) / Math.min(...valid) : NaN;
    if (Number.isFinite(ratio)) ratios.push(ratio);
    if (cnt.some((c) => c === 0)) unused++;
    (laneCount[cnt.length] ??= []).push(...cnt);
    console.log(`seed ${seed} lanes n=${cnt.length}: traffic [${cnt.join(', ')}] mean transit [${means.map((m) => (Number.isFinite(m) ? m.toFixed(1) : '-')).join(', ')}]s ratio ${Number.isFinite(ratio) ? ratio.toFixed(2) : '-'} | ${(logs[li] ?? []).join(',')}`);
    (logs[li] ?? []).forEach((st, k) => {
      if (Number.isFinite(means[k])) (styleT[st] ??= []).push(means[k]);
    });
  });
}
const avg = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
console.log(`lanes segments ${totalSegs}; with an unused lane ${unused}; mean slowest/fastest transit ratio ${avg(ratios).toFixed(2)} (min ${Math.min(...ratios).toFixed(2)})`);
console.log(`galton: marbles ${galAll.length}, max time inside ${galMax.toFixed(1)}s, mean ${avg(galAll).toFixed(1)}s, still inside at end ${galUnfinished}`);

for (const [k, v] of Object.entries(styleT)) console.log(`style ${k.padEnd(10)} lanes ${String(v.length).padStart(3)} mean transit ${avg(v).toFixed(1)}s max ${Math.max(...v).toFixed(1)}s`);
