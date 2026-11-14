/**
 * Audits the generated courses for (1) slanted ramps whose gaps line up on the same side
 * (marbles fall straight through both), (2) consecutive chicanes shifting to the same side
 * and (3) free-fall stretches: the longest vertical distance a marble can fall in a straight
 * column without touching any wall / peg / mechanism.
 * Usage: npx tsx scripts/gen-alignment.ts [from=1] [to=50] [verbose=0]
 */
import { defaultConfig } from '../src/core/config';
import { analyzeAlignment, boundaryChains } from '../src/gen/analysis';
import { generateMap } from '../src/gen';
import { mechReach } from '../src/gen/monsters';
import type { MapDef, Vec } from '../src/core/types';

const from = Number(process.argv[2] ?? 1);
const to = Number(process.argv[3] ?? 50);
const verbose = process.argv[4] === '1';
const cfg = defaultConfig();
cfg.physics.gravityAngle = 0;
const r = cfg.marbles.radius;

interface Prim {
  /** segment a-b (a == b for a circle) inflated by rad */
  a: Vec;
  b: Vec;
  rad: number;
  minX: number;
  maxX: number;
}

function prims(map: MapDef): Prim[] {
  const out: Prim[] = [];
  const add = (a: Vec, b: Vec, rad: number): void => {
    out.push({ a, b, rad, minX: Math.min(a.x, b.x) - rad, maxX: Math.max(a.x, b.x) + rad });
  };
  for (const w of map.walls) {
    if (/^b\d+$/.test(w.id)) continue;
    const s = w.shape;
    if (s.type === 'circle') add(s.center, s.center, s.radius + r);
    else if (s.type === 'polyline') for (let i = 0; i < s.points.length - 1; i++) add(s.points[i], s.points[i + 1], s.thickness / 2 + r);
    else for (let i = 0; i < s.points.length; i++) add(s.points[i], s.points[(i + 1) % s.points.length], r);
  }
  for (const g of map.gates) {
    if (g.role === 'start') continue;
    if (g.shape.type === 'polygon') for (let i = 0; i < g.shape.points.length; i++) add(g.shape.points[i], g.shape.points[(i + 1) % g.shape.points.length], r);
  }
  for (const m of map.mechanisms) add(m.pivot, m.pivot, mechReach(m) + r);
  return out;
}

function distSeg(px: number, py: number, a: Vec, b: Vec): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((px - a.x) * dx + (py - a.y) * dy) / l2));
  return Math.hypot(px - a.x - dx * t, py - a.y - dy * t);
}

function xAt(chain: Vec[], y: number): number {
  if (y <= chain[0].y) return chain[0].x;
  for (let i = 0; i < chain.length - 1; i++) {
    const a = chain[i];
    const b = chain[i + 1];
    if (y <= b.y) return b.y - a.y < 1e-9 ? b.x : a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
  }
  return chain[chain.length - 1].x;
}

/** Longest free vertical run (m) over all sampled columns, and where it is (y of its start). */
function freeFall(map: MapDef): { longest: number; y: number; over: number; colMean: number } {
  const ps = prims(map);
  const ch = boundaryChains(map);
  const yStart = 0.6;
  const yEnd = map.finish.a.y;
  const bh = 0.25;
  const hw = (xAt(ch.right, 5) - xAt(ch.left, 5)) / 2;
  const x0 = -hw;
  let best = 0;
  let bestY = 0;
  let over = 0;
  let colSum = 0;
  let colN = 0;
  for (let x = x0 - 12; x <= x0 + 2 * hw + 12; x += 0.2) {
    const near = ps.filter((p) => x >= p.minX && x <= p.maxX);
    let run = 0;
    let runStart = yStart;
    let colBest = 0;
    const close = (yy: number): void => {
      colBest = Math.max(colBest, run);
      if (run > best) (best = run), (bestY = runStart);
      if (run > 14) over++;
      void yy;
      run = 0;
    };
    for (let y = yStart; y <= yEnd; y += 0.1) {
      const inside = x >= xAt(ch.left, y) + bh + r && x <= xAt(ch.right, y) - bh - r;
      let free = inside;
      if (free) for (const p of near) if (distSeg(x, y, p.a, p.b) < p.rad) { free = false; break; }
      if (free) {
        if (run === 0) runStart = y;
        run += 0.1;
      } else close(y);
    }
    close(yEnd);
    if (Math.abs(x) <= hw - bh - r) (colSum += colBest), colN++;
  }
  return { longest: best, y: bestY, over, colMean: colSum / Math.max(1, colN) };
}

let aligned = 0;
let ramps = 0;
let same = 0;
let chic = 0;
const falls: number[] = [];
const overs: number[] = [];
const colMeans: number[] = [];
for (let seed = from; seed <= to; seed++) {
  const map = generateMap(cfg, seed);
  const rep = analyzeAlignment(map);
  const ff = freeFall(map);
  aligned += rep.aligned.length;
  ramps += rep.ramps;
  same += rep.sameDirChicanes;
  chic += rep.chicanes;
  falls.push(ff.longest);
  overs.push(ff.over);
  colMeans.push(ff.colMean);
  if (verbose || rep.aligned.length || rep.sameDirChicanes)
    console.log(`seed ${seed}: ramps ${rep.ramps} aligned ${rep.aligned.length} chicanes ${rep.chicanes} sameDir ${rep.sameDirChicanes} longest free fall ${ff.longest.toFixed(1)}m @y=${ff.y.toFixed(0)}` + (rep.aligned.length ? ` [aligned at y ${rep.aligned.map((p) => p.a.low.toFixed(0)).join(',')}]` : ''));
}
const n = to - from + 1;
const sorted = [...falls].sort((a, b) => a - b);
console.log(`seeds ${from}..${to}: ramps ${ramps}, aligned same-gap-side ramp pairs ${aligned}, chicanes ${chic}, same-direction consecutive chicanes ${same}`);
console.log(
  `free-fall (longest straight column per map): mean ${(falls.reduce((a, b) => a + b, 0) / n).toFixed(1)}m  median ${sorted[Math.floor(n / 2)].toFixed(1)}m  p90 ${sorted[Math.floor(n * 0.9)].toFixed(1)}m  max ${sorted[n - 1].toFixed(1)}m  | sampled columns (0.2 m apart) with a >14m fall, per map ${(overs.reduce((a, b) => a + b, 0) / n).toFixed(1)}`,
);
console.log(
  `free-fall (mean over columns of each column's longest straight fall, nominal corridor): ${(colMeans.reduce((a, b) => a + b, 0) / n).toFixed(1)}m`,
);
