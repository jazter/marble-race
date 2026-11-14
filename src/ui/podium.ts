/** Podium overlay (classic 2-1-3 blocks with the marble skins on top). */
import type { MarbleProfile } from '../core/types';
import type { RaceResult } from '../sim/api';
import { drawMarbleSprite, skinSwatchCss } from '../render/skins';
import { $, el, fmtTime } from './dom';

function marbleCanvas(p: MarbleProfile, cssSize: number): HTMLCanvasElement {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(cssSize * dpr);
  c.style.width = c.style.height = `${cssSize}px`;
  const g = c.getContext('2d')!;
  drawMarbleSprite(g, p.skin, c.width / 2, c.height / 2, c.width / 2 - 2 * dpr, -0.5);
  return c;
}

export function showPodium(
  result: RaceResult,
  roster: MarbleProfile[],
  podiumSize: number,
  handlers: { onRepeat: () => void; onNew: () => void; onConfig: () => void },
): void {
  const root = $('podium');
  const top = result.finishers.slice(0, podiumSize);
  const inner = el('div', { class: 'podium-card' });
  inner.append(el('h2', {}, top.length ? '¡Podio!' : 'Carrera terminada'));

  if (top.length === 0) {
    inner.append(el('p', { class: 'muted' }, 'Ninguna canica llegó a la meta.'));
  } else {
    const blocks = top.slice(0, 3);
    const layout = blocks.length >= 3 ? [1, 0, 2] : blocks.length === 2 ? [1, 0] : [0];
    const heights = [150, 110, 80];
    const stage = el('div', { class: 'podium-stage' });
    for (const idx of layout) {
      const f = blocks[idx];
      const prof = roster[f.marbleId];
      const col = el('div', { class: `pod-col p${idx + 1}` });
      if (prof) col.append(marbleCanvas(prof, 64));
      col.append(el('div', { class: 'pod-name' }, f.name), el('div', { class: 'pod-time' }, fmtTime(f.time)));
      const block = el('div', { class: 'pod-block', style: `height:${heights[idx]}px` }, String(idx + 1));
      col.append(block);
      stage.append(col);
    }
    inner.append(stage);
    if (top.length > 3) {
      const list = el('ol', { class: 'pod-list', start: '4' });
      for (const f of top.slice(3)) {
        const prof = roster[f.marbleId];
        list.append(
          el('li', {}, [
            el('span', { class: 'swatch', style: `background:${prof ? skinSwatchCss(prof.skin) : '#888'}` }),
            el('span', { class: 'lb-name' }, f.name),
            el('span', { class: 'pod-time' }, fmtTime(f.time)),
          ]),
        );
      }
      inner.append(list);
    }
    if (top.length < podiumSize) {
      inner.append(el('p', { class: 'muted' }, `Sólo ${top.length} de ${podiumSize} puestos del podio se llenaron: no llegaron más canicas.`));
    }
  }
  const btns = el('div', { class: 'btn-row' });
  const mk = (label: string, cls: string, fn: () => void) => {
    const b = el('button', { type: 'button', class: `btn ${cls}` }, label);
    b.addEventListener('click', fn);
    btns.append(b);
  };
  mk('↺ Repetir carrera', 'primary', handlers.onRepeat);
  mk('🗺️ Nuevo mapa', '', handlers.onNew);
  mk('⚙ Configurar', '', handlers.onConfig);
  inner.append(btns);
  root.innerHTML = '';
  root.append(inner);
  root.classList.add('show');
}

export function hidePodium(): void {
  const root = $('podium');
  root.classList.remove('show');
  root.innerHTML = '';
}
