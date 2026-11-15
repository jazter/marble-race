/**
 * Schema-driven configuration panel. Every GameConfig option is exposed here.
 */
import type { GameConfig } from '../core/config';
import { el } from './dom';

type Opt = [value: string, label: string];

interface Common {
  label: string;
  path: string;
  hint?: string;
  enabledIf?: (c: GameConfig) => boolean;
}
type Field =
  | (Common & { kind: 'range'; min: number; max: number; step: number; unit?: string; percent?: boolean; decimals?: number })
  | (Common & { kind: 'select'; options: Opt[] })
  | (Common & { kind: 'checks'; options: Opt[] })
  | (Common & { kind: 'toggle' })
  | (Common & { kind: 'angle' })
  | (Common & { kind: 'seed' });

interface Section {
  title: string;
  icon: string;
  open?: boolean;
  fields: Field[];
}

const REACTIONS: Opt[] = [
  ['solid', 'Sólida'],
  ['bounce', 'Rebote'],
  ['slow', 'Lenta'],
  ['kill', 'Eliminar'],
  ['launch', 'Lanzar'],
];

const monstersOn = (c: GameConfig): boolean => c.monsters.count > 0 && Object.values(c.monsters.kinds).some(Boolean);

export const SECTIONS: Section[] = [
  {
    title: 'Canicas',
    icon: '🔮',
    open: true,
    fields: [
      { kind: 'range', label: 'Cantidad', path: 'marbles.count', min: 1, max: 200, step: 1 },
      { kind: 'range', label: 'Tamaño (radio)', path: 'marbles.radius', min: 0.15, max: 1, step: 0.01, unit: ' m', decimals: 2 },
      {
        kind: 'checks',
        label: 'Aspectos (skins)',
        path: 'marbles.skins',
        options: [
          ['solid', 'Sólido'],
          ['bicolor', 'Bicolor'],
          ['tricolor', 'Tricolor'],
          ['striped', 'Rayada'],
          ['multicolor', 'Arcoíris'],
          ['silver', 'Plata'],
          ['gold', 'Oro'],
          ['glass', 'Cristal'],
        ],
      },
      { kind: 'range', label: 'Rebote', path: 'marbles.restitution', min: 0, max: 1, step: 0.01, decimals: 2 },
      { kind: 'range', label: 'Fricción', path: 'marbles.friction', min: 0, max: 1, step: 0.01, decimals: 2 },
      { kind: 'range', label: 'Densidad', path: 'marbles.density', min: 0.2, max: 5, step: 0.1, decimals: 1 },
      { kind: 'range', label: 'Escala mínima', path: 'marbles.minScale', min: 0.2, max: 1, step: 0.05, unit: '×', decimals: 2, hint: 'Límite al achicarse' },
      { kind: 'range', label: 'Escala máxima', path: 'marbles.maxScale', min: 1, max: 4, step: 0.1, unit: '×', decimals: 1, hint: 'Límite al agrandarse' },
    ],
  },
  {
    title: 'Apariencia',
    icon: '🎨',
    fields: [
      {
        kind: 'select',
        label: 'Fondo',
        path: 'display.background',
        hint: 'Solo visual; se aplica al instante',
        options: [
          ['auto', 'Automático'],
          ['sea', 'Fondo del mar'],
          ['space', 'Espacio'],
          ['clouds', 'Nubes'],
          ['dinosaurs', 'Dinosaurios'],
          ['castle', 'Castillo'],
        ],
      },
      { kind: 'toggle', label: 'Mantener la pantalla encendida', path: 'display.keepAwake', hint: 'Evita que el teléfono o la tablet se apague durante el mapa y la carrera' },
    ],
  },
  {
    title: 'Física',
    icon: '🌍',
    fields: [
      { kind: 'range', label: 'Gravedad', path: 'physics.gravity', min: 0, max: 30, step: 0.1, unit: ' m/s²', decimals: 1 },
      { kind: 'angle', label: 'Dirección de gravedad', path: 'physics.gravityAngle' },
      { kind: 'range', label: 'Viento: fuerza', path: 'physics.windStrength', min: 0, max: 20, step: 0.1, unit: ' m/s²', decimals: 1 },
      { kind: 'angle', label: 'Viento: dirección', path: 'physics.windAngle' },
      { kind: 'range', label: 'Impulso de salida', path: 'physics.launchStrength', min: 0, max: 10, step: 0.1, unit: ' m/s', decimals: 1 },
      { kind: 'range', label: 'Amortiguamiento', path: 'physics.linearDamping', min: 0, max: 2, step: 0.01, decimals: 2 },
    ],
  },
  {
    title: 'Paredes',
    icon: '🧱',
    fields: [
      { kind: 'select', label: 'Reacción de paredes exteriores', path: 'walls.boundary', options: [['mixed', 'Mixta'], ...REACTIONS] },
      {
        kind: 'checks',
        label: 'Tipos de paredes especiales',
        path: 'walls.special',
        options: [
          ['bounce', 'Rebote'],
          ['slow', 'Lenta'],
          ['kill', 'Eliminar'],
          ['launch', 'Lanzar'],
        ],
      },
      { kind: 'range', label: 'Proporción de especiales', path: 'walls.specialRatio', min: 0, max: 1, step: 0.01, percent: true },
      { kind: 'range', label: 'Rebote (paredes de rebote)', path: 'walls.bounceRestitution', min: 0.5, max: 2, step: 0.01, decimals: 2 },
      { kind: 'range', label: 'Lentitud (paredes lentas)', path: 'walls.slowFactor', min: 0, max: 1, step: 0.01, percent: true },
      { kind: 'range', label: 'Lanzamiento (paredes de lanzar)', path: 'walls.launchStrength', min: 0, max: 40, step: 0.5, unit: ' m/s', decimals: 1 },
    ],
  },
  {
    title: 'Objetos',
    icon: '⚙️',
    fields: [
      {
        kind: 'checks',
        label: 'Tipos de mecanismo',
        path: 'objects.kinds',
        options: [
          ['propeller', 'Hélice'],
          ['arm2', 'Brazo doble'],
          ['saw', 'Sierra'],
          ['triangle', 'Triángulo'],
          ['hammer', 'Martillo'],
          ['flipper', 'Paletas de pinball'],
        ],
      },
      {
        kind: 'checks',
        label: 'Efectos',
        path: 'objects.effects',
        options: [
          ['grow', 'Agrandar'],
          ['shrink', 'Achicar'],
          ['destroy', 'Destruir'],
          ['attract', 'Atraer'],
          ['repel', 'Repeler'],
        ],
      },
      { kind: 'range', label: 'Densidad de objetos', path: 'objects.density', min: 0, max: 1, step: 0.01, percent: true },
      { kind: 'range', label: 'Velocidad', path: 'objects.speed', min: 0.2, max: 3, step: 0.05, unit: '×', decimals: 2 },
      { kind: 'range', label: 'Probabilidad de efecto', path: 'objects.effectChance', min: 0, max: 1, step: 0.01, percent: true },
      { kind: 'toggle', label: 'Zonas con efecto', path: 'objects.zones' },
    ],
  },
  {
    title: 'Monstruos',
    icon: '🐙',
    fields: [
      {
        kind: 'checks',
        label: 'Tipos de monstruo',
        path: 'monsters.kinds',
        options: [
          ['spider', 'Araña'],
          ['octopus', 'Pulpo'],
          ['fish', 'Pez'],
          ['snake', 'Serpiente'],
        ],
      },
      { kind: 'range', label: 'Grupos por mapa', path: 'monsters.count', min: 0, max: 8, step: 1, hint: '0 = sin monstruos' },
      { kind: 'range', label: 'Tamaño de grupo', path: 'monsters.groupSize', min: 1, max: 6, step: 1, hint: 'arañas, peces y serpientes; el pulpo va solo', enabledIf: monstersOn },
      { kind: 'range', label: 'Probabilidad de devorar', path: 'monsters.destroyChance', min: 0, max: 1, step: 0.01, percent: true, hint: 'Si no la devoran, la sueltan', enabledIf: monstersOn },
      { kind: 'range', label: 'Tiempo atrapada', path: 'monsters.holdTime', min: 0.5, max: 6, step: 0.1, unit: ' s', decimals: 1, enabledIf: monstersOn },
      { kind: 'range', label: 'Velocidad', path: 'monsters.speed', min: 0.25, max: 3, step: 0.05, unit: '×', decimals: 2, enabledIf: monstersOn },
    ],
  },
  {
    title: 'Interruptores',
    icon: '🔘',
    fields: [
      { kind: 'toggle', label: 'Activar interruptores', path: 'switches.enabled' },
      {
        kind: 'checks',
        label: 'Acciones',
        path: 'switches.actions',
        enabledIf: (c) => c.switches.enabled,
        options: [
          ['lowGravity', 'Gravedad baja'],
          ['highGravity', 'Gravedad alta'],
          ['tiltGravity', 'Gravedad inclinada'],
          ['reverseGravity', 'Gravedad invertida'],
          ['reverseMechanisms', 'Invertir mecanismos'],
          ['fastMechanisms', 'Mecanismos rápidos'],
          ['wind', 'Viento'],
          ['bouncy', 'Modo rebote'],
          ['openGate', 'Abrir compuertas'],
        ],
      },
      { kind: 'range', label: 'Frecuencia', path: 'switches.frequency', min: 0, max: 1, step: 0.01, percent: true, enabledIf: (c) => c.switches.enabled },
      { kind: 'range', label: 'Duración', path: 'switches.duration', min: 1, max: 30, step: 0.5, unit: ' s', decimals: 1, enabledIf: (c) => c.switches.enabled },
    ],
  },
  {
    title: 'Cámara',
    icon: '🎥',
    fields: [
      {
        kind: 'select',
        label: 'Modo',
        path: 'camera.mode',
        options: [
          ['leader', 'Seguir al líder'],
          ['pack', 'Seguir al pelotón'],
          ['path', 'Seguir el camino'],
          ['scroll', 'Scroll automático'],
        ],
      },
      { kind: 'range', label: 'Ancho de vista', path: 'camera.viewWidth', min: 10, max: 80, step: 1, unit: ' m' },
      { kind: 'range', label: 'Velocidad de scroll', path: 'camera.scrollSpeed', min: 0.5, max: 6, step: 0.1, unit: ' m/s', decimals: 1, enabledIf: (c) => c.camera.mode === 'scroll' },
    ],
  },
  {
    title: 'Carrera',
    icon: '🏁',
    fields: [
      { kind: 'range', label: 'Podio (puestos)', path: 'race.podiumSize', min: 1, max: 10, step: 1 },
      { kind: 'range', label: 'Tiempo límite', path: 'race.timeLimit', min: 20, max: 900, step: 5, unit: ' s' },
      { kind: 'range', label: 'Cuenta regresiva', path: 'race.countdown', min: 0, max: 10, step: 1, unit: ' s' },
      { kind: 'range', label: 'Mínimo de llegadas para validar', path: 'race.minFinishers', min: 1, max: 20, step: 1 },
      { kind: 'toggle', label: 'Anti-atascos', path: 'race.unstuck' },
      {
        kind: 'select',
        label: 'Fin de la carrera',
        path: 'race.endMode',
        options: [
          ['podium', 'Al llenar el podio'],
          ['all', 'Cuando terminen todas'],
        ],
      },
    ],
  },
  {
    title: 'Mapa',
    icon: '🗺️',
    fields: [
      { kind: 'range', label: 'Segmentos', path: 'map.segments', min: 2, max: 24, step: 1 },
      { kind: 'range', label: 'Ancho del pasillo', path: 'map.width', min: 6, max: 40, step: 1, unit: ' m' },
      { kind: 'range', label: 'Puntos de reagrupación', path: 'map.regroups', min: 0, max: 4, step: 1, hint: 'Zonas donde la carrera se junta de nuevo' },
      { kind: 'range', label: 'Dificultad', path: 'map.difficulty', min: 0, max: 1, step: 0.01, percent: true },
      { kind: 'range', label: 'Intentos máximos', path: 'map.maxAttempts', min: 1, max: 100, step: 1 },
      { kind: 'seed', label: 'Semilla', path: 'seed' },
    ],
  },
];

