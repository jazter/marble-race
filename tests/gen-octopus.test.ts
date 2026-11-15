import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import { generateMap } from '../src/gen';
import type { Vec } from '../src/core/types';

const cfg = () => {
  const c = defaultConfig();
  c.monsters.count = 12;
  return c;
};
const SEEDS = Array.from({ length: 20 }, (_, i) => i + 1);
const FEEDERS = new Set(['funnel', 'pegs', 'funnelGate', 'galton', 'lanes', 'gableSplit', 'pinball', 'triangles', 'propellers']);

function distSeg(p: Vec, a: Vec, b: Vec): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}

describe('octopus placement', () => {
  it('never directly follows a ramp/side-exit segment or chicane without feeding from a spread segment', () => {
    let seen = 0;
    for (const s of SEEDS) {
      const m = generateMap(cfg(), s);
      m.segments.forEach((seg, i) => {
        if (seg.type !== 'octopus') return;
        seen++;
        let j = i - 1;
        while (j >= 0 && (m.segments[j].type === 'snakePit' || m.segments[j].type === 'octopus')) j--;
        const prev = m.segments[j]?.type ?? 'start';
        // a non-feeder predecessor is only allowed when the arena brings its own centring funnel (last slot)
        if (!FEEDERS.has(prev)) expect(m.segments[i + 1]?.type, `seed ${s} after ${prev}`).toBe('finish');
      });
    }
    expect(seen).toBeGreaterThan(5);
  });

  it('keeps the octopus body clear of the walls', () => {
    for (const s of SEEDS) {
      const m = generateMap(cfg(), s);
      for (const o of (m.monsters ?? []).filter((k) => k.kind === 'octopus')) {
        if (o.kind !== 'octopus') continue;
        for (const w of m.walls) {
          if (!w.boundary || w.shape.type !== 'polyline') continue;
          const pts = w.shape.points;
          for (let k = 0; k + 1 < pts.length; k++) {
            expect(distSeg(o.center, pts[k], pts[k + 1]) - o.bodyRadius, `seed ${s}`).toBeGreaterThanOrEqual(3 - 1e-6);
          }
        }
      }
    }
  });

  it('is deterministic', () => {
    const a = generateMap(cfg(), 7);
    const b = generateMap(cfg(), 7);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
