/** Race HUD: stats, physics chips, live leaderboard, toast feed, countdown. */
import type { MapDef, MarbleProfile } from '../core/types';
import type { EliminationReason, MarbleState, SimEvent, Simulation } from '../sim/api';
import { skinSwatchCss } from '../render/skins';
import { $, el, fmtTime } from './dom';
import { labelNode, labelText } from './marbleLabel';

const REASONS: Record<EliminationReason, string> = {
  wall: 'fue eliminada por una pared letal',
  destroy: 'fue destruida',
  offscreen: 'quedó fuera de cámara',
  outOfBounds: 'salió del mapa',
};

interface Row {
  node: HTMLElement;
  pos: HTMLElement;
  info: HTMLElement;
  key: string;
  nameEl: HTMLElement;
  profile: MarbleProfile;
}

export class Hud {
  private timeEl = $('hud-time');
  private racingEl = $('hud-racing');
  private finishedEl = $('hud-finished');
  private elimEl = $('hud-elim');
  private chips = $('hud-chips');
  private board = $('leaderboard-rows');
  private toasts = $('toasts');
  private countdown = $('countdown');
  private rows: Row[] = [];
  private lastSlow = 0;
  private lastCd = '';
  private chipKey = '';

  constructor(
    private map: MapDef,
    private roster: MarbleProfile[],
    private onPick: (p: MarbleProfile) => void = () => {},
  ) {
    this.board.innerHTML = '';
    this.toasts.innerHTML = '';
    this.rows = roster.map((p) => {
      const pos = el('span', { class: 'lb-pos' });
      const info = el('span', { class: 'lb-info' });
      const nameEl = el('span', { class: 'lb-name' });
      const node = el('div', { class: 'lb-row', title: 'Clic para ponerle nombre' }, [
        pos,
        el('span', { class: 'swatch', style: `background:${skinSwatchCss(p.skin)}` }),
        nameEl,
        info,
      ]);
      node.addEventListener('click', () => this.onPick(p));
      this.board.append(node);
      const row: Row = { node, pos, info, key: '', nameEl, profile: p };
      this.paintName(row);
      return row;
    });
  }

  private paintName(row: Row): void {
    row.nameEl.replaceChildren(labelNode(row.profile));
    row.nameEl.title = labelText(row.profile);
  }

  /** Re-render marble names after a custom name changed. */
  refreshNames(): void {
    for (const r of this.rows) this.paintName(r);
  }

  destroy(): void {
    this.board.innerHTML = '';
    this.toasts.innerHTML = '';
    this.countdown.classList.remove('show');
  }

  /** Per-frame update (cheap parts every frame, heavy parts ~5 Hz). */
  update(sim: Simulation, events: readonly SimEvent[]): void {
    for (const e of events) this.toast(e);
    this.updateCountdown(sim);
    const now = performance.now();
    if (now - this.lastSlow < 200) return;
    this.lastSlow = now;
    const rt = sim.time - sim.config.race.countdown;
    this.timeEl.textContent = fmtTime(Math.max(0, rt));
    const marbles = sim.getMarbles();
    let racing = 0;
    let fin = 0;
    let elim = 0;
    for (const m of marbles) {
      if (m.status === 'finished') fin++;
      else if (m.status === 'eliminated') elim++;
      else racing++;
    }
    this.racingEl.textContent = String(racing);
    this.finishedEl.textContent = String(fin);
    this.elimEl.textContent = String(elim);
    this.updateChips(sim);
    this.updateBoard(marbles);
  }

  private updateChips(sim: Simulation): void {
    const ps = sim.getPhysicsState();
    const g = ps.gravity;
    const gl = Math.hypot(g.x, g.y);
    const gAng = (Math.atan2(g.x, g.y) * 180) / Math.PI;
    const wl = Math.hypot(ps.wind.x, ps.wind.y);
    const wAng = (Math.atan2(ps.wind.x, ps.wind.y) * 180) / Math.PI;
    const key = [gl.toFixed(1), gAng.toFixed(0), wl.toFixed(1), wAng.toFixed(0), ps.activeLabels.join('|')].join('~');
    if (key === this.chipKey) return;
    this.chipKey = key;
    this.chips.innerHTML = '';
    const arrow = (a: number) => `<span class="arr" style="transform:rotate(${-a}deg)">↓</span>`;
    const g0 = el('span', { class: 'chip' });
    g0.innerHTML = `${arrow(gAng)} g ${gl.toFixed(1)}`;
    this.chips.append(g0);
    if (wl > 0.05) {
      const w = el('span', { class: 'chip' });
      w.innerHTML = `💨 ${arrow(wAng)} ${wl.toFixed(1)}`;
      this.chips.append(w);
    }
    for (const l of ps.activeLabels) this.chips.append(el('span', { class: 'chip active' }, l));
  }