function getPath(obj: unknown, path: string): unknown {
  return path.split('.').reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj);
}
function setPath(obj: unknown, path: string, value: unknown): void {
  const keys = path.split('.');
  const last = keys.pop()!;
  const target = keys.reduce<unknown>((o, k) => (o as Record<string, unknown>)[k], obj) as Record<string, unknown>;
  target[last] = value;
}

export class ConfigPanel {
  private refreshers: (() => void)[] = [];
  private enablers: { node: HTMLElement; fn: (c: GameConfig) => boolean }[] = [];

  constructor(
    private root: HTMLElement,
    private config: GameConfig,
    private onChange: (cfg: GameConfig) => void,
  ) {
    this.build();
  }

  setConfig(config: GameConfig): void {
    this.config = config;
    this.refresh();
  }

  refresh(): void {
    for (const r of this.refreshers) r();
    this.updateEnabled();
  }

  private changed(): void {
    this.updateEnabled();
    this.onChange(this.config);
  }

  private updateEnabled(): void {
    for (const { node, fn } of this.enablers) node.classList.toggle('disabled', !fn(this.config));
  }

  private build(): void {
    this.root.innerHTML = '';
    for (const sec of SECTIONS) {
      const det = el('details', { class: 'sec' }) as HTMLDetailsElement;
      if (sec.open) det.open = true;
      det.append(el('summary', {}, [el('span', { class: 'sec-icon' }, sec.icon), el('span', {}, sec.title)]));
      const body = el('div', { class: 'sec-body' });
      for (const f of sec.fields) body.append(this.buildField(f));
      det.append(body);
      this.root.append(det);
    }
    this.updateEnabled();
  }

