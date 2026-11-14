/**
 * Marble skin sprites. Each skin is pre-rendered (per radius bucket) into two
 * offscreen canvases:
 *  - `pattern`: the colour pattern, drawn rotated with the marble's angle;
 *  - `overlay`: fixed shading + specular highlight (light from the top-left).
 */
import type { MarbleSkin } from '../core/types';
import { alpha, darken, lighten } from './color';

export interface SkinSprite {
  pattern: HTMLCanvasElement;
  overlay: HTMLCanvasElement;
  /** Canvas side in device px (pattern and overlay are the same size). */
  size: number;
}

const cache = new Map<string, SkinSprite>();

function makeCanvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

export function clearSkinCache(): void {
  cache.clear();
}

/** Quantise a device-pixel radius so a growing/shrinking marble re-uses sprites. */
export function radiusBucket(rPx: number): number {
  if (rPx <= 8) return Math.max(2, Math.ceil(rPx));
  if (rPx <= 24) return Math.ceil(rPx / 2) * 2;
  return Math.ceil(rPx / 4) * 4;
}

export function getSkinSprite(skin: MarbleSkin, bucket: number): SkinSprite {
  const key = `${skin.type}|${skin.colors.join(',')}|${bucket}`;
  let s = cache.get(key);
  if (!s) {
    if (cache.size > 1200) cache.clear();
    s = buildSprite(skin, bucket);
    cache.set(key, s);
  }
  return s;
}

function buildSprite(skin: MarbleSkin, R: number): SkinSprite {
  const size = Math.ceil(R * 2) + 4;
  const c = size / 2;
  const [pattern, p] = makeCanvas(size);
  const [overlay, o] = makeCanvas(size);
  const cols = skin.colors.length ? skin.colors : ['#cccccc'];
  p.save();
  p.beginPath();
  p.arc(c, c, R, 0, Math.PI * 2);
  p.clip();
  p.translate(c, c);
  drawPattern(p, skin, cols, R);
  p.restore();
  drawOverlay(o, skin, c, R);
  return { pattern, overlay, size };
}

function drawPattern(g: CanvasRenderingContext2D, skin: MarbleSkin, cols: string[], R: number): void {
  const band = (x0: number, x1: number, col: string) => {
    g.fillStyle = col;
    g.fillRect(x0, -R - 1, x1 - x0, 2 * R + 2);
  };
  switch (skin.type) {
    case 'solid':
      g.fillStyle = cols[0];
      g.fillRect(-R, -R, 2 * R, 2 * R);
      break;
    case 'bicolor':
      band(-R - 1, 0, cols[0]);
      band(0, R + 1, cols[1] ?? cols[0]);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(-R * 0.03, -R, R * 0.06, 2 * R);
      break;
    case 'tricolor': {
      const w = (2 * R) / 3;
      band(-R - 1, -R + w, cols[0]);
      band(-R + w, -R + 2 * w, cols[1] ?? cols[0]);
      band(-R + 2 * w, R + 1, cols[2] ?? cols[0]);
      break;
    }
    case 'striped': {
      g.fillStyle = cols[0];
      g.fillRect(-R, -R, 2 * R, 2 * R);
      const sc = cols[1] ?? '#ffffff';
      band(-R * 0.62, -R * 0.3, sc);
      band(R * 0.3, R * 0.62, sc);
      band(-R * 0.1, R * 0.1, sc);
      break;
    }
    case 'multicolor': {
      const n = cols.length;
      const gc = (g as CanvasRenderingContext2D & { createConicGradient?: (a: number, x: number, y: number) => CanvasGradient }).createConicGradient;
      if (gc) {
        const grad = gc.call(g, 0, 0, 0);
        cols.forEach((col, i) => grad.addColorStop(i / n, col));
        grad.addColorStop(1, cols[0]);
        g.fillStyle = grad;
        g.fillRect(-R, -R, 2 * R, 2 * R);
      } else {
        for (let i = 0; i < n; i++) {
          g.fillStyle = cols[i];
          g.beginPath();
          g.moveTo(0, 0);
          g.arc(0, 0, R + 1, (i / n) * Math.PI * 2, ((i + 1) / n) * Math.PI * 2 + 0.02);
          g.fill();
        }
      }
      break;
    }
    case 'silver':
    case 'gold': {
      const light = cols[0];
      const dark = cols[1] ?? darken(cols[0], 0.45);
      const grad = g.createLinearGradient(-R, -R * 0.6, R, R * 0.6);
      grad.addColorStop(0, lighten(light, 0.35));
      grad.addColorStop(0.3, light);
      grad.addColorStop(0.5, dark);
      grad.addColorStop(0.7, lighten(light, 0.2));
      grad.addColorStop(1, darken(dark, 0.15));
      g.fillStyle = grad;
      g.fillRect(-R, -R, 2 * R, 2 * R);
      // brushed streaks so the rotation is visible
      g.strokeStyle = alpha(darken(dark, 0.3), 0.35);
      g.lineWidth = Math.max(1, R * 0.07);
      for (let i = -2; i <= 2; i++) {
        g.beginPath();
        g.moveTo(-R, i * R * 0.38 + R * 0.1);
        g.quadraticCurveTo(0, i * R * 0.38 - R * 0.25, R, i * R * 0.38 + R * 0.1);
        g.stroke();
      }
      break;
    }
    case 'glass': {
      const tint = cols[0];
      const tint2 = cols[1] ?? lighten(tint, 0.5);
      g.fillStyle = alpha(tint, 0.35);
      g.fillRect(-R, -R, 2 * R, 2 * R);
      g.lineCap = 'round';
      g.strokeStyle = alpha(tint2, 0.75);
      g.lineWidth = Math.max(1, R * 0.14);
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(0, 0, R * (0.28 + i * 0.22), i * 2.1, i * 2.1 + 2.3);
        g.stroke();
      }
      g.fillStyle = alpha(tint, 0.65);
      g.beginPath();
      g.arc(0, 0, R * 0.14, 0, Math.PI * 2);
      g.fill();
      break;
    }
  }
}

