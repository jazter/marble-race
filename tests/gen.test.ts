import { describe, expect, it } from 'vitest';
import { defaultConfig, type GameConfig } from '../src/core/config';
import { dirFromAngle, dot, sub } from '../src/core/math';
import { generateMap } from '../src/gen';
import type { MapDef, Monster, Vec } from '../src/core/types';
import { analyzeAlignment, segmentYRanges } from '../src/gen/analysis';
import { laneLog } from '../src/gen/boards';
import { gableLog } from '../src/gen/pinball';

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
      expect(m.segments.filter((s) => s.type !== 'start' && s.type !== 'finish' && s.type !== 'octopus' && s.type !== 'snakePit').length).toBe(n);
    }
  });

  it('never uses disabled kinds, effects or switches', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const c = cfgWith((x) => {
        x.objects.kinds = { propeller: true, arm2: false, saw: false, triangle: true, hammer: false, flipper: false };
        x.objects.effects = { grow: true, shrink: false, destroy: false, attract: false, repel: true, stun: false };
        x.objects.effectChance = 1;
        x.switches.enabled = false;
      });
      const m = generateMap(c, seed);
      for (const mech of m.mechanisms) {
        expect(['propeller', 'triangle']).toContain(mech.kind);
        if (mech.id.startsWith('regroup')) continue;
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
      x.walls.special = { bounce: false, slow: false, kill: false, launch: false, stun: false };
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

  describe('regroup segments', () => {
    const isRegroup = (t: string): boolean => t === 'funnelGate' || t === 'rotorChamber';
    it.each([0, 1, 2, 4])('honours map.regroups = %i (8 segments)', (n) => {
      for (let seed = 1; seed <= 6; seed++) {
        const m = generateMap(cfgWith((c) => ((c.map.segments = 8), (c.map.regroups = n))), seed);
        const regs = m.segments.filter((s) => isRegroup(s.type));
        expect(regs.length).toBe(n);
        expect(m.segments.filter((s) => s.type !== 'start' && s.type !== 'finish' && s.type !== 'octopus' && s.type !== 'snakePit').length).toBe(8);
        expect(isRegroup(m.segments[1].type)).toBe(false);
        expect(m.mechanisms.filter((x) => x.id.startsWith('regroup') && x.effect === null).length).toBe(n);
      }
    });
    it('clamps to segments - 1 and is absent without propellers', () => {
      const a = generateMap(cfgWith((c) => ((c.map.segments = 3), (c.map.regroups = 4))), 2);
      expect(a.segments.filter((s) => isRegroup(s.type)).length).toBe(2);
      const b = generateMap(cfgWith((c) => ((c.map.regroups = 4), (c.objects.kinds.propeller = false))), 2);
      expect(b.segments.filter((s) => isRegroup(s.type)).length).toBe(0);
      expect(b.mechanisms.some((x) => x.id.startsWith('regroup'))).toBe(false);
    });
    it('is deterministic with regroups', () => {
      const c = cfgWith((x) => (x.map.regroups = 3));
      expect(JSON.stringify(generateMap(c, 11))).toBe(JSON.stringify(generateMap(c, 11)));
    });
  });
});

function monsterPoints(m: Monster): Vec[] {
  switch (m.kind) {
    case 'spider':
      return [m.anchor, { x: m.anchor.x + m.down.x * m.restLength, y: m.anchor.y + m.down.y * m.restLength }, { x: m.anchor.x + m.down.x * m.maxLength, y: m.anchor.y + m.down.y * m.maxLength }];
    case 'octopus':
      return [m.center];
    case 'fish':
      return [m.a, m.b];
    case 'snake':
      return m.passes.flatMap((p) => [p.a, p.b]);
  }
}

