/**
 * Filmstrip of a regroup segment during a race: PNG with N frames (marbles + live propeller pose).
 * Usage: PREVIEW_DIR=dir npx tsx scripts/gen-regroup-frames.ts seed [regroupIndex=0] [frames=8] [dt=0.75] [gravityAngle=0] [count=20]
 * Frames start when the first racing marble enters the segment.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { defaultConfig, SIM_DT } from '../src/core/config';
import { sampleRoster } from '../src/core/fixtures';
import { generateMap } from '../src/gen';
import { createSimulation } from '../src/sim';
import { rotate } from '../src/core/math';
import type { LocalShape, Vec } from '../src/core/types';
const { chromium } = createRequire(import.meta.url)('playwright');

const seed = Number(process.argv[2] ?? 1);
const idx = Number(process.argv[3] ?? 0);
const nFrames = Number(process.argv[4] ?? 8);
const dt = Number(process.argv[5] ?? 0.75);
const ga = Number(process.argv[6] ?? 0);
const count = Number(process.argv[7] ?? 20);
const OUT = process.env.PREVIEW_DIR ?? 'screenshots/gen-preview';
const cfg = defaultConfig();
cfg.physics.gravityAngle = ga;
cfg.marbles.count = count;
const map = generateMap(cfg, seed);
const regs = map.segments.filter((s) => s.type === 'funnelGate' || s.type === 'rotorChamber');
const rg = regs[idx];
const mech = map.mechanisms.filter((m) => m.id.startsWith('regroup'))[idx];
const sim = createSimulation(map, sampleRoster(count), cfg);
// region around the rotor
const c = mech.pivot;
const half = 9;
const S = 22;
const frames: string[] = [];
let started = false;
let next = 0;
for (let i = 0; i < 160 / SIM_DT && frames.length < nFrames; i++) {
  sim.step();
  if (!started && sim.getMarbles().some((m) => m.status === 'racing' && m.progress >= rg.from)) {
    started = true;
    next = sim.time;
  }
  if (!started || sim.time < next) continue;
  next += dt;
  const X = (x: number): string => ((x - c.x + half) * S).toFixed(1);
  const Y = (y: number): string => ((y - c.y + half) * S).toFixed(1);
  const pts = (a: Vec[]): string => a.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ');
  let o = '';
  for (const w of map.walls) {
    const s = w.shape;
    const col = w.boundary ? '#6b7a99' : '#c9d1e0';
    if (s.type === 'polyline') o += `<polyline points="${pts(s.points)}" fill="none" stroke="${col}" stroke-width="${s.thickness * S}" stroke-linejoin="round" stroke-linecap="round"/>`;
    else if (s.type === 'circle') o += `<circle cx="${X(s.center.x)}" cy="${Y(s.center.y)}" r="${s.radius * S}" fill="${col}"/>`;
  }
  const pose = sim.getMechanismPoses().find((p) => p.id === mech.id)!;
  const lp = pose.links[0];
  const T = (p: Vec): Vec => { const r = rotate(p, lp.angle); return { x: lp.x + r.x, y: lp.y + r.y }; };
  for (const sh of mech.links[0].shapes as LocalShape[]) {
    if (sh.type === 'circle') o += `<circle cx="${X(T({ x: sh.cx, y: sh.cy }).x)}" cy="${Y(T({ x: sh.cx, y: sh.cy }).y)}" r="${sh.r * S}" fill="#fff"/>`;
    else if (sh.type === 'box') {
      const q = [{ x: -sh.hw, y: -sh.hh }, { x: sh.hw, y: -sh.hh }, { x: sh.hw, y: sh.hh }, { x: -sh.hw, y: sh.hh }].map((p) => { const r = rotate(p, sh.angle); return T({ x: r.x + sh.cx, y: r.y + sh.cy }); });
      o += `<polygon points="${pts(q)}" fill="#ffcc33"/>`;
    }
  }
  for (const m of sim.getMarbles()) {
    if (m.status !== 'racing') continue;
    if (Math.abs(m.x - c.x) > half + 2 || Math.abs(m.y - c.y) > half + 2) continue;
    o += `<circle cx="${X(m.x)}" cy="${Y(m.y)}" r="${m.radius * S}" fill="#4fd1ff" fill-opacity=".8" stroke="#fff" stroke-width=".5"/><text x="${X(m.x)}" y="${Y(m.y)}" font-size="9" fill="#000" text-anchor="middle">${m.id}</text>`;
  }
  const w = 2 * half * S;
  frames.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${w}"><rect width="100%" height="100%" fill="${map.theme.background}"/>${o}<text x="6" y="16" fill="#fff" font-size="13">t+${(sim.time - (next - dt * frames.length - dt) ).toFixed(1)} ${rg.type}</text></svg>`);
}
const cols = 4;
const rows = Math.ceil(frames.length / cols);
const w = 2 * half * S;
const html = `<body style="margin:0;background:#000;display:grid;grid-template-columns:repeat(${cols},${w}px);gap:2px">${frames.join('')}</body>`;
mkdirSync(OUT, { recursive: true });
writeFileSync(`${OUT}/frames_s${seed}_r${idx}.html`, html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: cols * (w + 2), height: rows * (w + 2) } });
await page.setContent(html);
await page.screenshot({ path: `${OUT}/frames_s${seed}_g${ga}_r${idx}.png` });
await browser.close();
console.log(`${OUT}/frames_s${seed}_g${ga}_r${idx}.png`, rg.type);
