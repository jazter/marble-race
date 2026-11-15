import { afterEach, describe, expect, it } from 'vitest';
import { defaultConfig } from '../src/core/config';
import { loadConfig } from '../src/ui/storage';

const KEY = 'marble-race.config.v1';
function fakeStorage(init: Record<string, string>): void {
  const data = { ...init };
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => (k in data ? data[k] : null),
    setItem: (k: string, v: string) => void (data[k] = v),
    removeItem: (k: string) => void delete data[k],
  };
}
afterEach(() => {
  delete (globalThis as { localStorage?: unknown }).localStorage;
});

describe('loadConfig migrations', () => {
  it('moves configs saved before monster groups to the new monster defaults', () => {
    const old = defaultConfig() as unknown as { monsters: Record<string, unknown> };
    old.monsters = { ...old.monsters, count: 3 };
    delete old.monsters.groupSize;
    fakeStorage({ [KEY]: JSON.stringify(old) });
    const cfg = loadConfig();
    expect(cfg.monsters.count).toBe(defaultConfig().monsters.count);
    expect(cfg.monsters.groupSize).toBe(defaultConfig().monsters.groupSize);
  });
  it('keeps a monster count chosen after groups existed', () => {
    const cur = defaultConfig();
    cur.monsters.count = 2;
    cur.monsters.groupSize = 1;
    fakeStorage({ [KEY]: JSON.stringify(cur) });
    const cfg = loadConfig();
    expect(cfg.monsters.count).toBe(2);
    expect(cfg.monsters.groupSize).toBe(1);
  });
  it('works without storage', () => {
    expect(loadConfig().monsters.count).toBe(defaultConfig().monsters.count);
  });
});