function clearance(map: MapDef, p: Vec): number {
  let d = Infinity;
  const seg = (a: Vec, b: Vec): number => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy;
    const t = l2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2));
    return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
  };
  for (const w of map.walls) {
    const s = w.shape;
    if (s.type === 'circle') d = Math.min(d, Math.hypot(p.x - s.center.x, p.y - s.center.y) - s.radius);
    else if (s.type === 'polyline') for (let i = 0; i < s.points.length - 1; i++) d = Math.min(d, seg(s.points[i], s.points[i + 1]) - s.thickness / 2);
  }
  return d;
}

describe('monsters', () => {
  const withM = (count: number, kinds?: Partial<Record<'spider' | 'octopus' | 'fish' | 'snake', boolean>>, ga = 0) =>
    cfgWith((c) => {
      c.monsters.count = count;
      c.physics.gravityAngle = ga;
      if (kinds) c.monsters.kinds = { spider: false, octopus: false, fish: false, snake: false, ...kinds };
    });

  it('honours the group count (0, 1, 3, 8) with groupSize 1', () => {
    // spider/fish need a free regular segment each (cap = free segments); octopus/snake add their own segments
    for (const n of [0, 1, 3, 8])
      for (let seed = 1; seed <= 10; seed++) {
        const c = withM(n);
        c.monsters.groupSize = 1;
        expect((generateMap(c, seed).monsters ?? []).length).toBe(n);
      }
  });

  it('groups have between ceil(g/2) and g members (octopus alone)', () => {
    for (const g of [1, 4, 6])
      for (const kind of ['spider', 'fish', 'snake'] as const)
        for (let seed = 1; seed <= 10; seed++) {
          const c = withM(1, { [kind]: true });
          c.monsters.groupSize = g;
          const ms = generateMap(c, seed).monsters ?? [];
          expect(ms.length).toBeGreaterThanOrEqual(1);
          expect(ms.length).toBeLessThanOrEqual(g);
          if (g === 1) expect(ms.length).toBe(1);
          for (const m of ms) expect(m.kind).toBe(kind);
          expect(new Set(ms.map((m) => m.id)).size).toBe(ms.length);
        }
    for (let seed = 1; seed <= 5; seed++) expect((generateMap(withM(1, { octopus: true }), seed).monsters ?? []).length).toBe(1);
  });

  it('fish schools share span/speed/rest on distinct lanes', () => {
    let multi = 0;
    for (let seed = 1; seed <= 15; seed++) {
      const c = withM(1, { fish: true });
      c.monsters.groupSize = 4;
      const fs = (generateMap(c, seed).monsters ?? []).filter((m) => m.kind === 'fish');
      if (fs.length > 1) multi++;
      for (const f of fs) {
        if (f.kind !== 'fish') continue;
        const l = fs[0];
        if (l.kind !== 'fish') continue;
        expect(f.speed).toBe(l.speed);
        expect(f.rest).toBe(l.rest);
        expect(f.a.x).toBe(l.a.x);
        expect(f.b.x).toBe(l.b.x);
      }
      const lanes = fs.map((f) => (f.kind === 'fish' ? f.a.y : 0));
      expect(new Set(lanes.map((y) => y.toFixed(3))).size).toBe(fs.length);
    }
    expect(multi).toBeGreaterThan(0);
  });

  it('spider colony anchors are at least 2 * huntWidth apart', () => {
    for (let seed = 1; seed <= 15; seed++) {
      const c = withM(1, { spider: true });
      c.monsters.groupSize = 4;
      const ss = (generateMap(c, seed).monsters ?? []).flatMap((m) => (m.kind === 'spider' ? [m] : []));
      for (let i = 0; i < ss.length; i++)
        for (let j = i + 1; j < ss.length; j++) {
          const dx = Math.abs(ss[i].anchor.x - ss[j].anchor.x);
          expect(dx).toBeGreaterThanOrEqual(2 * Math.max(ss[i].huntWidth, ss[j].huntWidth));
        }
    }
  });

  it('snake nests share the passes', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const c = withM(1, { snake: true });
      c.monsters.groupSize = 4;
      const ns = (generateMap(c, seed).monsters ?? []).flatMap((m) => (m.kind === 'snake' ? [m] : []));
      for (const n of ns) expect(n.passes).toEqual(ns[0].passes);
    }
  });

  it('is 0 when no kind is enabled and uses only enabled kinds, varied', () => {
    expect(generateMap(withM(4, {}), 3).monsters ?? []).toEqual([]);
    for (let seed = 1; seed <= 10; seed++) {
      for (const m of generateMap(withM(5, { fish: true, snake: true }), seed).monsters ?? []) expect(['fish', 'snake']).toContain(m.kind);
      const four = (generateMap(withM(4), seed).monsters ?? []).map((m) => m.kind);
      expect(new Set(four).size).toBe(4);
    }
  });

  it('is deterministic', () => {
    expect(JSON.stringify(generateMap(withM(5), 9))).toBe(JSON.stringify(generateMap(withM(5), 9)));
  });

  it('monsters off leaves the map unchanged', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const off = generateMap(withM(0), seed);
      const none = generateMap(withM(3, {}), seed);
      expect(JSON.stringify(none)).toBe(JSON.stringify(off));
      expect(off.monsters).toBeUndefined();
      // spider / fish only: course geometry identical, only monsters added
      const sf = generateMap(withM(2, { spider: true, fish: true }), seed);
      expect(JSON.stringify({ ...sf, monsters: undefined })).toBe(JSON.stringify(off));
    }
  });

  it('keeps every monster point in free space inside the bounds', () => {
    for (const ga of [0, 35, -90])
      for (let seed = 1; seed <= 10; seed++) {
        const m = generateMap(withM(6, undefined, ga), seed);
        for (const mo of m.monsters ?? []) {
          for (const p of monsterPoints(mo)) {
            expect(p.x).toBeGreaterThan(m.bounds.minX);
            expect(p.x).toBeLessThan(m.bounds.maxX);
            expect(p.y).toBeGreaterThan(m.bounds.minY);
            expect(p.y).toBeLessThan(m.bounds.maxY);
            const need = mo.kind === 'octopus' ? mo.bodyRadius : mo.kind === 'spider' ? mo.size : mo.size;
            expect(clearance(m, p)).toBeGreaterThan(need);
          }
        }
      }
  });

  it('rotates with gravity (spider down = flowDir, octopus head up)', () => {
    const m = generateMap(withM(4, { spider: true }, 45), 4);
    for (const mo of m.monsters ?? []) {
      if (mo.kind !== 'spider') continue;
      expect(mo.down.x).toBeCloseTo(m.flowDir.x, 6);
      expect(mo.down.y).toBeCloseTo(m.flowDir.y, 6);
    }
    const o = generateMap(withM(1, { octopus: true }, 45), 4).monsters![0];
    if (o.kind !== 'octopus') throw new Error('expected octopus');
    expect(Math.cos(o.facing) * m.flowDir.x + Math.sin(o.facing) * m.flowDir.y).toBeCloseTo(-1, 6);
  });
});

