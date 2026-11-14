import { defaultConfig, type GameConfig } from '../core/config';

const KEY = 'marble-race.config.v1';

/** Copy values from `src` into `dst` only where `dst` already has a key of the same type. */
function mergeInto(dst: Record<string, unknown>, src: unknown): void {
  if (!src || typeof src !== 'object') return;
  const s = src as Record<string, unknown>;
  for (const k of Object.keys(dst)) {
    if (!(k in s)) continue;
    const dv = dst[k];
    const sv = s[k];
    if (dv && typeof dv === 'object' && !Array.isArray(dv)) mergeInto(dv as Record<string, unknown>, sv);
    else if (typeof dv === typeof sv && (typeof sv !== 'number' || Number.isFinite(sv))) dst[k] = sv;
  }
}

export function loadConfig(): GameConfig {
  const cfg = defaultConfig();
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) mergeInto(cfg as unknown as Record<string, unknown>, JSON.parse(raw));
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  return cfg;
}

export function saveConfig(cfg: GameConfig): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cfg));
  } catch {
    /* ignore */
  }
}

export function clearSavedConfig(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    /* ignore */
  }
}
