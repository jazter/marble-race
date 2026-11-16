/**
 * Outlined text pre-rendered into small offscreen canvases. Drawing text (fill + stroke) every
 * frame is one of the most expensive canvas operations on tablets; names, rank tags and labels
 * barely change, so each one is rasterised once and then blitted with drawImage.
 */

export interface TextSprite {
  canvas: HTMLCanvasElement;
  /** Sprite size in device pixels. */
  w: number;
  h: number;
  /** Width of the text itself (without the outline padding). */
  textW: number;
  /** Offset from the sprite's top-left corner to the text anchor (centre x, baseline / middle y). */
  ax: number;
  ay: number;
}

export interface TextStyle {
  font: string; // full CSS font with the pixel size
  px: number; // font size in device pixels
  fill: string;
  stroke: string;
  lineWidth: number;
  baseline: 'alphabetic' | 'middle';
}

const MAX_ENTRIES = 400;

export class TextCache {
  private map = new Map<string, TextSprite>();
  private measureCtx: CanvasRenderingContext2D | null = null;

  get(text: string, st: TextStyle): TextSprite | null {
    const key = `${st.font}|${st.fill}|${st.stroke}|${st.lineWidth}|${st.baseline}|${text}`;
    const hit = this.map.get(key);
    if (hit) return hit;
    if (typeof document === 'undefined') return null;
    if (!this.measureCtx) this.measureCtx = document.createElement('canvas').getContext('2d');
    const mctx = this.measureCtx;
    if (!mctx) return null;
    mctx.font = st.font;
    const textW = mctx.measureText(text).width;
    const pad = Math.ceil(st.lineWidth / 2 + 2);
    const w = Math.max(1, Math.ceil(textW + 2 * pad));
    const h = Math.max(1, Math.ceil(st.px * 1.35 + 2 * pad));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    const ax = w / 2;
    const ay = st.baseline === 'middle' ? h / 2 : pad + Math.round(st.px * 1.0);
    ctx.font = st.font;
    ctx.textAlign = 'center';
    ctx.textBaseline = st.baseline;
    ctx.lineJoin = 'round';
    ctx.lineWidth = st.lineWidth;
    ctx.strokeStyle = st.stroke;
    ctx.strokeText(text, ax, ay);
    ctx.fillStyle = st.fill;
    ctx.fillText(text, ax, ay);
    const sprite: TextSprite = { canvas, w, h, textW, ax, ay };
    if (this.map.size >= MAX_ENTRIES) this.map.clear(); // simple bound (names/labels rarely exceed it)
    this.map.set(key, sprite);
    return sprite;
  }

  /** Draw `text` with its anchor at (x, y) in device pixels (identity transform expected). */
  draw(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, st: TextStyle): TextSprite | null {
    const s = this.get(text, st);
    if (!s) return null;
    ctx.drawImage(s.canvas, Math.round(x - s.ax), Math.round(y - s.ay));
    return s;
  }

  clear(): void {
    this.map.clear();
  }
}
