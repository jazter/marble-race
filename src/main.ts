import './style.css';
import { SIM_DT, defaultConfig, type GameConfig } from './core/config';
import { cumulativeLengths } from './core/math';
import { MusicDirector } from './audio/director';
import { MusicEngine } from './audio/music';
import { sampleMap } from './core/fixtures';
import { Renderer } from './render/renderer';
import { createSimulation } from './sim';
import type { Simulation } from './sim';
import { generateValidatedRace, type ValidatedRace } from './validate/validator';
import { ConfigPanel } from './ui/configPanel';
import { $, el } from './ui/dom';
import { Hud } from './ui/hud';
import { hidePodium, showPodium } from './ui/podium';
import { initSoundControls } from './ui/sound';
import { clearSavedConfig, loadAudioSettings, loadConfig, saveAudioSettings, saveConfig } from './ui/storage';

type Mode = 'idle' | 'generating' | 'error' | 'preview' | 'race';

const SPEEDS = [0.5, 1, 2, 4, 8];

let config: GameConfig = loadConfig();
let mode: Mode = 'idle';
let race: ValidatedRace | null = null;
let raceConfig: GameConfig | null = null;
let sim: Simulation | null = null;
let hud: Hud | null = null;
let abort: AbortController | null = null;
let paused = false;
let speed = 1;
let acc = 0;
let configDirty = false;
let podiumTimer: number | undefined;
let podiumShown = false;
let director: MusicDirector | null = null;

const music = new MusicEngine(loadAudioSettings());
initSoundControls(music, saveAudioSettings);

const canvas = $<HTMLCanvasElement>('game');
const renderer = new Renderer(canvas, config, $<HTMLCanvasElement>('minimap'));
const idleMap = sampleMap(12, config.marbles.radius);

/* ------------------------------------------------------------ panel */

const panel = new ConfigPanel($('config-sections'), config, (c) => {
  saveConfig(c);
  if (mode === 'preview' || mode === 'race') {
    configDirty = true;
    updatePreviewInfo();
  }
});

const openPanel = () => document.body.classList.add('panel-open');
const closePanel = () => document.body.classList.remove('panel-open');
$('btn-open-panel').addEventListener('click', openPanel);
$('btn-close-panel').addEventListener('click', closePanel);

$('btn-reset').addEventListener('click', () => {
  clearSavedConfig();
  config = defaultConfig();
  panel.setConfig(config);
  saveConfig(config);
  if (mode === 'preview' || mode === 'race') configDirty = true;
  updatePreviewInfo();
});

/* ------------------------------------------------------------ modes */

function setMode(m: Mode): void {
  mode = m;
  document.body.className = document.body.className.replace(/\bmode-\w+/g, '').trim() + ` mode-${m}`;
  $('welcome').classList.toggle('show', m === 'idle');
  $('progress').classList.toggle('show', m === 'generating');
  $('error').classList.toggle('show', m === 'error');
  $('preview-bar').classList.toggle('show', m === 'preview');
  $('hud').classList.toggle('show', m === 'race');
  if (m !== 'race') {
    hidePodium();
    director = null;
    music.calm();
  }
}

/* ------------------------------------------------------- generation */

const progressLine = $('progress-line');
const progressBar = $('progress-bar');
const progressLog = $('progress-log');