  private wrap(f: Common, children: (Node | string)[], cls = ''): HTMLElement {
    const row = el('div', { class: `field ${cls}` }, children);
    if (f.hint) row.title = f.hint;
    if (f.enabledIf) this.enablers.push({ node: row, fn: f.enabledIf });
    return row;
  }

  private buildField(f: Field): HTMLElement {
    switch (f.kind) {
      case 'range':
        return this.buildRange(f);
      case 'select':
        return this.buildSelect(f);
      case 'checks':
        return this.buildChecks(f);
      case 'toggle':
        return this.buildToggle(f);
      case 'angle':
        return this.buildAngle(f);
      case 'seed':
        return this.buildSeed(f);
    }
  }

  private buildRange(f: Extract<Field, { kind: 'range' }>): HTMLElement {
    const slider = el('input', { type: 'range', min: String(f.min), max: String(f.max), step: String(f.step) }) as HTMLInputElement;
    const num = el('input', { type: 'number', class: 'num', min: String(f.percent ? f.min * 100 : f.min), max: String(f.percent ? f.max * 100 : f.max), step: String(f.percent ? f.step * 100 : f.step) }) as HTMLInputElement;
    const unit = el('span', { class: 'unit' }, f.percent ? '%' : (f.unit ?? ''));
    const dec = f.percent ? 0 : (f.decimals ?? 0);
    const show = () => {
      const v = getPath(this.config, f.path) as number;
      slider.value = String(v);
      num.value = (f.percent ? v * 100 : v).toFixed(dec);
    };
    const commit = (v: number) => {
      if (!Number.isFinite(v)) return;
      v = Math.min(f.max, Math.max(f.min, v));
      const q = Math.round(v / f.step) * f.step;
      setPath(this.config, f.path, Number(q.toFixed(6)));
      show();
      this.changed();
    };
    slider.addEventListener('input', () => commit(parseFloat(slider.value)));
    num.addEventListener('change', () => commit(f.percent ? parseFloat(num.value) / 100 : parseFloat(num.value)));
    this.refreshers.push(show);
    show();
    return this.wrap(f, [el('label', {}, f.label), el('div', { class: 'range-row' }, [slider, el('span', { class: 'val' }, [num, unit])])]);
  }

