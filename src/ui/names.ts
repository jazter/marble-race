/**
 * Spectator-given marble names, remembered by marble look (`MarbleProfile.key`)
 * across races. Persisted in localStorage; works without it (in-memory fallback).
 */
import type { MarbleProfile } from '../core/types';

const KEY = 'marble-race.names.v1';
export const MAX_NAME_LENGTH = 24;

/** Session fallback / mirror of what was last read or written. */
let memory: Record<string, string> = {};
const listeners = new Set<() => void>();

function readStorage(): Record<string, string> | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return {};
    const o: unknown = JSON.parse(raw);
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (typeof v === 'string' && v.trim()) out[k] = v;
    }
    return out;
  } catch {
    return null;
  }
}

function writeStorage(data: Record<string, string>): void {
  try {
    if (Object.keys(data).length === 0) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify(data));
  } catch {
    /* storage unavailable: the in-memory copy still serves this session */
  }
}

function load(): Record<string, string> {
  const stored = readStorage();
  if (stored) memory = stored;
  return memory;
}

function notify(): void {
  for (const cb of [...listeners]) {
    try {
      cb();
    } catch {
      /* a broken listener must not stop the others */
    }
  }
}

function clean(name: string): string {
  return name.replace(/\s+/g, ' ').trim().slice(0, MAX_NAME_LENGTH).trim();
}

export function getCustomName(key: string): string | null {
  const v = load()[key];
  return typeof v === 'string' && v ? v : null;
}

/** Empty / null removes the name. Names are trimmed and capped at 24 characters. */
export function setCustomName(key: string, name: string | null): void {
  if (!key) return;
  const next = { ...load() };
  const n = name == null ? '' : clean(name);
  if (n) next[key] = n;
  else delete next[key];
  memory = next;
  writeStorage(next);
  notify();
}

export function getAllCustomNames(): Record<string, string> {
  return { ...load() };
}

export function clearCustomNames(): void {
  memory = {};
  writeStorage({});
  notify();
}

/** Custom name if the spectators gave one to this look, else the catalog name. */
export function displayName(profile: MarbleProfile): string {
  return (profile.key ? getCustomName(profile.key) : null) ?? profile.name;
}

export function onNamesChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}
