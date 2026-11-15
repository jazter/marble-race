import { describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import { generateMap } from '../src/gen';
import {
  MAPS_KEY,
  MAX_SAVED_MAPS,
  deleteMap,
  exportMaps,
  importMaps,
  listMaps,
  renameMap,
  saveMap,
  type KV,
} from '../src/ui/savedMaps';

function fake(limit = Infinity): KV & { data: Record<string, string> } {
  const data: Record<string, string> = {};
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      if (v.length > limit) throw new DOMException('full', 'QuotaExceededError');
      data[k] = v;
    },
  };
}

const cfg = defaultConfig();
const map = generateMap(cfg, 7);
const input = (seed: number, name = 'Mapa') => ({ name, seed, config: { ...cfg, seed }, map: { ...map, seed }, firstFinishTime: 12.3 });

describe('savedMaps', () => {
  it('round-trips a map with full data', () => {
    const s = fake();
    const r = saveMap(input(7, ' Mi favorito '), s);
    expect(r.ok).toBe(true);
    const [m] = listMaps(s);
    expect(m.name).toBe('Mi favorito');
    expect(m.map).toEqual({ ...map, seed: 7 });
    expect(m.marbles).toBe(cfg.marbles.count);
    expect(m.segments).toBe(cfg.map.segments);
    expect(m.monsters).toBe(map.monsters?.length ?? 0);
    expect(m.version).toBe(1);
    expect(s.data[MAPS_KEY]).toBeTruthy();
  });

  it('detects duplicates (same seed + config) but allows other seeds', () => {
    const s = fake();
    saveMap(input(7), s);
    const dup = saveMap(input(7, 'otro'), s);
    expect(dup.ok).toBe(false);
    if (!dup.ok) expect(dup.error).toBe('duplicate');
    expect(saveMap(input(8), s).ok).toBe(true);
    expect(listMaps(s)).toHaveLength(2);
  });

  it('orders newest first', () => {
    const s = fake();
    saveMap(input(1, 'a'), s, new Date('2026-01-01'));
    saveMap(input(2, 'b'), s, new Date('2026-03-01'));
    saveMap(input(3, 'c'), s, new Date('2026-02-01'));
    expect(listMaps(s).map((m) => m.name)).toEqual(['b', 'c', 'a']);
  });

  it('enforces the cap without losing maps', () => {
    const s = fake();
    for (let i = 0; i < MAX_SAVED_MAPS; i++) expect(saveMap(input(i + 1), s).ok).toBe(true);
    const r = saveMap(input(999), s);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('full');
    expect(listMaps(s)).toHaveLength(MAX_SAVED_MAPS);
  });

  it('reports quota errors and keeps existing maps', () => {
    const s = fake();
    saveMap(input(1), s);
    const size = s.data[MAPS_KEY].length;
    const tight = fake(size + 10);
    tight.data[MAPS_KEY] = s.data[MAPS_KEY];
    const r = saveMap(input(2), tight);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('quota');
    expect(listMaps(tight)).toHaveLength(1);
  });

  it('renames and deletes', () => {
    const s = fake();
    const r = saveMap(input(1), s);
    if (!r.ok) throw new Error('x');
    expect(renameMap(r.entry.id, 'Nuevo', s)).toBe(true);
    expect(listMaps(s)[0].name).toBe('Nuevo');
    expect(renameMap(r.entry.id, '   ', s)).toBe(false);
    expect(deleteMap('nope', s)).toBe(false);
    expect(deleteMap(r.entry.id, s)).toBe(true);
    expect(listMaps(s)).toEqual([]);
  });

  it('exports and imports, skipping duplicates', () => {
    const a = fake();
    saveMap(input(1, 'uno'), a);
    saveMap(input(2, 'dos'), a);
    const text = exportMaps(a);
    const b = fake();
    saveMap(input(2, 'dos-local'), b);
    const res = importMaps(text, b);
    expect(res).toEqual({ added: 1, skipped: 1 });
    expect(listMaps(b)).toHaveLength(2);
    expect(importMaps(text, b)).toEqual({ added: 0, skipped: 2 });
  });

  it('rejects invalid import data', () => {
    const s = fake();
    expect(importMaps('not json', s).error).toBe('invalid');
    expect(importMaps('{"a":1}', s).error).toBe('invalid');
    expect(importMaps('{"maps":[{"id":"x"},5,null]}', s)).toEqual({ added: 0, skipped: 3 });
    expect(listMaps(s)).toEqual([]);
  });

  it('survives corrupt or missing storage', () => {
    const s = fake();
    s.data[MAPS_KEY] = '{oops';
    expect(listMaps(s)).toEqual([]);
    expect(listMaps(null)).toEqual([]);
    const r = saveMap(input(1), null);
    expect(r.ok).toBe(false);
  });
});

describe('withOutline (maps saved before outlines existed)', () => {
  it('rebuilds the outline from the outer-wall pieces', async () => {
    const { withOutline } = await import('../src/ui/savedMaps');
    const { defaultConfig } = await import('../src/core/config');
    const { generateMap } = await import('../src/gen');
    const { pointInPolygon } = await import('../src/core/math');
    const fresh = generateMap(defaultConfig(), 5);
    const old = { ...fresh };
    delete (old as { outline?: unknown }).outline;
    const fixed = withOutline(old);
    expect(fixed.outline).toBeDefined();
    for (const p of fresh.start.spawnPoints) expect(pointInPolygon(p, fixed.outline!)).toBe(true);
    expect(withOutline(fresh)).toBe(fresh); // already has one
  });
});
