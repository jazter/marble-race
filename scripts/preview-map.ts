/** Usage: npx tsx scripts/preview-map.ts [seed] [gravityAngle] [count] [monsters] -> PNG tiles in $PREVIEW_DIR (default screenshots/gen-preview) */
import { mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
// Playwright is a dev-only tool here (global or local install).
const { chromium } = createRequire(import.meta.url)('playwright');
const OUT_DIR = process.env.PREVIEW_DIR ?? 'screenshots/gen-preview';
import { defaultConfig } from '../src/core/config';
import { generateMap } from '../src/gen';
import type { MapDef, Vec, LocalShape } from '../src/core/types';
import { rotate } from '../src/core/math';

const seed = Number(process.argv[2] ?? 1);
const ga = Number(process.argv[3] ?? 0);
const count = Number(process.argv[4] ?? 20);
const cfg = defaultConfig();
if (process.argv[5] !== undefined) cfg.monsters.count = Number(process.argv[5]);
cfg.physics.gravityAngle = ga;
cfg.marbles.count = count;
const map: MapDef = generateMap(cfg, seed);

const S = 14; // px per metre
const b = map.bounds;
const X = (x: number) => ((x - b.minX) * S).toFixed(1);
const Y = (y: number) => ((y - b.minY) * S).toFixed(1);
const pts = (a: Vec[]) => a.map((p) => `${X(p.x)},${Y(p.y)}`).join(' ');
const col: Record<string, string> = { solid: '#c9d1e0', bounce: '#4fd1ff', slow: '#d9a441', kill: '#ff4d4d', launch: '#6bff6b' };
let o = '';
const flowAng = Math.atan2(map.flowDir.x, map.flowDir.y); // canonical y-down -> rotate local by -ga
void flowAng;
for (const w of map.walls) {
  const c = w.boundary ? (w.reaction === 'solid' ? '#6b7a99' : col[w.reaction]) : col[w.reaction];
  const s = w.shape;
  if (s.type === 'polyline') o += `<polyline points="${pts(s.points)}" fill="none" stroke="${c}" stroke-width="${s.thickness * S}" stroke-linejoin="round" stroke-linecap="round"/>`;
  else if (s.type === 'polygon') o += `<polygon points="${pts(s.points)}" fill="${c}"/>`;
  else o += `<circle cx="${X(s.center.x)}" cy="${Y(s.center.y)}" r="${s.radius * S}" fill="${c}"/>`;
  if (w.launchDir && s.type !== 'circle') {
    const p = s.points[0];
    o += `<line x1="${X(p.x)}" y1="${Y(p.y)}" x2="${X(p.x + w.launchDir.x * 2)}" y2="${Y(p.y + w.launchDir.y * 2)}" stroke="#6bff6b"/>`;
  }
}
for (const g of map.gates) if (g.shape.type === 'polygon') o += `<polygon points="${pts(g.shape.points)}" fill="${g.role === 'start' ? '#ffaa00' : '#ff00ff'}"/>`;
for (const z of map.zones) {
  const c = { grow: '#3f3', shrink: '#f6f', attract: '#39f', repel: '#f93', destroy: '#f33' }[z.effect];
  if (z.shape.type === 'circle') o += `<circle cx="${X(z.shape.center.x)}" cy="${Y(z.shape.center.y)}" r="${z.shape.radius * S}" fill="${c}" fill-opacity=".3" stroke="${c}"/>`;
}
const ecol: Record<string, string> = { grow: '#3f3', shrink: '#f6f', attract: '#39f', repel: '#f93', destroy: '#f33' };
function shapeSvg(sh: LocalShape, pos: Vec, ang: number, fill: string): string {
  const T = (p: Vec) => { const r = rotate(p, ang); return { x: pos.x + r.x, y: pos.y + r.y }; };
  if (sh.type === 'circle') { const c = T({ x: sh.cx, y: sh.cy }); return `<circle cx="${X(c.x)}" cy="${Y(c.y)}" r="${sh.r * S}" fill="${fill}"/>`; }
  if (sh.type === 'polygon') return `<polygon points="${pts(sh.points.map(T))}" fill="${fill}"/>`;
  const q = [{ x: -sh.hw, y: -sh.hh }, { x: sh.hw, y: -sh.hh }, { x: sh.hw, y: sh.hh }, { x: -sh.hw, y: sh.hh }].map((p) => { const r = rotate(p, sh.angle); return T({ x: r.x + sh.cx, y: r.y + sh.cy }); });
  return `<polygon points="${pts(q)}" fill="${fill}"/>`;
}
for (const m of map.mechanisms) {
  const fill = m.effect ? ecol[m.effect] : '#e8e8e8';
  let pos = m.pivot; let ang = 0;
  m.links.forEach((l, i) => {
    const mo = l.motion;
    const rel = mo.type === 'rotate' ? mo.phase : mo.type === 'flipper' ? mo.rest : mo.center + mo.amplitude * Math.sin(mo.phase);
    ang += rel;
    if (mo.type === 'flipper') {
      o += l.shapes.map((s) => shapeSvg(s, pos, mo.up, '#ff9f1c')).join('').replace(/fill="#ff9f1c"/g, 'fill="#ff9f1c" fill-opacity=".25"');
      o += l.shapes.map((s) => shapeSvg(s, pos, ang, '#ff9f1c')).join('') + `<circle cx="${X(pos.x)}" cy="${Y(pos.y)}" r="4" fill="#fff"/>`;
    } else o += l.shapes.map((s) => shapeSvg(s, pos, ang, fill)).join('');
    if (l.tip) { const t = rotate(l.tip, ang); pos = { x: pos.x + t.x, y: pos.y + t.y }; }
    if (i === m.links.length - 1 && m.fieldRadius && m.fieldAnchor) {
      const a = rotate(m.fieldAnchor, ang);
      o += `<circle cx="${X(pos.x + a.x)}" cy="${Y(pos.y + a.y)}" r="${m.fieldRadius * S}" fill="none" stroke="${fill}" stroke-dasharray="4 3"/>`;
    }
  });
}
for (const s of map.switches) {
  const w = s.halfWidth, h = s.halfHeight;
  const q = [{ x: -w, y: -h }, { x: w, y: -h }, { x: w, y: h }, { x: -w, y: h }].map((p) => { const r = rotate(p, s.angle); return { x: s.position.x + r.x, y: s.position.y + r.y }; });
  o += `<polygon points="${pts(q)}" fill="#ffee00" stroke="#000" stroke-width=".5"/><text x="${X(s.position.x + 1)}" y="${Y(s.position.y - 1)}" fill="#ffee00" font-size="11">${s.label}${s.action.gateId ? ' ->' + s.action.gateId : ''}</text>`;
}
for (const m of map.monsters ?? []) {
  const lab = (p: Vec, t: string) => `<text x="${X(p.x + 0.6)}" y="${Y(p.y - 0.6)}" fill="#ff8a8a" font-size="11">${t}</text>`;
  if (m.kind === 'spider') {
    const rest = { x: m.anchor.x + m.down.x * m.restLength, y: m.anchor.y + m.down.y * m.restLength };
    const mx = { x: m.anchor.x + m.down.x * m.maxLength, y: m.anchor.y + m.down.y * m.maxLength };
    const perp = { x: -m.down.y, y: m.down.x };
    const q = [1, -1].map((sg) => ({ x: mx.x + perp.x * m.huntWidth * sg, y: mx.y + perp.y * m.huntWidth * sg }));
    const t = [1, -1].map((sg) => ({ x: m.anchor.x + perp.x * m.huntWidth * sg, y: m.anchor.y + perp.y * m.huntWidth * sg }));
    o += `<polygon points="${pts([t[0], q[0], q[1], t[1]])}" fill="#ff0" fill-opacity=".12"/>`;
    o += `<line x1="${X(m.anchor.x)}" y1="${Y(m.anchor.y)}" x2="${X(mx.x)}" y2="${Y(mx.y)}" stroke="#ff0" stroke-dasharray="3 3"/>`;
    o += `<line x1="${X(m.anchor.x)}" y1="${Y(m.anchor.y)}" x2="${X(rest.x)}" y2="${Y(rest.y)}" stroke="#fff" stroke-width="2"/>`;
    o += `<circle cx="${X(rest.x)}" cy="${Y(rest.y)}" r="${m.size * S}" fill="#a0f" stroke="#fff"/><circle cx="${X(m.anchor.x)}" cy="${Y(m.anchor.y)}" r="3" fill="#fff"/>` + lab(m.anchor, 'spider');
  } else if (m.kind === 'octopus') {
    o += `<circle cx="${X(m.center.x)}" cy="${Y(m.center.y)}" r="${m.reach * S}" fill="#f0a" fill-opacity=".08" stroke="#f0a" stroke-dasharray="4 3"/>`;
    o += `<circle cx="${X(m.center.x)}" cy="${Y(m.center.y)}" r="${m.bodyRadius * S}" fill="#c3a" stroke="#fff"/>`;
    const hx = m.center.x + Math.cos(m.facing) * m.bodyRadius, hy = m.center.y + Math.sin(m.facing) * m.bodyRadius;
    o += `<circle cx="${X(hx)}" cy="${Y(hy)}" r="4" fill="#fff"/>` + lab(m.center, 'octopus');
  } else if (m.kind === 'fish') {
    o += `<line x1="${X(m.a.x)}" y1="${Y(m.a.y)}" x2="${X(m.b.x)}" y2="${Y(m.b.y)}" stroke="#4fd" stroke-width="2"/>`;
    o += `<circle cx="${X(m.a.x)}" cy="${Y(m.a.y)}" r="${m.size * S}" fill="#4fd" fill-opacity=".5"/><circle cx="${X(m.b.x)}" cy="${Y(m.b.y)}" r="${m.size * S}" fill="none" stroke="#4fd"/>` + lab(m.a, 'fish');
  } else {
    for (const q of m.passes) o += `<line x1="${X(q.a.x)}" y1="${Y(q.a.y)}" x2="${X(q.b.x)}" y2="${Y(q.b.y)}" stroke="#7f4" stroke-width="2"/><circle cx="${X(q.a.x)}" cy="${Y(q.a.y)}" r="${m.size * S}" fill="#7f4" fill-opacity=".4"/><circle cx="${X(q.b.x)}" cy="${Y(q.b.y)}" r="${m.size * S}" fill="none" stroke="#7f4"/>`;
    o += lab(m.passes[0].a, 'snake');
  }
}
for (const p of map.start.spawnPoints) o += `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="${cfg.marbles.radius * S}" fill="#fff" fill-opacity=".7"/>`;
o += `<line x1="${X(map.finish.a.x)}" y1="${Y(map.finish.a.y)}" x2="${X(map.finish.b.x)}" y2="${Y(map.finish.b.y)}" stroke="#0f0" stroke-width="3"/>`;
o += `<polyline points="${pts(map.path)}" fill="none" stroke="#f0f" stroke-width="1" stroke-dasharray="3 3"/>`;
o += map.path.map((p) => `<circle cx="${X(p.x)}" cy="${Y(p.y)}" r="1.5" fill="#f0f"/>`).join('');
const Wd = Math.ceil((b.maxX - b.minX) * S), Hd = Math.ceil((b.maxY - b.minY) * S);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${Wd}" height="${Hd}" viewBox="0 0 ${Wd} ${Hd}"><rect width="100%" height="100%" fill="${map.theme.background}"/>${o}</svg>`;
mkdirSync(OUT_DIR, { recursive: true });
const base = `${OUT_DIR}/s${seed}_g${ga}_n${count}`;
writeFileSync(base + '.svg', svg);
console.log('segments', map.segments.map((s) => `${s.type}[${s.from.toFixed(0)}-${s.to.toFixed(0)}]`).join(' '));
console.log('size', Wd, Hd, 'walls', map.walls.length, 'mechs', map.mechanisms.length, 'switches', map.switches.length, 'zones', map.zones.length);
const browser = await chromium.launch();
if (process.env.CROP) {
  // CROP=pinball -> one PNG of the first segment of that type
  const sg = map.segments.find((x) => x.type === process.env.CROP);
  if (sg) {
    const cum = [0];
    for (let i = 1; i < map.path.length; i++) cum.push(cum[i - 1] + Math.hypot(map.path[i].x - map.path[i - 1].x, map.path[i].y - map.path[i - 1].y));
    const ps = map.path.filter((_, i) => cum[i] >= sg.from - 1 && cum[i] <= sg.to + 1);
    const x0 = Math.max(0, Math.floor((Math.min(...ps.map((p) => p.x)) - 14 - b.minX) * S));
    const y0 = Math.max(0, Math.floor((Math.min(...ps.map((p) => p.y)) - 4 - b.minY) * S));
    const x1 = Math.min(Wd, Math.ceil((Math.max(...ps.map((p) => p.x)) + 14 - b.minX) * S));
    const y1 = Math.min(Hd, Math.ceil((Math.max(...ps.map((p) => p.y)) + 4 - b.minY) * S));
    const pg = await browser.newPage({ viewport: { width: Wd, height: Hd }, deviceScaleFactor: 1 });
    await pg.setContent(`<body style="margin:0;background:#000">${svg}</body>`);
    await pg.screenshot({ path: `${base}_${process.env.CROP}.png`, clip: { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }, fullPage: true });
    console.log(`${base}_${process.env.CROP}.png`);
  }
  await browser.close();
  process.exit(0);
}
const tileH = 1500;
const tiles = Math.ceil(Hd / tileH);
const page = await browser.newPage({ viewport: { width: Wd, height: Math.min(tileH, Hd) }, deviceScaleFactor: 1 });
await page.setContent(`<body style="margin:0;background:#000">${svg}</body>`);
for (let i = 0; i < tiles; i++) {
  await page.screenshot({ path: `${base}_${i}.png`, clip: { x: 0, y: i * tileH, width: Wd, height: Math.min(tileH, Hd - i * tileH) }, fullPage: true });
  console.log(`${base}_${i}.png`);
}
await browser.close();
