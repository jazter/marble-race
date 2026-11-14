/**
 * Measures how much the regroup segments (funnelGate / rotorChamber) bunch the pack up again.
 * For every regroup segment: pack spread  at the moment the 5th marble
 * enters the segment vs the moment the 5th marble leaves it, plus time spreads and dwell times.
 * Usage: npx tsx scripts/gen-regroup.ts [from=1] [to=10] [gravityAngle=0] [count=20] [maxSeconds=150]
 */
import { defaultConfig, SIM_DT } from '../src/core/config';
import { sampleRoster } from '../src/core/fixtures';
import { generateMap } from '../src/gen';
import { createSimulation } from '../src/sim';

const from = Number(process.argv[2] ?? 1);
const to = Number(process.argv[3] ?? 10);
const cfg = defaultConfig();
cfg.physics.gravityAngle = Number(process.argv[4] ?? 0);
cfg.marbles.count = Number(process.argv[5] ?? 20);
const maxSec = Number(process.argv[6] ?? 150);
const K = Number(process.env.K ?? 10); // pack = the first K marbles
const median = (a: number[]): number => (a.length ? [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)] : NaN);
const f = (x: number): string => (Number.isFinite(x) ? x.toFixed(1) : '-');

const rows: { before: number; after: number; tBefore: number; tAfter: number; dwellMed: number; dwellMax: number; type: string; seed: number }[] = [];
let oob = 0;
for (let seed = from; seed <= to; seed++) {
  const map = generateMap(cfg, seed);
  const regs = map.segments.filter((s) => s.type === 'funnelGate' || s.type === 'rotorChamber');
  const n = cfg.marbles.count;
  const tin = regs.map(() => new Array<number>(n).fill(NaN));
  const tout = regs.map(() => new Array<number>(n).fill(NaN));
  // snapshot spreads
  const snapIn: number[] = regs.map(() => NaN);
  const snapOut: number[] = regs.map(() => NaN);
  const cntIn = regs.map(() => 0);
  const cntOut = regs.map(() => 0);
  const sim = createSimulation(map, sampleRoster(n), cfg);
  const total = Math.round(maxSec / SIM_DT);
  for (let i = 0; i < total && !sim.isOver(); i++) {
    sim.step();
    if (i % 6) continue;
    const t = sim.time;
    const ms = sim.getMarbles();
    const prog = ms.filter((m) => m.status === 'racing' || m.status === 'finished').map((m) => m.progress).sort((a, b) => b - a);
    regs.forEach((rg, k) => {
      for (const m of ms) {
        if (m.status === 'eliminated') continue;
        if (Number.isNaN(tin[k][m.id]) && m.progress >= rg.from) {
          tin[k][m.id] = t;
          if (++cntIn[k] === 1) snapIn[k] = prog[0] - prog[K - 1];
        }
        if (Number.isNaN(tout[k][m.id]) && m.progress >= rg.to) {
          tout[k][m.id] = t;
          if (++cntOut[k] === 1) snapOut[k] = prog[0] - prog[K - 1];
        }
      }
    });
  }
  for (const m of sim.getMarbles()) if (m.eliminatedReason === 'outOfBounds') oob++;
  regs.forEach((rg, k) => {
    const ti = tin[k].filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
    const to_ = tout[k].filter((x) => !Number.isNaN(x)).sort((a, b) => a - b);
    const dw: number[] = [];
    for (let id = 0; id < n; id++) if (!Number.isNaN(tin[k][id]) && !Number.isNaN(tout[k][id])) dw.push(tout[k][id] - tin[k][id]);
    const row = {
      seed,
      type: rg.type,
      before: snapIn[k],
      after: snapOut[k],
      tBefore: ti.length >= K ? ti[K - 1] - ti[0] : NaN,
      tAfter: to_.length >= K ? to_[K - 1] - to_[0] : NaN,
      dwellMed: median(dw),
      dwellMax: dw.length ? Math.max(...dw) : NaN,
    };
    rows.push(row);
    console.log(
      `seed ${seed} ${rg.type.padEnd(12)} pack extent 1st-K when LEADER enters ${f(row.before)}m when LEADER leaves ${f(row.after)}m | time 1st->Kth in ${f(row.tBefore)}s out ${f(row.tAfter)}s | dwell med ${f(row.dwellMed)}s max ${f(row.dwellMax)}s (in ${ti.length}, out ${to_.length}/${n})`,
    );
  });
}
const ok = rows.filter((r) => Number.isFinite(r.before) && Number.isFinite(r.after) && Number.isFinite(r.tBefore) && Number.isFinite(r.tAfter));
const avg = (a: number[]): number => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
for (const type of ['funnelGate', 'rotorChamber', 'all']) {
  const r = ok.filter((x) => type === 'all' || x.type === type);
  console.log(
    `${type.padEnd(12)} n=${r.length} avg pack extent at leader-in ${f(avg(r.map((x) => x.before)))}m leader-out ${f(avg(r.map((x) => x.after)))}m | avg time 1st->Kth in ${f(avg(r.map((x) => x.tBefore)))}s out ${f(avg(r.map((x) => x.tAfter)))}s | smaller (extent) in ${r.filter((x) => x.after < x.before).length}/${r.length} | dwell median ${f(median(r.map((x) => x.dwellMed)))}s, worst max ${f(Math.max(...r.map((x) => x.dwellMax)))}s`,
  );
}
console.log('outOfBounds eliminations:', oob);