async function generate(randomSeed = false): Promise<void> {
  if (mode === 'generating') return;
  if (randomSeed) {
    config.seed = 1 + Math.floor(Math.random() * 999999);
    panel.refresh();
    saveConfig(config);
  }
  closePanel();
  disposeRace();
  const cfg: GameConfig = structuredClone(config);
  abort = new AbortController();
  progressLog.innerHTML = '';
  progressLine.textContent = 'Preparando…';
  progressBar.style.width = '0%';
  setMode('generating');
  const rejected: string[] = [];
  try {
    const vr = await generateValidatedRace(cfg, {
      signal: abort.signal,
      onProgress: (p) => {
        const sim = p.phase === 'simulating' ? ` · simulando ${p.simTime.toFixed(1)} s` : p.phase === 'generating' ? ' · generando mapa' : '';
        progressLine.textContent = `Intento ${p.attempt}/${p.maxAttempts} · semilla ${p.seed}${sim}`;
        progressBar.style.width = `${Math.min(100, ((p.attempt - 1 + (p.phase === 'simulating' ? 0.5 : 0)) / p.maxAttempts) * 100)}%`;
        if (p.phase === 'rejected') {
          const text = `Semilla ${p.seed}: ${p.reason ?? 'rechazada'}`;
          rejected.push(text);
          progressLog.append(el('li', {}, text));
          progressLog.scrollTop = progressLog.scrollHeight;
        }
      },
    });
    race = vr;
    raceConfig = cfg;
    configDirty = false;
    renderer.setConfig(cfg);
    renderer.setMap(vr.map);
    setMode('preview');
    updatePreviewInfo();
  } catch (err) {
    if (abort?.signal.aborted || (err as Error)?.name === 'AbortError') {
      setMode(race ? 'preview' : 'idle');
      return;
    }
    $('error-msg').textContent = (err as Error)?.message ?? 'Error desconocido';
    const log = $('error-log');
    log.innerHTML = '';
    for (const r of rejected.slice(-30)) log.append(el('li', {}, r));
    setMode('error');
  } finally {
    abort = null;
  }
}

$('btn-generate').addEventListener('click', () => void generate());
$('btn-generate-2').addEventListener('click', () => void generate());
$('btn-other').addEventListener('click', () => void generate(true));
$('btn-cancel').addEventListener('click', () => abort?.abort());
$('btn-error-retry').addEventListener('click', () => void generate(true));
$('btn-error-config').addEventListener('click', () => {
  setMode(race ? 'preview' : 'idle');
  openPanel();
});

function updatePreviewInfo(): void {
  const info = $('preview-info');
  if (!race || mode !== 'preview') return;
  info.innerHTML = '';
  const add = (label: string, value: string) => info.append(el('span', {}, [`${label}: `, el('b', {}, value)]));
  add('Semilla aceptada', String(race.seed));
  add('Intentos', String(race.attempts));
  add('Primera llegada en validación', `≈ ${race.firstFinishTime.toFixed(1)} s`);
  add('Canicas', String(race.roster.length));
  if (configDirty) info.append(el('span', { class: 'warn' }, 'La configuración cambió: genera de nuevo para aplicarla.'));
}

/* ------------------------------------------------------------- race */

function disposeRace(): void {
  window.clearTimeout(podiumTimer);
  podiumShown = false;
  director = null;
  hud?.destroy();
  hud = null;
  sim?.destroy();
  sim = null;
}

function startRace(): void {
  if (!race || !raceConfig) return;
  window.clearTimeout(podiumTimer);
  podiumShown = false;
  hidePodium();
  hud?.destroy();
  sim?.destroy();
  sim = createSimulation(race.map, race.roster, raceConfig);
  hud = new Hud(race.map, race.roster);
  renderer.setConfig(raceConfig);
  renderer.setMap(race.map);
  renderer.resetVisuals();
  paused = false;
  acc = 0;
  $('btn-pause').textContent = '❚❚';
  const cum = cumulativeLengths(race.map.path);
  director = new MusicDirector(music, cum[cum.length - 1] ?? 0);
  music.startCountdown();
  setMode('race');
}

$('btn-start').addEventListener('click', startRace);
$('btn-restart').addEventListener('click', startRace);
$('btn-new').addEventListener('click', () => {
  disposeRace();
  void generate(true);
});
$('btn-fit').addEventListener('click', () => renderer.previewFit());

function togglePause(): void {
  if (mode !== 'race') return;
  paused = !paused;
  $('btn-pause').textContent = paused ? '▶' : '❚❚';
  music.setPaused(paused);
}
$('btn-pause').addEventListener('click', togglePause);

