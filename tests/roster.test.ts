import { describe, expect, it } from 'vitest';
import { defaultConfig, type SkinType } from '../src/core/config';
import { createRoster } from '../src/core/roster';

const cfg = (count: number) => {
  const c = defaultConfig();
  c.marbles.count = count;
  return c;
};

describe('createRoster', () => {
  it('is deterministic', () => {
    expect(createRoster(cfg(50), 7)).toEqual(createRoster(cfg(50), 7));
    expect(createRoster(cfg(50), 7)).not.toEqual(createRoster(cfg(50), 8));
  });

  it.each([1, 20, 200])('returns %i marbles with ids and unique names', (n) => {
    const r = createRoster(cfg(n), 42);
    expect(r).toHaveLength(n);
    r.forEach((p, i) => expect(p.id).toBe(i));
    expect(new Set(r.map((p) => p.name)).size).toBe(n);
    for (const p of r) expect(p.skin.colors.length).toBeGreaterThan(0);
  });

  it('uses only enabled skin types', () => {
    const c = cfg(100);
    for (const k of Object.keys(c.marbles.skins) as SkinType[]) c.marbles.skins[k] = false;
    c.marbles.skins.gold = true;
    c.marbles.skins.striped = true;
    const types = new Set(createRoster(c, 3).map((p) => p.skin.type));
    expect([...types].every((t) => t === 'gold' || t === 'striped')).toBe(true);
  });

  it('single enabled type applies to all; solid is about 45% in a mix', () => {
    const c = cfg(60);
    for (const k of Object.keys(c.marbles.skins) as SkinType[]) c.marbles.skins[k] = false;
    c.marbles.skins.glass = true;
    expect(createRoster(c, 1).every((p) => p.skin.type === 'glass')).toBe(true);
    const mix = createRoster(cfg(200), 5);
    const solid = mix.filter((p) => p.skin.type === 'solid').length / 200;
    expect(solid).toBeGreaterThan(0.33);
    expect(solid).toBeLessThan(0.57);
  });

  it('colour counts match skin types', () => {
    for (const p of createRoster(cfg(200), 9)) {
      const n = p.skin.colors.length;
      if (p.skin.type === 'solid') expect(n).toBe(1);
      if (p.skin.type === 'bicolor' || p.skin.type === 'striped') expect(n).toBe(2);
      if (p.skin.type === 'tricolor') expect(n).toBe(3);
      if (p.skin.type === 'multicolor') expect(n).toBeGreaterThanOrEqual(5);
    }
  });
});