const baseTypes = (m: MapDef): string[] => m.segments.filter((s) => s.type !== 'start' && s.type !== 'finish' && s.type !== 'octopus' && s.type !== 'snakePit').map((s) => s.type);

describe('ramp alignment and chicanes', () => {
  it('never lines up the gaps of consecutive ramps and alternates chicanes', () => {
    for (let seed = 1; seed <= 30; seed++) {
      for (const f of [(): void => {}, (): void => undefined]) void f;
      const c = cfgWith((x) => ((x.switches.frequency = 0.8), (x.map.segments = 10)));
      const rep = analyzeAlignment(generateMap(c, seed));
      expect(rep.aligned.length).toBe(0);
      expect(rep.sameDirChicanes).toBe(0);
      const rep2 = analyzeAlignment(generateMap(defaultConfig(), seed));
      expect(rep2.aligned.length).toBe(0);
      expect(rep2.sameDirChicanes).toBe(0);
    }
  });
});

describe('galton and lanes segments', () => {
  const R = 0.45 * 2;
  it.each([6, 8, 12])('places both at least once with %i segments, not first, not adjacent', (n) => {
    for (let seed = 1; seed <= 12; seed++) {
      const m = generateMap(cfgWith((c) => (c.map.segments = n)), seed);
      const types = baseTypes(m);
      expect(types.length).toBe(n);
      expect(types.filter((t) => t === 'galton').length).toBeGreaterThanOrEqual(1);
      expect(types.filter((t) => t === 'lanes').length).toBeGreaterThanOrEqual(1);
      expect(types[0]).not.toBe('galton');
      expect(types[0]).not.toBe('lanes');
      expect(types.filter((t) => t === 'funnelGate' || t === 'rotorChamber').length).toBe(2);
      // the planned pair is never adjacent (extra random picks may be)
      const gs = types.flatMap((t, i) => (t === 'galton' ? [i] : []));
      const ls = types.flatMap((t, i) => (t === 'lanes' ? [i] : []));
      expect(gs.some((g) => ls.some((l) => Math.abs(g - l) > 1))).toBe(true);
    }
  });

  it('does not force them below 6 segments', () => {
    const m = generateMap(cfgWith((c) => (c.map.segments = 4)), 3);
    expect(baseTypes(m).length).toBe(4);
  });

  it('builds lanes within the width rule (2..5 lanes) and shrinks the count on narrow corridors', () => {
    for (const w of [10, 16, 24]) {
      let seen = 0;
      for (let seed = 1; seed <= 25; seed++) {
        const c = cfgWith((x) => ((x.map.width = w), (x.map.segments = 8)));
        const m = generateMap(c, seed);
        for (const st of laneLog) {
          seen++;
          const n = st.length;
          expect(n).toBeGreaterThanOrEqual(2);
          expect(n).toBeLessThanOrEqual(5);
          const lane = (w - 0.5 - (n - 1) * 0.24) / n;
          expect(lane).toBeGreaterThanOrEqual(Math.max(2.8, 3.2 * R) - 1e-9);
          expect(st).toContain('rapido');
        }
        expect(m.segments.some((s) => s.type === 'lanes')).toBe(true);
      }
      expect(seen).toBeGreaterThan(0);
    }
    // 16 m can hold 5 lanes
    let max = 0;
    for (let seed = 1; seed <= 40; seed++) {
      generateMap(cfgWith((x) => (x.map.segments = 8)), seed);
      for (const st of laneLog) max = Math.max(max, st.length);
    }
    expect(max).toBe(5);
  });

  it('galton pegs keep the gap rule, bins are open at the bottom and slats are walls', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const m = generateMap(cfgWith((c) => (c.map.segments = 8)), seed);
      const rng = segmentYRanges(m).find((s) => s.type === 'galton');
      expect(rng).toBeDefined();
      const r = rng as { y0: number; y1: number };
      const pegs = m.walls.filter((w) => (w.style === 'peg' || w.style === 'bumper') && w.shape.type === 'circle' && w.shape.center.y > r.y0 && w.shape.center.y < r.y1);
      expect(pegs.length).toBeGreaterThan(15);
      const rp = 0.45 * 1.5;
      for (const a of pegs)
        for (const b of pegs) {
          if (a === b || a.shape.type !== 'circle' || b.shape.type !== 'circle') continue;
          const d = Math.hypot(a.shape.center.x - b.shape.center.x, a.shape.center.y - b.shape.center.y) - a.shape.radius - b.shape.radius;
          // wall-embedded neighbours aside, no pair of pegs is closer than the marble gap rule... except mirrored pairs on one wall row
          if (d < 2.2 * 2 * rp - 1e-6) expect(d).toBeGreaterThan(2.2 * 2 * rp - 1e-6);
        }
      const slats = m.walls.filter((w) => w.style === 'wall' && w.shape.type === 'polygon' && w.shape.points.length === 5 && w.shape.points[0].y > r.y0 && w.shape.points[0].y < r.y1);
      expect(slats.length).toBeGreaterThanOrEqual(1);
      for (const w of slats) expect(w.reaction).toBe('solid');
      expect(pegs.every((w) => w.reaction !== 'kill' && w.reaction !== 'slow')).toBe(true);
    }
  });

  it('is deterministic with the new segments', () => {
    const c = cfgWith((x) => (x.map.segments = 10));
    expect(JSON.stringify(generateMap(c, 21))).toBe(JSON.stringify(generateMap(c, 21)));
  });

  it('keeps switches and monsters out of them', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const c = cfgWith((x) => ((x.map.segments = 10), (x.switches.frequency = 1), (x.monsters.count = 8)));
      const m = generateMap(c, seed);
      const ranges = segmentYRanges(m).filter((s) => s.type === 'galton' || s.type === 'lanes');
      for (const r of ranges) {
        for (const sw of m.switches) expect(sw.position.y < r.y0 || sw.position.y > r.y1).toBe(true);
        // only a spider may hang in the merge funnel at the end of the segment
        for (const mo of m.monsters ?? []) for (const p of monsterPoints(mo)) expect(p.y < r.y0 || p.y > r.y1 || (mo.kind === 'spider' && p.y > r.y1 - 20)).toBe(true);
      }
    }
  });
});

