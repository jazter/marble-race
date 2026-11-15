import { defaultConfig, type GameConfig } from '../core/config';
import { defaultAudioSettings, type AudioSettings } from '../audio/music';

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
    if (raw) {
      const saved = JSON.parse(raw);
      mergeInto(cfg as unknown as Record<string, unknown>, saved);
      // Configs saved before monster groups existed stored a plain monster count (old
      // default 3). The field now means groups per map, so adopt the new monster defaults.
      // Configs saved before 'stun' walls existed: lethal special walls are replaced by
      // dazing ones (the player can still turn 'Eliminar' back on).
      const sw = saved && typeof saved === 'object' ? (saved as { walls?: { special?: Record<string, unknown> } }).walls?.special : undefined;
      if (sw && typeof sw === 'object' && !('stun' in sw)) {
        cfg.walls.special.kill = false;
        cfg.walls.special.stun = true;
      }
      const m = saved && typeof saved === 'object' ? (saved as { monsters?: Record<string, unknown> }).monsters : undefined;
      if (m && typeof m === 'object' && !('groupSize' in m)) {
        const d = defaultConfig().monsters;
        cfg.monsters.count = Math.max(cfg.monsters.count, d.count);
        cfg.monsters.groupSize = d.groupSize;
      }
    }
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  // Off-camera elimination was removed from the UI; never revive it from an old saved config.
  cfg.camera.offscreenKill = false;
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

const AUDIO_KEY = 'marble-race:audio';

export function loadAudioSettings(): AudioSettings {
  const s = defaultAudioSettings();
  try {
    const raw = localStorage.getItem(AUDIO_KEY);
    if (raw) {
      const o = JSON.parse(raw) as Partial<AudioSettings>;
      if (typeof o.enabled === 'boolean') s.enabled = o.enabled;
      if (typeof o.volume === 'number' && Number.isFinite(o.volume)) s.volume = Math.min(100, Math.max(0, Math.round(o.volume)));
    }
  } catch {
    /* storage unavailable or corrupt: use defaults */
  }
  return s;
}

export function saveAudioSettings(s: AudioSettings): void {
  try {
    localStorage.setItem(AUDIO_KEY, JSON.stringify({ enabled: s.enabled, volume: s.volume }));
  } catch {
    /* ignore */
  }
}
