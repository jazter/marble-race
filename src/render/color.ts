/** Tiny colour helpers (hex / hsl / rgb CSS strings). */

export interface RGB {
  r: number;
  g: number;
  b: number;
}

function hslToRgb(h: number, s: number, l: number): RGB {
  h = (((h % 360) + 360) % 360) / 360;
  s /= 100;
  l /= 100;
  if (s === 0) return { r: l * 255, g: l * 255, b: l * 255 };
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const f = (t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  return { r: f(h + 1 / 3) * 255, g: f(h) * 255, b: f(h - 1 / 3) * 255 };
}

export function parseColor(css: string, fallback: RGB = { r: 200, g: 200, b: 200 }): RGB {
  const s = css.trim();
  let m = /^#([0-9a-f]{3})$/i.exec(s);
  if (m) {
    const h = m[1];
    return { r: parseInt(h[0] + h[0], 16), g: parseInt(h[1] + h[1], 16), b: parseInt(h[2] + h[2], 16) };
  }
  m = /^#([0-9a-f]{6})/i.exec(s);
  if (m) {
    const n = parseInt(m[1], 16);
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
  }
  m = /^hsla?\(\s*([-\d.]+)[,\s]+([\d.]+)%[,\s]+([\d.]+)%/i.exec(s);
  if (m) return hslToRgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(s);
  if (m) return { r: parseFloat(m[1]), g: parseFloat(m[2]), b: parseFloat(m[3]) };
  return fallback;
}

const c255 = (x: number) => Math.max(0, Math.min(255, Math.round(x)));

export function rgbStr(c: RGB, a = 1): string {
  return a >= 1 ? `rgb(${c25(c.r)},${c25(c.g)},${c25(c.b)})` : `rgba(${c25(c.r)},${c25(c.g)},${c25(c.b)},${a})`;
}
function c25(x: number) {
  return c255(x);
}

/** Mix colour a toward b by t (0..1). */
export function mix(a: string, b: string, t: number): string {
  const A = parseColor(a);
  const B = parseColor(b);
  return rgbStr({ r: A.r + (B.r - A.r) * t, g: A.g + (B.g - A.g) * t, b: A.b + (B.b - A.b) * t });
}

export const lighten = (c: string, t: number): string => mix(c, '#ffffff', t);
export const darken = (c: string, t: number): string => mix(c, '#000000', t);

export function alpha(c: string, a: number): string {
  return rgbStr(parseColor(c), a);
}