  private updateBoard(marbles: readonly MarbleState[]): void {
    const order = [...marbles];
    const rank = (m: MarbleState) => (m.status === 'finished' ? 0 : m.status === 'eliminated' ? 2 : 1);
    order.sort((a, b) => {
      const ra = rank(a);
      const rb = rank(b);
      if (ra !== rb) return ra - rb;
      if (ra === 0) return (a.rank ?? 999) - (b.rank ?? 999);
      if (ra === 1) return b.progress - a.progress;
      return (b.eliminatedAt ?? 0) - (a.eliminatedAt ?? 0);
    });
    let leader = 0;
    const first = order.find((m) => m.status === 'racing' || m.status === 'waiting');
    if (first) leader = first.progress;
    order.forEach((m, i) => {
      const row = this.rows[m.id];
      if (!row) return;
      row.node.style.order = String(i);
      let pos: string;
      let info: string;
      let cls = 'lb-row';
      if (m.status === 'finished') {
        pos = `${m.rank ?? i + 1}º`;
        info = fmtTime(m.finishTime ?? 0);
        cls += ' fin';
      } else if (m.status === 'eliminated') {
        pos = '☠';
        info = 'fuera';
        cls += ' out';
      } else {
        pos = String(i + 1);
        const gap = leader - m.progress;
        info = gap < 0.05 ? 'líder' : `-${gap.toFixed(1)} m`;
      }
      const key = pos + info + cls;
      if (key !== row.key) {
        row.key = key;
        row.pos.textContent = pos;
        row.info.textContent = info;
        row.node.className = cls;
      }
    });
  }

  private updateCountdown(sim: Simulation): void {
    const rt = sim.time - sim.config.race.countdown;
    let txt = '';
    if (rt < 0) txt = String(Math.ceil(-rt));
    else if (rt < 0.9) txt = '¡YA!';
    if (txt !== this.lastCd) {
      this.lastCd = txt;
      this.countdown.textContent = txt;
      this.countdown.classList.toggle('show', txt !== '');
      // retrigger pop animation
      this.countdown.classList.remove('pop');
      void this.countdown.offsetWidth;
      this.countdown.classList.add('pop');
    }
  }

  private name(id: number): string {
    const p = this.roster[id];
    return p ? labelText(p) : `Canica ${id + 1}`;
  }

  private toast(e: SimEvent): void {
    let text = '';
    let cls = '';
    switch (e.type) {
      case 'finish':
        text = `${this.name(e.marbleId)} llegó ${e.rank}º (${fmtTime(e.time)})`;
        cls = 'good';
        break;
      case 'eliminated':
        text = `${this.name(e.marbleId)} ${REASONS[e.reason]}`;
        cls = 'bad';
        break;
      case 'switch': {
        const sw = this.map.switches.find((s) => s.id === e.switchId);
        if (!sw) return;
        text = e.active ? `Interruptor: ${sw.label}` : `Terminó: ${sw.label}`;
        cls = 'info';
        break;
      }
      case 'gateOpen': {
        const g = this.map.gates.find((x) => x.id === e.gateId);
        if (!g || g.role === 'start') return;
        text = 'Se abrió una compuerta';
        cls = 'info';
        break;
      }
      case 'raceEnd':
        text = 'Fin de la carrera';
        cls = 'info';
        break;
      default:
        return;
    }
    const t = el('div', { class: `toast ${cls}` }, text);
    this.toasts.append(t);
    while (this.toasts.children.length > 5) this.toasts.firstElementChild?.remove();
    setTimeout(() => t.classList.add('out'), 3600);
    setTimeout(() => t.remove(), 4200);
  }
}
