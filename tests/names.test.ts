import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MarbleProfile } from '../src/core/types';
import { clearCustomNames, displayName, getAllCustomNames, getCustomName, onNamesChanged, setCustomName } from '../src/ui/names';

const profile = (key: string | undefined, name = 'Rubí'): MarbleProfile => ({ id: 0, name, key, skin: { type: 'solid', colors: ['red'] } });

function fakeStorage(): Storage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: () => null,
    get length() {
      return data.size;
    },
  } as Storage & { data: Map<string, string> };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('names with a working localStorage', () => {
  let st: ReturnType<typeof fakeStorage>;
  beforeEach(() => {
    st = fakeStorage();
    vi.stubGlobal('localStorage', st);
    clearCustomNames();
  });

  it('sets, gets, trims and caps names', () => {
    expect(getCustomName('solid-rubi')).toBeNull();
    setCustomName('solid-rubi', '  Rayo   Veloz  ');
    expect(getCustomName('solid-rubi')).toBe('Rayo Veloz');
    setCustomName('solid-zafiro', 'x'.repeat(60));
    expect(getCustomName('solid-zafiro')).toHaveLength(24);
    expect(getAllCustomNames()).toEqual({ 'solid-rubi': 'Rayo Veloz', 'solid-zafiro': 'x'.repeat(24) });
  });

  it('persists in localStorage under the v1 key', () => {
    setCustomName('solid-rubi', 'Pepe');
    expect(JSON.parse(st.data.get('marble-race.names.v1')!)).toEqual({ 'solid-rubi': 'Pepe' });
  });

  it('empty or null removes the name', () => {
    setCustomName('a', 'Uno');
    setCustomName('a', '   ');
    expect(getCustomName('a')).toBeNull();
    setCustomName('a', 'Uno');
    setCustomName('a', null);
    expect(getCustomName('a')).toBeNull();
  });

  it('clearCustomNames resets everything', () => {
    setCustomName('a', 'Uno');
    setCustomName('b', 'Dos');
    clearCustomNames();
    expect(getAllCustomNames()).toEqual({});
    expect(st.data.has('marble-race.names.v1')).toBe(false);
  });

  it('displayName prefers the custom name', () => {
    expect(displayName(profile('solid-rubi'))).toBe('Rubí');
    setCustomName('solid-rubi', 'Pepe');
    expect(displayName(profile('solid-rubi'))).toBe('Pepe');
    expect(displayName(profile(undefined))).toBe('Rubí');
  });

  it('ignores corrupt stored data', () => {
    st.data.set('marble-race.names.v1', '{not json');
    expect(getAllCustomNames()).toEqual({});
    st.data.set('marble-race.names.v1', JSON.stringify({ a: 'ok', b: 3 }));
    expect(getAllCustomNames()).toEqual({ a: 'ok' });
  });

  it('notifies listeners until unsubscribed', () => {
    const cb = vi.fn();
    const off = onNamesChanged(cb);
    setCustomName('a', 'Uno');
    clearCustomNames();
    expect(cb).toHaveBeenCalledTimes(2);
    off();
    setCustomName('a', 'Dos');
    expect(cb).toHaveBeenCalledTimes(2);
  });
});

describe('names without usable storage', () => {
  it('works in memory when localStorage is missing', () => {
    vi.stubGlobal('localStorage', undefined);
    clearCustomNames();
    setCustomName('a', 'Uno');
    expect(getCustomName('a')).toBe('Uno');
    expect(displayName(profile('a'))).toBe('Uno');
    clearCustomNames();
    expect(getCustomName('a')).toBeNull();
  });

  it('works in memory when every access throws', () => {
    const boom = () => {
      throw new Error('denied');
    };
    vi.stubGlobal('localStorage', { getItem: boom, setItem: boom, removeItem: boom });
    clearCustomNames();
    expect(() => setCustomName('a', 'Uno')).not.toThrow();
    expect(getCustomName('a')).toBe('Uno');
    expect(getAllCustomNames()).toEqual({ a: 'Uno' });
    expect(() => clearCustomNames()).not.toThrow();
    expect(getAllCustomNames()).toEqual({});
  });
});