  private buildSelect(f: Extract<Field, { kind: 'select' }>): HTMLElement {
    const sel = el('select', {}, f.options.map(([v, l]) => el('option', { value: v }, l))) as HTMLSelectElement;
    sel.addEventListener('change', () => {
      setPath(this.config, f.path, sel.value);
      this.changed();
    });
    const show = () => (sel.value = String(getPath(this.config, f.path)));
    this.refreshers.push(show);
    show();
    return this.wrap(f, [el('label', {}, f.label), sel]);
  }

  private buildChecks(f: Extract<Field, { kind: 'checks' }>): HTMLElement {
    const grid = el('div', { class: 'checks' });
    const boxes: [string, HTMLInputElement][] = [];
    for (const [key, label] of f.options) {
      const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
      cb.addEventListener('change', () => {
        setPath(this.config, `${f.path}.${key}`, cb.checked);
        this.changed();
      });
      boxes.push([key, cb]);
      grid.append(el('label', { class: 'chk' }, [cb, el('span', {}, label)]));
    }
    const show = () => boxes.forEach(([k, cb]) => (cb.checked = !!getPath(this.config, `${f.path}.${k}`)));
    this.refreshers.push(show);
    show();
    return this.wrap(f, [el('label', { class: 'lbl' }, f.label), grid]);
  }