describe('mixed boundary', () => {
  const mixedCfg = (extra?: (c: GameConfig) => void): GameConfig => cfgWith((c) => ((c.walls.boundary = 'mixed'), (c.map.segments = 10), extra?.(c)));
  const pieces = (m: MapDef) => m.walls.filter((w) => /^b\d+$/.test(w.id));

  it('gives several different reactions, launch pushes along the flow, rare harmful pieces daze (stun), never kill', () => {
    const seen = new Set<string>();
    let kills = 0;
    let total = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const m = generateMap(mixedCfg(), seed);
      const ps0 = pieces(m);
      // lethal pieces: capped (1 per 4 segments), never adjacent, never diagonal
      const k = ps0.filter((w) => w.reaction === 'stun');
      expect(k.length).toBeLessThanOrEqual(Math.floor(10 / 4));
      for (let i = 1; i < ps0.length; i++) expect(ps0[i].reaction === 'stun' && ps0[i - 1].reaction === 'stun').toBe(false);
      for (const w of k) {
        if (w.shape.type !== 'polyline') continue;
        const a = w.shape.points[0];
        const b = w.shape.points[w.shape.points.length - 1];
        expect(Math.abs(b.x - a.x)).toBeLessThanOrEqual(Math.abs(b.y - a.y) * Math.tan((12 * Math.PI) / 180) + 1e-6);
      }
      kills += k.length;
      total += ps0.length;
      for (const w of ps0) {
        expect(w.boundary).toBe(true);
        expect(w.reaction).not.toBe('kill');
        seen.add(w.reaction);
        if (w.reaction === 'launch') {
          expect(w.launchDir).toBeDefined();
          expect(dot(w.launchDir as Vec, m.flowDir)).toBeGreaterThan(0.8);
        }
      }
      // never two launch pieces in a row
      const ps = pieces(m);
      for (let i = 1; i < ps.length; i++) expect(ps[i].reaction === 'launch' && ps[i - 1].reaction === 'launch').toBe(false);
      expect(ps.filter((w) => w.reaction !== 'solid').length).toBeGreaterThan(3);
    }
    expect(seen.has('solid') && seen.has('bounce') && seen.has('slow') && seen.has('launch')).toBe(true);
    // kill shows up, but rarely
    expect(kills).toBeGreaterThan(0);
    expect(kills / total).toBeLessThan(0.05);
  });

  it('never makes lethal pieces when kill walls are disabled', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const m = generateMap(mixedCfg((x) => (x.walls.special.kill = false)), seed);
      for (const w of pieces(m)) expect(w.reaction).not.toBe('kill');
    }
  });

  it('keeps start box, finish and regroup / galton / lanes walls solid', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const m = generateMap(mixedCfg(), seed);
      const prot = segmentYRanges(m).filter((s) => s.type === 'funnelGate' || s.type === 'rotorChamber' || s.type === 'galton' || s.type === 'lanes' || s.type === 'finish' || s.type === 'start');
      expect(prot.length).toBeGreaterThan(3);
      for (const w of pieces(m)) {
        if (w.shape.type !== 'polyline' || w.reaction === 'solid') continue;
        const ys = w.shape.points.map((p) => p.y);
        const y0 = Math.min(...ys);
        const y1 = Math.max(...ys);
        for (const r of prot) {
          // a non-solid piece must not overlap a protected range (start / finish use their own bounds)
          if (r.type === 'start') expect(y0).toBeGreaterThan(1.9);
          else if (r.type === 'finish') expect(y1).toBeLessThanOrEqual(r.y0 + 1.6 + 1e-6);
          else expect(y1 <= r.y0 + 3 || y0 >= r.y1 - 8).toBe(true);
        }
      }
    }
  });

  it('only changes the boundary pieces compared with solid mode', () => {
    for (let seed = 1; seed <= 6; seed++) {
      const strip = (m: MapDef): string => JSON.stringify({ ...m, walls: m.walls.filter((w) => !/^b\d+$/.test(w.id)) });
      const a = generateMap(cfgWith((c) => ((c.walls.boundary = 'solid'), (c.map.segments = 10))), seed);
      const b = generateMap(mixedCfg(), seed);
      expect(strip(b)).toBe(strip(a));
      // same outer outline: every solid piece's points lie on the solid outline
      const len = (m: MapDef): number => pieces(m).reduce((t, w) => t + (w.shape.type === 'polyline' ? w.shape.points.slice(1).reduce((s, p, i) => s + Math.hypot(p.x - (w.shape as { points: Vec[] }).points[i].x, p.y - (w.shape as { points: Vec[] }).points[i].y), 0) : 0), 0);
      expect(len(b)).toBeCloseTo(len(a), 3);
    }
  });

  it('respects disabled special reactions and is deterministic', () => {
    const c = mixedCfg((x) => (x.walls.special = { bounce: true, slow: false, kill: true, launch: false, stun: false }));
    const m = generateMap(c, 4);
    for (const w of pieces(m)) expect(['solid', 'bounce', 'kill']).toContain(w.reaction);
    expect(JSON.stringify(generateMap(c, 4))).toBe(JSON.stringify(generateMap(c, 4)));
  });

  it('kill mode never uses mixed reactions', () => {
    const m = generateMap(cfgWith((c) => (c.walls.boundary = 'kill')), 3);
    for (const w of pieces(m)) expect(w.reaction).toBe('solid');
  });
});

