import { describe, expect, it } from 'vitest';
import { defaultConfig, type GameConfig } from '../src/core/config';
import { dirFromAngle, dot, sub } from '../src/core/math';
import { generateMap } from '../src/gen';
import type { MapDef, Vec } from '../src/core/types';

const cfgWith = (f: (c: GameConfig) => void): GameConfig => {
  const c = defaultConfig();
  f(c);
  return c;
};

function allPoints(m: MapDef): Vec[] {
  const out: Vec[] = [...m.path, ...m.start.spawnPoints, ...m.start.area, m.finish.a, m.finish.b, ...m.finish.sensor];
  for (const w of m.walls) {
    if (w.shape.type === 'circle') out.push(w.shape.center);
    else out.push(...w.shape.points);
  }
  for (const g of m.gates) if (g.shape.type !== 'circle') out.push(...g.shape.points);
  for (const x of m.mechanisms) out.push(x.pivot);
  for (const z of m.zones) out.push(...(z.shape.type === 'circle' ? [z.shape.center] : z.shape.points));
  for (const s of m.switches) out.push(s.position);
  return out;
}

function allFinite(x: unknown): boolean {
  if (typeof x === 'number') return Number.isFinite(x);
  if (Array.isArray(x)) return x.every(allFinite);
  if (x && typeof x === 'object') return Object.entries(x).every(([k, v]) => (k === 'effect' && v === null) || allFinite(v));
  return x !== undefined;
}

function isConvex(p: Vec[]): boolean {
  let sign = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length], c = p[(i + 2) % p.length];
    const cr = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (Math.abs(cr) < 1e-9) continue;
    const s = Math.sign(cr);
    if (sign && s !== sign) return false;
    sign = s;
  }
  return sign !== 0;
}