function drawOverlay(g: CanvasRenderingContext2D, skin: MarbleSkin, c: number, R: number): void {
  const glass = skin.type === 'glass';
  const metal = skin.type === 'silver' || skin.type === 'gold';
  // shading
  const sh = g.createRadialGradient(c - R * 0.35, c - R * 0.4, R * 0.05, c, c, R);
  if (glass) {
    sh.addColorStop(0, 'rgba(255,255,255,0.25)');
    sh.addColorStop(0.6, 'rgba(255,255,255,0)');
    sh.addColorStop(0.9, 'rgba(0,0,0,0.12)');
    sh.addColorStop(1, 'rgba(255,255,255,0.35)');
  } else {
    sh.addColorStop(0, `rgba(255,255,255,${metal ? 0.2 : 0.32})`);
    sh.addColorStop(0.35, 'rgba(255,255,255,0)');
    sh.addColorStop(0.7, 'rgba(0,0,0,0.12)');
    sh.addColorStop(1, `rgba(0,0,0,${metal ? 0.55 : 0.5})`);
  }
  g.fillStyle = sh;
  g.beginPath();
  g.arc(c, c, R, 0, Math.PI * 2);
  g.fill();
  // rim
  g.lineWidth = Math.max(1, R * 0.07);
  g.strokeStyle = glass ? 'rgba(255,255,255,0.55)' : 'rgba(0,0,0,0.4)';
  g.beginPath();
  g.arc(c, c, R - g.lineWidth / 2, 0, Math.PI * 2);
  g.stroke();
  // specular highlight
  g.save();
  g.translate(c - R * 0.38, c - R * 0.4);
  g.rotate(-Math.PI / 4);
  const hl = g.createRadialGradient(0, 0, 0, 0, 0, R * 0.38);
  const strength = glass ? 1 : metal ? 1 : 0.85;
  hl.addColorStop(0, `rgba(255,255,255,${strength})`);
  hl.addColorStop(metal ? 0.55 : 1, `rgba(255,255,255,${metal ? 0.6 : 0})`);
  hl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = hl;
  g.beginPath();
  g.ellipse(0, 0, R * (metal ? 0.3 : 0.38), R * (metal ? 0.14 : 0.2), 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
  if (glass || metal) {
    // small secondary reflection bottom-right
    g.fillStyle = `rgba(255,255,255,${glass ? 0.5 : 0.28})`;
    g.beginPath();
    g.ellipse(c + R * 0.38, c + R * 0.42, R * 0.2, R * 0.07, Math.PI / 4, 0, Math.PI * 2);
    g.fill();
  }
}

/** Draw a marble at device-pixel position with its pattern rotated by `angle`. */
export function drawMarbleSprite(
  ctx: CanvasRenderingContext2D,
  skin: MarbleSkin,
  x: number,
  y: number,
  rPx: number,
  angle: number,
  alphaMul = 1,
): void {
  const bucket = radiusBucket(rPx);
  const sp = getSkinSprite(skin, bucket);
  const d = sp.size * (rPx / bucket);
  const half = d / 2;
  if (alphaMul !== 1) ctx.globalAlpha = alphaMul;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.drawImage(sp.pattern, -half, -half, d, d);
  ctx.restore();
  ctx.drawImage(sp.overlay, x - half, y - half, d, d);
  if (alphaMul !== 1) ctx.globalAlpha = 1;
}

/** Representative flat colour of a skin (swatches, particles, minimap). */
export function skinColor(skin: MarbleSkin): string {
  return skin.colors[0] ?? '#cccccc';
}

/** CSS gradient for DOM swatches of a skin. */
export function skinSwatchCss(skin: MarbleSkin): string {
  const c = skin.colors;
  const a = c[0] ?? '#ccc';
  const b = c[1] ?? a;
  const hi = 'radial-gradient(circle at 32% 30%, rgba(255,255,255,.75), rgba(255,255,255,0) 45%), ';
  switch (skin.type) {
    case 'bicolor':
      return `${hi}linear-gradient(90deg, ${a} 50%, ${b} 50%)`;
    case 'tricolor':
      return `${hi}linear-gradient(90deg, ${a} 33%, ${b} 33% 66%, ${c[2] ?? a} 66%)`;
    case 'striped':
      return `${hi}linear-gradient(90deg, ${a} 28%, ${b} 28% 40%, ${a} 40% 60%, ${b} 60% 72%, ${a} 72%)`;
    case 'multicolor':
      return `${hi}conic-gradient(${[...c, c[0]].join(',')})`;
    case 'silver':
    case 'gold':
      return `${hi}linear-gradient(135deg, ${lighten(a, 0.4)}, ${a} 35%, ${b} 55%, ${lighten(a, 0.2)})`;
    case 'glass':
      return `${hi}radial-gradient(circle, ${alpha(a, 0.5)}, ${alpha(b, 0.9)})`;
    default:
      return `${hi}${a}`;
  }
}

