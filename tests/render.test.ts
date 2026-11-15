import { describe, expect, it } from 'vitest';
import { sampleMap } from '../src/core/fixtures';
import { alpha, mix, parseColor } from '../src/render/color';
import { mechanismPoseAt } from '../src/render/poses';

describe('render helpers', () => {
  it('computes mechanism poses at t=0 and rotates over time', () => {
    const map = sampleMap();
    const arm = map.mechanisms.find((m) => m.kind === 'arm2')!;
    const p0 = mechanismPoseAt(arm, 0);
    expect(p0.links).toHaveLength(2);
    expect(p0.links[0]).toMatchObject({ x: arm.pivot.x, y: arm.pivot.y, angle: 0 });
    // second link pivots at the tip of the first (3 m along +x at angle 0)
    expect(p0.links[1].x).toBeCloseTo(arm.pivot.x + 3);
    expect(p0.field).toBeDefined();
    const p1 = mechanismPoseAt(arm, 1);
    expect(p1.links[0].angle).toBeCloseTo(1);
    const hammer = map.mechanisms.find((m) => m.kind === 'hammer')!;
    expect(mechanismPoseAt(hammer, 0.5).links[0].angle).toBeCloseTo(0.9 * Math.sin(Math.PI * 0.5));
  });

  it('parses and mixes colours', () => {
    expect(parseColor('#ff0000')).toEqual({ r: 255, g: 0, b: 0 });
    expect(parseColor('hsl(120, 100%, 50%)').g).toBeCloseTo(255);
    expect(mix('#000000', '#ffffff', 0.5)).toBe('rgb(128,128,128)');
    expect(alpha('#ffffff', 0.5)).toBe('rgba(255,255,255,0.5)');
  });
});

import { _internals as mon, monsterBounds } from '../src/render/monsters';
import { MOCK_MONSTERS, mockFrame } from '../src/dev/mockMonsters';

describe('monster rendering helpers', () => {
  it('builds a rest state for every kind and bounds that contain it', () => {
    for (const def of MOCK_MONSTERS) {
      const st = mon.restState(def);
      const b = monsterBounds(def);
      expect(st.kind).toBe(def.kind);
      expect(st.x).toBeGreaterThan(b.x0);
      expect(st.x).toBeLessThan(b.x1);
      expect(st.y).toBeGreaterThan(b.y0);
      expect(st.y).toBeLessThan(b.y1);
    }
    expect(mon.restState(MOCK_MONSTERS[1]).tentacles).toHaveLength(8);
  });

  it('two-bone IK keeps bone lengths when the target is reachable', () => {
    const r = mon.ik(0, 0, 2, 1, 1.5, 1.5, 1);
    expect(Math.hypot(r.kx, r.ky)).toBeCloseTo(1.5);
    expect(Math.hypot(r.ex - r.kx, r.ey - r.ky)).toBeCloseTo(1.5);
  });

  it('mock timeline stays consistent (held marbles exist)', () => {
    for (let t = 0; t < 32; t += 0.5) {
      const f = mockFrame(t);
      for (const st of f.states) for (const id of st.holding) expect(f.marbles.some((m) => m.id === id)).toBe(true);
    }
  });
});

import { SCENE_PALETTES, scenePalette } from '../src/render/backgrounds';

describe('scenic backgrounds', () => {
  it('has a palette per scenic kind and none for auto', () => {
    expect(scenePalette('auto')).toBeNull();
    for (const k of ['sea', 'space', 'clouds', 'dinosaurs', 'castle'] as const) {
      expect(scenePalette(k)).toBe(SCENE_PALETTES[k]);
      expect(SCENE_PALETTES[k].wall).toMatch(/^#/);
    }
  });
});

describe('flipper preview pose', () => {
  it('a flipper at rest uses its rest angle regardless of time', () => {
    
    const mech = {
      id: 'f',
      kind: 'flipper' as const,
      pivot: { x: 3, y: 4 },
      links: [
        {
          shapes: [{ type: 'box' as const, cx: -1, cy: 0, hw: 1, hh: 0.2, angle: 0 }],
          motion: { type: 'flipper' as const, rest: -0.45, up: 0.5, upSpeed: 6, downSpeed: 4, hold: 0.12, cooldown: 0.35 },
        },
      ],
      effect: null,
    };
    expect(mechanismPoseAt(mech, 0).links[0]).toEqual({ x: 3, y: 4, angle: -0.45 });
    expect(mechanismPoseAt(mech, 99).links[0].angle).toBe(-0.45);
  });
});