describe('generator', () => {
  it('is deterministic and seed dependent', () => {
    const c = defaultConfig();
    expect(JSON.stringify(generateMap(c, 7))).toBe(JSON.stringify(generateMap(c, 7)));
    expect(JSON.stringify(generateMap(c, 7))).not.toBe(JSON.stringify(generateMap(c, 8)));
  });

  it.each([1, 20, 200])('spawns %i marbles', (n) => {
    const m = generateMap(cfgWith((c) => (c.marbles.count = n)), 3);
    expect(m.start.spawnPoints.length).toBe(n);
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) {
        const d = Math.hypot(m.start.spawnPoints[i].x - m.start.spawnPoints[j].x, m.start.spawnPoints[i].y - m.start.spawnPoints[j].y);
        expect(d).toBeGreaterThanOrEqual(2.3 * 0.45 - 1e-6);
      }
  });

  for (const ga of [0, 45, -90]) {
    it(`structural checks at gravityAngle ${ga}`, () => {
      for (let seed = 1; seed <= 12; seed++) {
        const c = cfgWith((x) => (x.physics.gravityAngle = ga));
        const m = generateMap(c, seed);
        expect(allFinite(m)).toBe(true);
        // ids
        const ids = [...m.walls, ...m.gates, ...m.mechanisms, ...m.zones, ...m.switches].map((x) => x.id);
        expect(new Set(ids).size).toBe(ids.length);
        // polygons
        const polys: Vec[][] = [m.finish.sensor];
        for (const w of m.walls) if (w.shape.type === 'polygon') polys.push(w.shape.points);
        for (const g of m.gates) if (g.shape.type === 'polygon') polys.push(g.shape.points);
        for (const z of m.zones) if (z.shape.type === 'polygon') polys.push(z.shape.points);
        for (const mech of m.mechanisms)
          for (const l of mech.links) for (const s of l.shapes) if (s.type === 'polygon') polys.push(s.points);
        for (const p of polys) {
          expect(p.length).toBeLessThanOrEqual(8);
          expect(isConvex(p)).toBe(true);
        }
        for (const w of m.walls) if (w.shape.type === 'polyline') expect(w.shape.thickness).toBeGreaterThanOrEqual(0.3), expect(w.shape.thickness).toBeLessThanOrEqual(0.6);
        // path advances along flow
        for (let i = 1; i < m.path.length; i++) expect(dot(sub(m.path[i], m.path[i - 1]), m.flowDir)).toBeGreaterThan(0);
        // bounds
        for (const p of allPoints(m)) {
          expect(p.x).toBeGreaterThan(m.bounds.minX);
          expect(p.x).toBeLessThan(m.bounds.maxX);
          expect(p.y).toBeGreaterThan(m.bounds.minY);
          expect(p.y).toBeLessThan(m.bounds.maxY);
        }
        // boundary continuity
        const b = m.walls.filter((w) => w.boundary);
        expect(b.length).toBeGreaterThan(0);
        for (let i = 1; i < b.length; i++) {
          const a = b[i - 1].shape, n = b[i].shape;
          if (a.type !== 'polyline' || n.type !== 'polyline') throw new Error('boundary must be polyline');
          const e = a.points[a.points.length - 1], s = n.points[0];
          expect(Math.hypot(e.x - s.x, e.y - s.y)).toBeLessThan(1e-9);
        }
        // segments ranges
        for (const sg of m.segments) expect(sg.to).toBeGreaterThanOrEqual(sg.from);
      }
    });
  }

  it('rotates with gravity', () => {
    const m = generateMap(cfgWith((c) => (c.physics.gravityAngle = 45)), 5);
    expect(m.flowDir.x).toBeCloseTo(0.7071, 3);
    expect(m.flowDir.y).toBeCloseTo(0.7071, 3);
    const f = dirFromAngle(45);
    const total = dot(sub(m.path[m.path.length - 1], m.path[0]), f);
    expect(total).toBeGreaterThan(100);
  });

  it('honours segment count', () => {
    for (const n of [0, 1, 5, 12]) {
      const m = generateMap(cfgWith((c) => (c.map.segments = n)), 2);
      expect(m.segments.filter((s) => s.type !== 'start' && s.type !== 'finish').length).toBe(n);
    }
  });

  it('never uses disabled kinds, effects or switches', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const c = cfgWith((x) => {
        x.objects.kinds = { propeller: true, arm2: false, saw: false, triangle: true, hammer: false };
        x.objects.effects = { grow: true, shrink: false, destroy: false, attract: false, repel: true };
        x.objects.effectChance = 1;
        x.switches.enabled = false;
      });
      const m = generateMap(c, seed);
      for (const mech of m.mechanisms) {
        expect(['propeller', 'triangle']).toContain(mech.kind);
        expect(['grow', 'repel']).toContain(mech.effect);
      }
      for (const z of m.zones) expect(['grow', 'repel']).toContain(z.effect);
      expect(m.switches.length).toBe(0);
      expect(m.gates.filter((g) => g.role === 'switch').length).toBe(0);
    }
    const c2 = cfgWith((x) => {
      x.objects.zones = false;
      x.switches.actions = { lowGravity: true, highGravity: false, tiltGravity: false, reverseGravity: false, reverseMechanisms: false, fastMechanisms: false, wind: false, bouncy: false, openGate: false };
      x.switches.frequency = 1;
      x.walls.special = { bounce: false, slow: false, kill: false, launch: false };
      x.walls.specialRatio = 1;
    });
    for (let seed = 1; seed <= 8; seed++) {
      const m = generateMap(c2, seed);
      expect(m.zones.length).toBe(0);
      for (const s of m.switches) expect(s.action.type).toBe('lowGravity');
      for (const w of m.walls) expect(w.reaction).toBe('solid');
    }
  });

  it('never puts kill on ramps and launch never goes backwards', () => {
    for (let seed = 1; seed <= 20; seed++) {
      const m = generateMap(cfgWith((c) => (c.walls.specialRatio = 1)), seed);
      for (const w of m.walls) {
        if (w.style === 'ramp') expect(w.reaction).not.toBe('kill');
        if (w.launchDir) expect(dot(w.launchDir, m.flowDir)).toBeGreaterThan(0);
      }
    }
  });

  it('bin is big enough', () => {
    const m = generateMap(cfgWith((c) => (c.marbles.count = 200)), 1);
    const bottom = m.bounds.maxY - 15;
    expect(bottom - m.finish.a.y).toBeGreaterThan(60);
  });
});

describe('kill boundary', () => {
  it('keeps most outer walls solid and only a few obstacle sections lethal', () => {
    for (const seed of [1, 2, 3]) {
      const solid = generateMap(defaultConfig(), seed);
      const kill = generateMap(cfgWith((c) => (c.walls.boundary = 'kill')), seed);
      // non-kill boundary: every outer-wall piece is a boundary wall
      expect(solid.walls.filter((w) => /^b\d+$/.test(w.id) && !w.boundary).length).toBe(0);
      const lethal = kill.walls.filter((w) => w.boundary);
      const protectedPieces = kill.walls.filter((w) => /^b\d+$/.test(w.id) && !w.boundary && w.reaction === 'solid');
      expect(protectedPieces.length).toBeGreaterThan(0);
      if (kill.segments.some((s) => ['pegs', 'propellers', 'arms', 'saws', 'triangles', 'hammers'].includes(s.type))) {
        expect(lethal.length).toBeGreaterThan(0);
      }
      // everything else about the map is unchanged
      expect(kill.mechanisms).toEqual(solid.mechanisms);
      expect(kill.path).toEqual(solid.path);
    }
  });
});