  private buildToggle(f: Extract<Field, { kind: 'toggle' }>): HTMLElement {
    const cb = el('input', { type: 'checkbox' }) as HTMLInputElement;
    cb.addEventListener('change', () => {
      setPath(this.config, f.path, cb.checked);
      this.changed();
    });
    const show = () => (cb.checked = !!getPath(this.config, f.path));
    this.refreshers.push(show);
    show();
    return this.wrap(f, [el('label', { class: 'switch-row' }, [el('span', {}, f.label), el('span', { class: 'toggle' }, [cb, el('i')])])]);
  }

  private buildAngle(f: Extract<Field, { kind: 'angle' }>): HTMLElement {
    const slider = el('input', { type: 'range', min: '-180', max: '180', step: '1' }) as HTMLInputElement;
    const num = el('input', { type: 'number', class: 'num', min: '-180', max: '180', step: '1' }) as HTMLInputElement;
    const arrow = el('div', { class: 'arrow-dial' }, [el('div', { class: 'arrow-needle' })]);
    const show = () => {
      const v = getPath(this.config, f.path) as number;
      slider.value = String(v);
      num.value = String(Math.round(v));
      // angle 0 = down, 90 = right: the needle points down at 0 and turns counter-clockwise
      (arrow.firstChild as HTMLElement).style.transform = `rotate(${-v}deg)`;
    };
    const commit = (v: number) => {
      if (!Number.isFinite(v)) return;
      v = Math.max(-180, Math.min(180, Math.round(v)));
      setPath(this.config, f.path, v);
      show();
      this.changed();
    };
    slider.addEventListener('input', () => commit(parseFloat(slider.value)));
    num.addEventListener('change', () => commit(parseFloat(num.value)));
    // drag on the dial
    const dial = (e: PointerEvent) => {
      const r = arrow.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      commit((Math.atan2(dx, dy) * 180) / Math.PI);
    };
    arrow.addEventListener('pointerdown', (e) => {
      arrow.setPointerCapture(e.pointerId);
      dial(e);
    });
    arrow.addEventListener('pointermove', (e) => {
      if (arrow.hasPointerCapture(e.pointerId)) dial(e);
    });
    this.refreshers.push(show);
    show();
    return this.wrap(f, [
      el('label', {}, f.label),
      el('div', { class: 'range-row' }, [arrow, slider, el('span', { class: 'val' }, [num, el('span', { class: 'unit' }, '°')])]),
    ]);
  }

  private buildSeed(f: Extract<Field, { kind: 'seed' }>): HTMLElement {
    const input = el('input', { type: 'number', class: 'seed', min: '0', step: '1' }) as HTMLInputElement;
    const dice = el('button', { type: 'button', class: 'btn icon', title: 'Semilla aleatoria' }, '🎲') as HTMLButtonElement;
    const show = () => (input.value = String(getPath(this.config, f.path)));
    input.addEventListener('change', () => {
      const v = Math.max(0, Math.floor(parseFloat(input.value)));
      setPath(this.config, f.path, Number.isFinite(v) ? v : 0);
      show();
      this.changed();
    });
    dice.addEventListener('click', () => {
      setPath(this.config, f.path, 1 + Math.floor(Math.random() * 999999));
      show();
      this.changed();
    });
    this.refreshers.push(show);
    show();
    return this.wrap(f, [el('label', {}, f.label), el('div', { class: 'seed-row' }, [input, dice])]);
  }
}
