/** Saved maps ("Mis mapas"): pure storage logic over an injectable Storage-like object. */
import type { GameConfig } from '../core/config';
import type { MapDef, Vec } from '../core/types';
import { pointInPolygon } from '../core/math';

export const MAPS_KEY = 'marble-race.maps.v1';
export const MAX_SAVED_MAPS = 30;

export interface SavedMap {
  id: string;
  name: string;
  savedAt: string; // ISO date
  version: 1;
  seed: number;
  config: GameConfig;
  map: MapDef;
  firstFinishTime: number;
  marbles: number;
  segments: number;
  monsters: number;
}

export interface KV {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
}

export type SaveError = 'duplicate' | 'full' | 'quota' | 'unavailable';
export type SaveOutcome = { ok: true; entry: SavedMap } | { ok: false; error: SaveError; existing?: SavedMap };

const defaultStore = (): KV | null => {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
};

/** Everything that affects the generated race (`display` is visual only). */
export function configSignature(c: GameConfig): string {
  return JSON.stringify({ ...c, display: null });
}

export function isSavedMap(x: unknown): x is SavedMap {
  if (!x || typeof x !== 'object') return false;
  const o = x as Record<string, unknown>;
  const map = o.map as Record<string, unknown> | undefined;
  return (
    typeof o.id === 'string' &&
    o.id.length > 0 &&
    typeof o.name === 'string' &&
    typeof o.savedAt === 'string' &&
    o.version === 1 &&
    typeof o.seed === 'number' &&
    Number.isFinite(o.seed) &&
    !!o.config &&
    typeof o.config === 'object' &&
    !!map &&
    typeof map === 'object' &&
    Array.isArray(map.path) &&
    Array.isArray(map.walls) &&
    !!map.bounds &&
    typeof o.firstFinishTime === 'number' &&
    typeof o.marbles === 'number' &&
    typeof o.segments === 'number' &&
    typeof o.monsters === 'number'
  );
}

/** Saved maps, newest first. Never throws. */
export function listMaps(store: KV | null = defaultStore()): SavedMap[] {
  if (!store) return [];
  try {
    const raw = store.getItem(MAPS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr.filter(isSavedMap).sort((a, b) => (a.savedAt < b.savedAt ? 1 : a.savedAt > b.savedAt ? -1 : 0));
  } catch {
    return [];
  }
}

function write(list: SavedMap[], store: KV | null): boolean {
  if (!store) return false;
  try {
    store.setItem(MAPS_KEY, JSON.stringify(list));
    return true;
  } catch {
    return false;
  }
}

export function findDuplicate(list: SavedMap[], seed: number, config: GameConfig): SavedMap | undefined {
  const sig = configSignature(config);
  return list.find((m) => m.seed === seed && configSignature(m.config) === sig);
}

let idCounter = 0;
const newId = (): string => `${Date.now().toString(36)}-${(idCounter++).toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

export interface SaveInput {
  name: string;
  seed: number;
  config: GameConfig;
  map: MapDef;
  firstFinishTime: number;
}

export function saveMap(input: SaveInput, store: KV | null = defaultStore(), now: Date = new Date()): SaveOutcome {
  if (!store) return { ok: false, error: 'unavailable' };
  const list = listMaps(store);
  const existing = findDuplicate(list, input.seed, input.config);
  if (existing) return { ok: false, error: 'duplicate', existing };
  if (list.length >= MAX_SAVED_MAPS) return { ok: false, error: 'full' };
  const entry: SavedMap = {
    id: newId(),
    name: cleanName(input.name) || `Mapa ${input.seed}`,
    savedAt: now.toISOString(),
    version: 1,
    seed: input.seed,
    config: structuredClone(input.config),
    map: structuredClone(input.map),
    firstFinishTime: input.firstFinishTime,
    marbles: input.config.marbles.count,
    segments: input.config.map.segments,
    monsters: input.map.monsters?.length ?? 0,
  };
  return write([entry, ...list], store) ? { ok: true, entry } : { ok: false, error: 'quota' };
}

export const cleanName = (s: string): string => s.trim().slice(0, 40);

export function renameMap(id: string, name: string, store: KV | null = defaultStore()): boolean {
  const list = listMaps(store);
  const m = list.find((x) => x.id === id);
  const n = cleanName(name);
  if (!m || !n) return false;
  m.name = n;
  return write(list, store);
}

export function deleteMap(id: string, store: KV | null = defaultStore()): boolean {
  const list = listMaps(store);
  const next = list.filter((x) => x.id !== id);
  if (next.length === list.length) return false;
  return write(next, store);
}

export function exportMaps(store: KV | null = defaultStore()): string {
  return JSON.stringify({ app: 'marble-race', kind: 'maps', version: 1, maps: listMaps(store) });
}

export interface ImportResult {
  added: number;
  skipped: number; // duplicates, invalid entries or over the cap
  error?: 'invalid' | 'quota';
}

export function importMaps(text: string, store: KV | null = defaultStore()): ImportResult {
  let incoming: unknown;
  try {
    const data = JSON.parse(text);
    incoming = Array.isArray(data) ? data : data && typeof data === 'object' ? (data as { maps?: unknown }).maps : undefined;
  } catch {
    return { added: 0, skipped: 0, error: 'invalid' };
  }
  if (!Array.isArray(incoming)) return { added: 0, skipped: 0, error: 'invalid' };
  const list = listMaps(store);
  const have = new Set(list.map((m) => m.id));
  let added = 0;
  let skipped = 0;
  for (const x of incoming) {
    if (!isSavedMap(x) || have.has(x.id) || findDuplicate(list, x.seed, x.config) || list.length >= MAX_SAVED_MAPS) {
      skipped++;
      continue;
    }
    list.push({ ...x, name: cleanName(x.name) || `Mapa ${x.seed}` });
    have.add(x.id);
    added++;
  }
  if (added === 0) return { added, skipped };
  if (!write(list, store)) return { added: 0, skipped: incoming.length, error: 'quota' };
  return { added, skipped };
}

/**
 * Maps saved before `MapDef.outline` existed: rebuild the course outline from the
 * outer-wall pieces (ids b1..bN are emitted in order along the boundary loop). Returns
 * the map unchanged when it already has one or the rebuilt polygon doesn't look right.
 */
export function withOutline(map: MapDef): MapDef {
  if (map.outline && map.outline.length >= 3) return map;
  const pieces = map.walls
    .filter((w) => /^b\d+$/.test(w.id) && w.shape.type === 'polyline')
    .sort((a, b) => Number(a.id.slice(1)) - Number(b.id.slice(1)));
  const pts: Vec[] = [];
  for (const w of pieces) {
    if (w.shape.type !== 'polyline') continue;
    for (const p of w.shape.points) {
      const last = pts[pts.length - 1];
      if (!last || Math.hypot(last.x - p.x, last.y - p.y) > 1e-6) pts.push({ x: p.x, y: p.y });
    }
  }
  if (pts.length < 4) return map;
  const inside = map.start.spawnPoints.every((p) => pointInPolygon(p, pts)) && map.path.slice(1, -1).every((p) => pointInPolygon(p, pts));
  return inside ? { ...map, outline: pts } : map;
}
