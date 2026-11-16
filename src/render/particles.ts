/**
 * Purely visual particles. Never read by (or fed back into) the simulation.
 * Uses Math.random on purpose: it must not touch sim determinism.
 */
export type ParticleKind = 'spark' | 'confetti' | 'ring' | 'skull' | 'dust' | 'glow' | 'bubble' | 'text';

export interface Particle {
  kind: ParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  rot: number;
  vr: number;
  gravity: number;
  drag: number;
  /** 'text' particles only. */
  text?: string;
}

const MAX = 900;

export class ParticleSystem {
  readonly list: Particle[] = [];
  /** 0..1: fraction of burst / dust / confetti particles actually spawned (lower on slow devices). */
  density = 1;

  private count(n: number): number {
    return this.density >= 1 ? n : Math.max(1, Math.round(n * this.density));
  }

  clear(): void {
    this.list.length = 0;
  }

  add(p: Partial<Particle> & { kind: ParticleKind; x: number; y: number }): void {
    if (this.list.length >= MAX) this.list.shift();
    this.list.push({
      vx: 0,
      vy: 0,
      life: 0.8,
      maxLife: 0.8,
      size: 0.15,
      color: '#fff',
      rot: 0,
      vr: 0,
      gravity: 0,
      drag: 0,
      ...p,
    });
  }

  update(dt: number): void {
    if (dt <= 0) return;
    const l = this.list;
    let w = 0;
    for (let i = 0; i < l.length; i++) {
      const p = l[i];
      p.life -= dt;
      if (p.life <= 0) continue;
      p.vy += p.gravity * dt;
      if (p.drag) {
        const k = Math.max(0, 1 - p.drag * dt);
        p.vx *= k;
        p.vy *= k;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.rot += p.vr * dt;
      l[w++] = p;
    }
    l.length = w;
  }

  burst(x: number, y: number, color: string, n: number, speed: number, opts: Partial<Particle> = {}): void {
    n = this.count(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.35 + Math.random() * 0.65);
      const life = 0.45 + Math.random() * 0.6;
      this.add({
        kind: 'spark',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        maxLife: life,
        size: 0.07 + Math.random() * 0.1,
        color,
        gravity: 6,
        drag: 1.5,
        ...opts,
      });
    }
  }

  confetti(x: number, y: number, colors: string[], n: number): void {
    n = this.count(n);
    for (let i = 0; i < n; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
      const s = 4 + Math.random() * 8;
      const life = 1.2 + Math.random() * 1.2;
      this.add({
        kind: 'confetti',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life,
        maxLife: life,
        size: 0.14 + Math.random() * 0.12,
        color: colors[i % colors.length],
        rot: Math.random() * 6,
        vr: (Math.random() - 0.5) * 14,
        gravity: 9,
        drag: 1.2,
      });
    }
  }

  ring(x: number, y: number, color: string, size: number, life = 0.5): void {
    this.add({ kind: 'ring', x, y, life, maxLife: life, size, color });
  }

  skull(x: number, y: number): void {
    this.add({ kind: 'skull', x, y, vy: -2.2, life: 1.1, maxLife: 1.1, size: 0.55, color: '#ffffff', drag: 1.2 });
  }

  /** Rising bubble (fish). */
  bubble(x: number, y: number, size: number): void {
    if (this.density < 1 && Math.random() > this.density) return;
    const life = 0.9 + Math.random() * 0.7;
    this.add({ kind: 'bubble', x, y, vx: (Math.random() - 0.5) * 0.5, vy: -(0.8 + Math.random() * 0.9), life, maxLife: life, size, color: '#bfeaff', rot: Math.random() * 6, vr: 3 + Math.random() * 3 });
  }

  /** Floating pop text ("!", "ÑAM"). `size` = font size in metres. */
  text(x: number, y: number, text: string, color: string, size = 0.9, life = 0.9): void {
    this.add({ kind: 'text', x, y, vy: -1.6, life, maxLife: life, size, color, drag: 1.4, text });
  }

