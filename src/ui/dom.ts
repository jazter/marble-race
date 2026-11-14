/** Minimal DOM helpers. */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string> = {},
  children: (Node | string)[] | string = [],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  const list = typeof children === 'string' ? [children] : children;
  for (const c of list) node.append(c);
  return node;
}

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const n = document.getElementById(id);
  if (!n) throw new Error(`#${id} not found`);
  return n as T;
}

export function fmtTime(s: number): string {
  if (!isFinite(s)) return '–';
  const sign = s < 0 ? '-' : '';
  s = Math.abs(s);
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${sign}${m}:${r.toFixed(1).padStart(4, '0')}`;
}
