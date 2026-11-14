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