  dust(x: number, y: number, color: string, n: number, spread: number): void {
    n = this.count(n);
    for (let i = 0; i < n; i++) {
      const life = 0.6 + Math.random() * 0.6;
      this.add({
        kind: 'dust',
        x: x + (Math.random() - 0.5) * spread,
        y,
        vx: (Math.random() - 0.5) * 1.5,
        vy: 0.5 + Math.random() * 1.5,
        life,
        maxLife: life,
        size: 0.15 + Math.random() * 0.2,
        color,
        drag: 1,
      });
    }
  }

  /**
   * Draw in world coordinates. `box` (world view rectangle) skips off-screen particles; `pxPerM`
   * (device px per metre) lets tiny sparks be drawn as squares, much cheaper than arcs.
   */
  draw(ctx: CanvasRenderingContext2D, box?: { x0: number; y0: number; x1: number; y1: number }, pxPerM = Infinity): void {
    const tiny = 2.5 / pxPerM; // radius (m) below which a spark is ~2-3 px: a square looks the same
    for (const p of this.list) {
      if (box && (p.x < box.x0 - 2 || p.x > box.x1 + 2 || p.y < box.y0 - 2 || p.y > box.y1 + 2)) continue;
      const t = p.life / p.maxLife; // 1 -> 0
      ctx.globalAlpha = Math.max(0, Math.min(1, t * 1.4));
      switch (p.kind) {
        case 'spark':
        case 'glow':
        case 'dust': {
          ctx.fillStyle = p.color;
          const r = p.kind === 'dust' ? p.size * (1.6 - t * 0.6) : p.size * (0.4 + t * 0.6);
          if (r < tiny) {
            ctx.fillRect(p.x - r, p.y - r, r * 2, r * 2);
            break;
          }
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'confetti':
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.scale(1, Math.abs(Math.cos(p.rot * 1.7)) * 0.8 + 0.2);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
          ctx.restore();
          break;
        case 'ring': {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 0.12 * t + 0.02;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * (1.15 - t), 0, Math.PI * 2);
          ctx.stroke();
          break;
        }
        case 'bubble': {
          const wob = Math.sin(p.rot) * 0.04;
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 0.035;
          ctx.beginPath();
          ctx.arc(p.x + wob, p.y, p.size, 0, Math.PI * 2);
          ctx.stroke();
          ctx.fillStyle = 'rgba(255,255,255,0.7)';
          ctx.beginPath();
          ctx.arc(p.x + wob - p.size * 0.3, p.y - p.size * 0.3, p.size * 0.22, 0, Math.PI * 2);
          ctx.fill();
          break;
        }
        case 'text': {
          const pop = Math.min(1, (1 - t) * 6);
          const sc = 0.6 + 0.5 * Math.sin(pop * Math.PI * 0.5) + (1 - t) * 0.12;
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.scale(sc, sc);
          ctx.font = `800 ${p.size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.lineJoin = 'round';
          ctx.lineWidth = p.size * 0.22;
          ctx.strokeStyle = 'rgba(10,12,20,0.85)';
          ctx.strokeText(p.text ?? '', 0, 0);
          ctx.fillStyle = p.color;
          ctx.fillText(p.text ?? '', 0, 0);
          ctx.restore();
          break;
        }
        case 'skull':
          drawSkull(ctx, p.x, p.y, p.size * (1.2 - t * 0.2), p.color);
          break;
      }
    }
    ctx.globalAlpha = 1;
  }
}

/** Simple vector skull (no font dependency). Centre (x,y), `s` = approx. radius. */
export function drawSkull(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, color: string, eye = '#1a1a1a'): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y - s * 0.12, s * 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillRect(x - s * 0.45, y + s * 0.4, s * 0.9, s * 0.62);
  ctx.fillStyle = eye;
  ctx.beginPath();
  ctx.arc(x - s * 0.33, y - s * 0.1, s * 0.22, 0, Math.PI * 2);
  ctx.arc(x + s * 0.33, y - s * 0.1, s * 0.22, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(x, y + s * 0.15);
  ctx.lineTo(x - s * 0.1, y + s * 0.38);
  ctx.lineTo(x + s * 0.1, y + s * 0.38);
  ctx.fill();
  for (let i = -1; i <= 1; i++) ctx.fillRect(x + i * s * 0.28 - s * 0.03, y + s * 0.62, s * 0.06, s * 0.4);
}