describe('course outline', () => {
  it('is a closed polygon that contains the spawn points, the path and the finish line', async () => {
    const { pointInPolygon } = await import('../src/core/math');
    for (const ga of [0, 35, -90]) {
      for (const seed of [1, 2, 3]) {
        const m = generateMap(cfgWith((c) => (c.physics.gravityAngle = ga)), seed);
        expect(m.outline).toBeDefined();
        const o = m.outline as Vec[];
        expect(o.length).toBeGreaterThan(3);
        for (const p of m.start.spawnPoints) expect(pointInPolygon(p, o)).toBe(true);
        for (const p of m.path.slice(1, -1)) expect(pointInPolygon(p, o)).toBe(true);
        const mid = { x: (m.finish.a.x + m.finish.b.x) / 2, y: (m.finish.a.y + m.finish.b.y) / 2 };
        expect(pointInPolygon(mid, o)).toBe(true);
      }
    }
  });
});

describe('pinball and gableSplit segments', () => {
  const cfg10 = (f?: (c: GameConfig) => void): GameConfig => cfgWith((c) => ((c.map.segments = 10), f?.(c)));

  it('places one of each with >= 8 segments (never first, not on regroups)', () => {
    for (const n of [8, 10, 12]) {
      for (let seed = 1; seed <= 12; seed++) {
        const m = generateMap(cfgWith((c) => (c.map.segments = n)), seed);
        const types = baseTypes(m);
        expect(types.filter((t) => t === 'pinball').length).toBe(1);
        expect(types.filter((t) => t === 'gableSplit').length).toBe(1);
        expect(types[0]).not.toBe('pinball');
        expect(types[0]).not.toBe('gableSplit');
      }
    }
  });

  it('is absent below 8 segments and pinball is absent without flippers', () => {
    const m = generateMap(cfgWith((c) => (c.map.segments = 6)), 3);
    expect(baseTypes(m)).not.toContain('pinball');
    expect(baseTypes(m)).not.toContain('gableSplit');
    for (let seed = 1; seed <= 8; seed++) {
      const g = generateMap(cfg10((c) => (c.objects.kinds.flipper = false)), seed);
      expect(baseTypes(g)).not.toContain('pinball');
      expect(baseTypes(g)).toContain('gableSplit');
      expect(g.mechanisms.some((x) => x.kind === 'flipper')).toBe(false);
    }
  });

  it('builds sane flippers: two per pinball, pivot at one end, rest/up apart, speeds > 0', () => {
    for (let seed = 1; seed <= 10; seed++) {
      const m = generateMap(cfg10(), seed);
      const rng = segmentYRanges(m).find((s) => s.type === 'pinball') as { y0: number; y1: number };
      const fl = m.mechanisms.filter((x) => x.kind === 'flipper');
      const inSeg = fl.filter((x) => x.pivot.y > rng.y0 && x.pivot.y < rng.y1);
      expect(inSeg.length).toBe(2);
      for (const f of fl) {
        expect(f.links.length).toBe(1);
        expect(f.effect).toBeNull();
        const mo = f.links[0].motion;
        if (mo.type !== 'flipper') throw new Error('not a flipper');
        expect(Math.abs(mo.up - mo.rest)).toBeGreaterThan(0.5);
        expect(Math.abs(mo.up - mo.rest)).toBeLessThan(1.6);
        expect(mo.upSpeed).toBeGreaterThan(0);
        expect(mo.downSpeed).toBeGreaterThan(0);
        expect(mo.hold).toBeGreaterThanOrEqual(0);
        expect(mo.cooldown).toBeGreaterThan(0);
        for (const sh of f.links[0].shapes) if (sh.type === 'polygon') expect(sh.points.length).toBeLessThanOrEqual(8);
      }
      // drain between the flipper pivots is wide enough for the biggest marble
      const [a, b] = inSeg.sort((p, q) => p.pivot.x - q.pivot.x);
      expect(b.pivot.x - a.pivot.x).toBeGreaterThan(3 * 0.9 + 3.5);
    }
  });

  it('gives the two roof lanes different trap sets', () => {
    for (let seed = 1; seed <= 15; seed++) {
      generateMap(cfg10(), seed);
      expect(gableLog.length).toBe(2);
      const [l, r] = gableLog;
      expect(l.length).toBeGreaterThanOrEqual(2);
      expect(r.length).toBeGreaterThanOrEqual(2);
      expect([...l].sort().join()).not.toBe([...r].sort().join());
      expect(l.some((t) => r.includes(t))).toBe(false);
    }
  });

  it('respects disabled kinds / reactions in the lanes', () => {
    for (let seed = 1; seed <= 8; seed++) {
      const c = cfg10((x) => {
        x.objects.kinds = { propeller: false, arm2: false, saw: false, triangle: false, hammer: false, flipper: false };
        x.walls.special = { bounce: true, slow: false, kill: false, launch: false, stun: false };
        x.objects.zones = false;
      });
      const m = generateMap(c, seed);
      for (const w of m.walls) expect(w.reaction === 'kill' || w.reaction === 'slow' || w.reaction === 'launch').toBe(false);
      for (const mech of m.mechanisms) expect(mech.id.startsWith('regroup')).toBe(true);
      expect(gableLog.flat().every((t) => ['impulso', 'rebote', 'clavos', 'escalones'].includes(t))).toBe(true);
    }
  });

  it('is deterministic, keeps switches / monsters out and rotates flipper angles with gravity', () => {
    const c = cfg10((x) => ((x.switches.frequency = 1), (x.monsters.count = 8)));
    expect(JSON.stringify(generateMap(c, 9))).toBe(JSON.stringify(generateMap(c, 9)));
    for (let seed = 1; seed <= 8; seed++) {
      const m = generateMap(c, seed);
      for (const r of segmentYRanges(m).filter((s) => s.type === 'pinball' || s.type === 'gableSplit')) {
        for (const sw of m.switches) expect(sw.position.y < r.y0 || sw.position.y > r.y1).toBe(true);
        for (const mo of m.monsters ?? []) for (const p of monsterPoints(mo)) expect(p.y < r.y0 || p.y > r.y1).toBe(true);
      }
    }
    const a = generateMap(cfg10(), 4);
    const b = generateMap(cfg10((x) => (x.physics.gravityAngle = 35)), 4);
    const fa = a.mechanisms.filter((x) => x.kind === 'flipper')[0].links[0].motion;
    const fb = b.mechanisms.filter((x) => x.kind === 'flipper')[0].links[0].motion;
    if (fa.type !== 'flipper' || fb.type !== 'flipper') throw new Error('x');
    expect(fb.rest - fa.rest).toBeCloseTo((-35 * Math.PI) / 180, 6);
    expect(fb.up - fa.up).toBeCloseTo((-35 * Math.PI) / 180, 6);
  });

  it('keeps their outer walls solid with kill / mixed boundaries', () => {
    for (const bd of ['kill', 'mixed'] as const) {
      for (let seed = 1; seed <= 6; seed++) {
        const m = generateMap(cfg10((x) => (x.walls.boundary = bd)), seed);
        for (const r of segmentYRanges(m).filter((s) => s.type === 'pinball' || s.type === 'gableSplit')) {
          for (const w of m.walls) {
            if (!/^b\d+$/.test(w.id) || w.shape.type !== 'polyline' || w.reaction === 'solid') continue;
            const ys = w.shape.points.map((p) => p.y);
            expect(Math.max(...ys) <= r.y0 + 3 || Math.min(...ys) >= r.y1 - 8).toBe(true);
          }
        }
      }
    }
  });
});

describe('stun replaces kill by default', () => {
  it('default maps have no lethal walls but do have stun walls', () => {
    let stun = 0;
    for (let seed = 1; seed <= 10; seed++) {
      const m = generateMap(defaultConfig(), seed);
      for (const w of m.walls) {
        expect(w.reaction).not.toBe('kill');
        if (w.reaction === 'stun') stun++;
      }
    }
    expect(stun).toBeGreaterThan(5);
  });
  it('kill walls only appear when the player enables them', () => {
    const c = cfgWith((x) => (x.walls.special = { bounce: true, slow: true, kill: true, launch: true, stun: false }));
    let kill = 0;
    for (let seed = 1; seed <= 10; seed++) for (const w of generateMap(c, seed).walls) if (w.reaction === 'kill') kill++;
    expect(kill).toBeGreaterThan(0);
  });
});
