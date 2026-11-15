/**
 * DEV ONLY: `?flipper-demo` page. Runs the REAL simulation on a tiny map with two flippers
 * (a left and a right one) and a few marbles, drawn with the real Renderer. Imported
 * dynamically from main.ts behind `import.meta.env.DEV` (stripped from production builds).
 *
 * URL params: w=<metres camera width>, drops=<n marbles>, steps=<n> (run n steps then freeze).
 * `window.__flip.step(n)` advances manually and `__flip.freeze()` stops the loop.
 */
import { defaultConfig, SIM_DT } from '../core/config';
import { sampleMap, sampleRoster } from '../core/fixtures';
import type { Mechanism, MapDef, Vec } from '../core/types';
import { createSimulation } from '../sim';
import type { Renderer } from '../render/renderer';

function flipper(id: string, pivot: Vec, dir: 1 | -1): Mechanism {
  const len = 2;
  const p = (x: number, y: number): Vec => ({ x: x * dir, y });
  return {
    id,
    kind: 'flipper',
    pivot,
    links: [
      {
        shapes: [
          { type: 'circle', cx: 0, cy: 0, r: 0.3 },
          { type: 'polygon', points: [p(0, -0.3), p(len, -0.14), p(len, 0.14), p(0, 0.3)] },
          { type: 'circle', cx: len * dir, cy: 0, r: 0.14 },
        ],
        motion: { type: 'flipper', rest: 0.45 * dir, up: -0.5 * dir, upSpeed: 6, downSpeed: 4, hold: 0.12, cooldown: 0.35 },
      },
    ],
    effect: null,
  };
}

export function startFlipperDemo(renderer: Renderer): void {
  const q = new URLSearchParams(location.search);
  const w = Number(q.get('w')) || 16;
  const n = Number(q.get('drops')) || 6;
  const cfg = defaultConfig();
  cfg.marbles.count = n;
  cfg.race.countdown = 0.3;
  cfg.camera.offscreenKill = false;
  cfg.race.unstuck = false;
  const base = sampleMap(n, cfg.marbles.radius);
  const spawns: Vec[] = Array.from({ length: n }, (_, i) => ({ x: -5.2 + i * 1.7, y: 2 - (i % 2) * 1.2 }));
  const map: MapDef = {
    ...base,
    seed: 3,
    bounds: { minX: -30, minY: -30, maxX: 30, maxY: 60 },
    path: [
      { x: 0, y: 0 },
      { x: 0, y: 40 },
    ],
    walls: [
      { id: 'l', reaction: 'solid', style: 'wall', shape: { type: 'polyline', thickness: 0.5, points: [{ x: -7, y: -10 }, { x: -7, y: 20 }] } },
      { id: 'r', reaction: 'solid', style: 'wall', shape: { type: 'polyline', thickness: 0.5, points: [{ x: 7, y: -10 }, { x: 7, y: 20 }] } },
    ],
    gates: [],
    zones: [],
    switches: [],
    monsters: [],
    mechanisms: [flipper('fl', { x: -4.5, y: 9 }, 1), flipper('fr', { x: 4.5, y: 9 }, -1)],
    start: { spawnPoints: spawns, area: [] },
    finish: { a: { x: -5, y: 50 }, b: { x: 5, y: 50 }, sensor: [] },
    segments: [],
  };
  const sim = createSimulation(map, sampleRoster(n), cfg);
  const view = Object.create(sim) as typeof sim;
  view.getCamera = () => ({ x: 0, y: 6, width: w, height: (w * 9) / 16 });
  renderer.setConfig(cfg);
  renderer.setMap(map);
  document.body.classList.add('monsters-demo');
  renderer.nameTags = false;
  for (const id of ['welcome', 'progress', 'error', 'preview-bar', 'hud']) document.getElementById(id)?.classList.remove('show');

  let running = true;
  let acc = 0;
  let last = performance.now();
  const stepN = (k: number): void => {
    for (let i = 0; i < k; i++) sim.step();
  };
  (window as unknown as { __flip: unknown }).__flip = {
    step: (k: number) => {
      stepN(k);
      renderer.render(view, k * SIM_DT, sim.drainEvents());
    },
    freeze: () => (running = false),
    sim,
  };
  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (running) {
      acc += dt;
      const k = Math.floor(acc / SIM_DT);
      acc -= k * SIM_DT;
      stepN(k);
      renderer.render(view, dt, sim.drainEvents());
    }
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