const speedsEl = $('speeds');
for (const sp of SPEEDS) {
  const b = el('button', { type: 'button', 'data-speed': String(sp) }, `${sp}×`);
  b.addEventListener('click', () => setSpeed(sp));
  speedsEl.append(b);
}
function setSpeed(sp: number): void {
  speed = sp;
  speedsEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', Number(b.getAttribute('data-speed')) === sp));
}
setSpeed(1);

$('btn-names').addEventListener('click', () => {
  renderer.nameTags = !renderer.nameTags;
  $('btn-names').style.opacity = renderer.nameTags ? '1' : '0.45';
});
$('btn-lb').addEventListener('click', () => $('leaderboard').classList.toggle('collapsed'));
if (window.matchMedia('(max-width: 800px)').matches) $('leaderboard').classList.add('collapsed');

window.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName) && e.code === 'Space') return;
  if (e.code === 'Space' && mode === 'race') {
    e.preventDefault();
    togglePause();
  }
});

function showResult(): void {
  if (!sim || !race || podiumShown) return;
  podiumShown = true;
  const result = sim.getResult();
  podiumTimer = window.setTimeout(() => {
    if (mode !== 'race') return;
    showPodium(result, race!.roster, raceConfig!.race.podiumSize, {
      onRepeat: startRace,
      onNew: () => {
        disposeRace();
        void generate(true);
      },
      onConfig: () => {
        hidePodium();
        openPanel();
      },
    });
  }, 1800);
}

/* ------------------------------------------------------------- loop */

let last = performance.now();
function frame(now: number): void {
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  if (mode === 'race' && sim && hud) {
    if (!paused && !sim.isOver()) {
      acc += dt * speed;
      let steps = Math.floor(acc / SIM_DT);
      acc -= steps * SIM_DT;
      if (steps > 32) steps = 32;
      sim.stepMany(steps);
    }
    const events = sim.drainEvents();
    director?.update(sim, events);
    renderer.render(sim, paused ? 0 : dt, events);
    hud.update(sim, events);
    if (sim.isOver()) showResult();
  } else if (mode === 'preview' && race) {
    renderer.renderPreview(race.map, race.roster);
  } else if (mode === 'idle' || mode === 'generating' || mode === 'error') {
    renderer.renderPreview(race ? race.map : idleMap);
  }
  requestAnimationFrame(frame);
}

/* ----------------------------------------------- preview interaction */

const pointers = new Map<number, { x: number; y: number }>();
canvas.addEventListener('pointerdown', (e) => {
  if (mode !== 'preview') return;
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
});
canvas.addEventListener('pointermove', (e) => {
  const p = pointers.get(e.pointerId);
  if (!p || mode !== 'preview') return;
  if (pointers.size === 1) renderer.previewPan(e.clientX - p.x, e.clientY - p.y);
  else if (pointers.size === 2) {
    const other = [...pointers.entries()].find(([id]) => id !== e.pointerId)![1];
    const before = Math.hypot(p.x - other.x, p.y - other.y);
    const after = Math.hypot(e.clientX - other.x, e.clientY - other.y);
    if (before > 0) renderer.previewZoomAt(after / before, (e.clientX + other.x) / 2 - canvas.getBoundingClientRect().left, (e.clientY + other.y) / 2 - canvas.getBoundingClientRect().top);
  }
  p.x = e.clientX;
  p.y = e.clientY;
});
const endPointer = (e: PointerEvent) => pointers.delete(e.pointerId);
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
canvas.addEventListener(
  'wheel',
  (e) => {
    if (mode !== 'preview') return;
    e.preventDefault();
    const r = canvas.getBoundingClientRect();
    renderer.previewZoomAt(Math.exp(-e.deltaY * 0.0015), e.clientX - r.left, e.clientY - r.top);
  },
  { passive: false },
);

new ResizeObserver(() => renderer.resize()).observe(canvas);
setMode('idle');
requestAnimationFrame(frame);
