import { describe, expect, it } from 'vitest';
import { defaultConfig, type SkinType } from '../src/core/config';
import { catalogForType, colorDistance, createRoster, skinCatalog } from '../src/core/roster';

const ALL: SkinType[] = ['solid', 'bicolor', 'tricolor', 'striped', 'multicolor', 'silver', 'gold', 'glass'];

const cfg = (count: number, only?: SkinType[]) => {
  const c = defaultConfig();
  c.marbles.count = count;
  if (only) for (const k of ALL) c.marbles.skins[k] = only.includes(k);
  return c;
};
const look = (p: { skin: { type: string; colors: string[] } }) => `${p.skin.type}|${p.skin.colors.join(',')}`;

describe('createRoster', () => {
  it('is deterministic', () => {
    expect(createRoster(cfg(50), 7)).toEqual(createRoster(cfg(50), 7));
    expect(createRoster(cfg(50), 7)).not.toEqual(createRoster(cfg(50), 8));
  });

  it.each([1, 20, 200])('returns %i marbles with ids, keys and unique names', (n) => {
    const r = createRoster(cfg(n), 42);
    expect(r).toHaveLength(n);
    r.forEach((p, i) => expect(p.id).toBe(i));
    expect(new Set(r.map((p) => p.name)).size).toBe(n);
    expect(new Set(r.map((p) => p.key)).size).toBe(n);
    for (const p of r) {
      expect(p.skin.colors.length).toBeGreaterThan(0);
      expect(p.key).toMatch(/^[a-z0-9-]+$/);
      expect(p.name).not.toMatch(/\b[IVXLC]{2,}\b/);
    }
  });

  it('uses only enabled skin types', () => {
    const c = cfg(100, ['gold', 'striped']);
    const types = new Set(createRoster(c, 3).map((p) => p.skin.type));
    expect([...types].every((t) => t === 'gold' || t === 'striped')).toBe(true);
  });

  it('single enabled type applies to all; solid is about 45% in a mix', () => {
    expect(createRoster(cfg(60, ['glass']), 1).every((p) => p.skin.type === 'glass')).toBe(true);
    const mix = createRoster(cfg(200), 5);
    const solid = mix.filter((p) => p.skin.type === 'solid').length / 200;
    expect(solid).toBeGreaterThan(0.33);
    expect(solid).toBeLessThan(0.57);
  });

  it('all names and all looks are unique, with all types and with each type alone', () => {
    for (const only of [undefined, ...ALL.map((t) => [t])] as (SkinType[] | undefined)[]) {
      for (const n of [1, 20, 100, 200]) {
        const r = createRoster(cfg(n, only), 11);
        expect(r).toHaveLength(n);
        expect(new Set(r.map((p) => p.name)).size, `names ${only} ${n}`).toBe(n);
        expect(new Set(r.map(look)).size, `looks ${only} ${n}`).toBe(n);
        expect(new Set(r.map((p) => p.key)).size, `keys ${only} ${n}`).toBe(n);
      }
    }
  });

  it('every type catalog has at least 200 entries and no cross-type name/key clashes', () => {
    const names = new Set<string>();
    const keys = new Set<string>();
    for (const t of ALL) {
      const cat = catalogForType(t);
      expect(cat.length, t).toBeGreaterThanOrEqual(200);
      for (const e of cat) {
        expect(e.skin.type).toBe(t);
        expect(names.has(e.name), e.name).toBe(false);
        expect(keys.has(e.key), e.key).toBe(false);
        names.add(e.name);
        keys.add(e.key);
      }
    }
  });

  it('keys are the same set for every seed; only the order changes', () => {
    const a = createRoster(cfg(60), 1);
    const b = createRoster(cfg(60), 999);
    expect(new Set(a.map((p) => p.key))).toEqual(new Set(b.map((p) => p.key)));
    expect(a.map((p) => p.key)).not.toEqual(b.map((p) => p.key));
    const byKey = new Map(a.map((p) => [p.key, p]));
    for (const p of b) {
      expect(byKey.get(p.key)!.name).toBe(p.name);
      expect(byKey.get(p.key)!.skin).toEqual(p.skin);
    }
  });

  it('raising the count only adds entries', () => {
    const small = skinCatalog(ALL, 30).map((e) => e.key);
    const big = skinCatalog(ALL, 120).map((e) => e.key);
    expect(big.slice(0, 30)).toEqual(small);
    const s20 = new Set(createRoster(cfg(20), 5).map((p) => p.key));
    const s80 = new Set(createRoster(cfg(80), 5).map((p) => p.key));
    for (const k of s20) expect(s80.has(k)).toBe(true);
  });

  it('first 20 solids are clearly different colours; first 40 never near-duplicates', () => {
    const sol = catalogForType('solid');
    const dist = (n: number) => {
      let min = Infinity;
      for (let i = 0; i < n; i++)
        for (let j = i + 1; j < n; j++) min = Math.min(min, colorDistance(sol[i].skin.colors[0], sol[j].skin.colors[0]));
      return min;
    };
    expect(dist(16)).toBeGreaterThan(20);
    expect(dist(20)).toBeGreaterThan(14);
    expect(dist(40)).toBeGreaterThan(9);
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

describe('multicolour catalog', () => {
  it('never repeats a palette in a different order (conic skins rotate while rolling)', () => {
    const sigs = catalogForType('multicolor').map((e) => [...e.skin.colors].sort().join(','));
    expect(new Set(sigs).size).toBe(sigs.length);
    expect(sigs.length).toBeGreaterThanOrEqual(200);
  });
});

describe('preferred (named) looks', () => {
  const cfgN = (n: number) => {
    const c = defaultConfig();
    c.marbles.count = n;
    return c;
  };
  it('keeps named marbles when the count goes down', () => {
    const full = createRoster(cfgN(20), 7);
    const named = full.filter((_, i) => i % 4 === 0).map((p) => p.key!); // 5 looks
    const small = createRoster(cfgN(8), 7, named);
    expect(small.length).toBe(8);
    for (const k of named) expect(small.some((p) => p.key === k)).toBe(true);
    expect(new Set(small.map((p) => p.key)).size).toBe(8);
  });
  it('only drops named marbles when the count is below the number of named ones', () => {
    const named = skinCatalog(['solid', 'bicolor', 'tricolor', 'striped', 'multicolor', 'silver', 'gold', 'glass'], 30)
      .slice(20, 30)
      .map((e) => e.key);
    const r = createRoster(cfgN(4), 3, named);
    expect(r.length).toBe(4);
    expect(r.every((p) => named.includes(p.key!))).toBe(true);
  });
  it('is identical to the plain roster without preferred keys, and deterministic', () => {
    expect(createRoster(cfgN(20), 5, [])).toEqual(createRoster(cfgN(20), 5));
    const named = ['solid-rubi', 'gold-oro'];
    expect(createRoster(cfgN(10), 5, named)).toEqual(createRoster(cfgN(10), 5, named));
  });
  it('ignores named looks whose skin type is disabled', () => {
    const c = cfgN(6);
    c.marbles.skins.gold = false;
    const r = createRoster(c, 1, ['gold-oro', 'solid-rubi']);
    expect(r.some((p) => p.key === 'gold-oro')).toBe(false);
    expect(r.some((p) => p.key === 'solid-rubi')).toBe(true);
  });
});
