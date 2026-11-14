/**
 * DEV ONLY: `?monsters-demo` page. Renders the mock monsters in a loop with the real
 * Renderer. Imported dynamically from main.ts behind `import.meta.env.DEV`, so it is
 * stripped from the production build.
 *
 * URL params:
 *   focus=spider|octopus|fish|snake|all   camera target (default all)
 *   t=<seconds>                          freeze the mock timeline at that time
 *   w=<metres>                           camera width
 *   speed=<x>                            timeline speed (default 1)
 *   preview                              draw the map preview (no sim) instead
 */
import { defaultConfig } from '../core/config';
import { sampleMap } from '../core/fixtures';
import type { MapDef } from '../core/types';
import type { Simulation } from '../sim/api';
import type { Renderer } from '../render/renderer';
import { MOCK_MONSTERS, mockEvents, mockFrame } from './mockMonsters';

const FOCUS: Record<string, { x: number; y: number; w: number }> = {
  spider: { x: -8, y: 16.5, w: 12 },
  octopus: { x: 4, y: 20, w: 16 },
  fish: { x: 0, y: 34, w: 22 },
  snake: { x: 0, y: 49, w: 24 },
  all: { x: 0, y: 32, w: 70 },
};

export function startMonstersDemo(renderer: Renderer, canvas: HTMLCanvasElement): void {
  const q = new URLSearchParams(location.search);
  const focusName = q.get('focus') ?? 'all';
  const f = FOCUS[focusName] ?? FOCUS.all;
  const w = Number(q.get('w')) || f.w;
  const speed = Number(q.get('speed')) || 1;
  const frozen = q.has('t') ? Number(q.get('t')) : null;
  const previewOnly = q.has('preview');

  const cfg = defaultConfig();
  const map: MapDef = { ...sampleMap(16, cfg.marbles.radius), monsters: MOCK_MONSTERS };
  renderer.setConfig(cfg);
  renderer.setMap(map);
  document.body.classList.add('monsters-demo');
  renderer.nameTags = false;
  for (const id of ['welcome', 'progress', 'error', 'preview-bar', 'hud']) document.getElementById(id)?.classList.remove('show');

  let time = frozen ?? 0;
  let last = performance.now();
  let pending: ReturnType<typeof mockEvents> = [];
  const sim = {
    map,
    config: cfg,
    get time() {
      return time;
    },
    getCamera: () => ({ x: f.x, y: f.y, width: w, height: (w * 9) / 16 }),
    getMarbles: () => mockFrame(time).marbles,
    getMechanismPoses: () => [],
    getOpenGates: () => [],
    getSwitchStates: () => [],
    getMonsterStates: () => mockFrame(time).states,
    drainEvents: () => {
      const e = pending;
      pending = [];
      return e;
    },
  } as unknown as Simulation;

  (window as unknown as { __demo: unknown }).__demo = {
    setTime: (t: number) => {
      time = t;
    },
  };

  const frame = (now: number): void => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (previewOnly) {
      renderer.renderPreview(map);
    } else {
      const prev = time;
      if (frozen === null) time += dt * speed;
      if (frozen === null) pending.push(...mockEvents(prev, time));
      renderer.render(sim, dt, sim.drainEvents());
    }
    requestAnimationFrame(frame);
  };
  void canvas;
  requestAnimationFrame(frame);
}
