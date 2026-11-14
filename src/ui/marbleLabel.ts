/** Shared helpers to show a marble's (custom) name consistently across the UI. */
import type { MarbleProfile } from '../core/types';
import { drawMarbleSprite } from '../render/skins';
import { el } from './dom';
import { displayName, getCustomName } from './names';

/** Stable identity of a marble's look (falls back to its colour name). */
export function keyOf(p: MarbleProfile): string {
  return p.key ?? p.name;
}

/** The name given by spectators, or null. */
export function customOf(p: MarbleProfile): string | null {
  const c = getCustomName(keyOf(p));
  return c && c.trim() ? c : null;
}

/** Plain-text label: "Ana · Rubí" when named, otherwise "Rubí". */
export function labelText(p: MarbleProfile): string {
  const c = customOf(p);
  return c && c !== p.name ? `${displayName(p)} · ${p.name}` : displayName(p);
}

/** DOM label: main name plus a subtle colour name when a custom name exists. */
export function labelNode(p: MarbleProfile, cls = 'nm'): HTMLElement {
  const root = el('span', { class: cls }, displayName(p));
  const c = customOf(p);
  if (c && c !== p.name) root.append(el('small', { class: 'nm-sub' }, ` · ${p.name}`));
  return root;
}

/** Small canvas with the marble's skin. */
export function marbleCanvas(p: MarbleProfile, cssSize: number): HTMLCanvasElement {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const c = document.createElement('canvas');
  c.width = c.height = Math.round(cssSize * dpr);
  c.style.width = c.style.height = `${cssSize}px`;
  const g = c.getContext('2d')!;
  drawMarbleSprite(g, p.skin, c.width / 2, c.height / 2, c.width / 2 - 2 * dpr, -0.5);
  return c;
}
