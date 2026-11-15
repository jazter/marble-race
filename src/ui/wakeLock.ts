/**
 * Keep the screen on while racing (like a video player), via the Screen Wake Lock API.
 * Supported by Chrome/Edge (Android, desktop), Safari 16.4+ (iPhone/iPad) and Firefox 126+.
 * Browsers release the lock when the tab is hidden, so it is re-requested on return.
 * Everything degrades silently where the API is missing or refused.
 */
type Sentinel = { release(): Promise<void>; addEventListener(t: 'release', cb: () => void): void };
type WakeLockApi = { request(type: 'screen'): Promise<Sentinel> };

let wanted = false;
let sentinel: Sentinel | null = null;
let pending = false;

function api(): WakeLockApi | null {
  const nav = navigator as Navigator & { wakeLock?: WakeLockApi };
  return nav.wakeLock ?? null;
}

async function acquire(): Promise<void> {
  const wl = api();
  if (!wl || sentinel || pending || document.visibilityState !== 'visible') return;
  pending = true;
  try {
    const s = await wl.request('screen');
    if (!wanted) {
      void s.release().catch(() => {});
      return;
    }
    sentinel = s;
    s.addEventListener('release', () => {
      if (sentinel === s) sentinel = null;
    });
  } catch {
    /* refused (battery saver, not visible, unsupported) — ignore */
  } finally {
    pending = false;
  }
}

function drop(): void {
  const s = sentinel;
  sentinel = null;
  if (s) void s.release().catch(() => {});
}

/** Ask to keep the screen awake (true) or let it sleep normally (false). */
export function setKeepAwake(on: boolean): void {
  wanted = on;
  if (on) void acquire();
  else drop();
}

export function wakeLockSupported(): boolean {
  return !!api();
}

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && wanted) void acquire();
});
// some browsers only grant it after a user gesture: retry on the next tap/click
window.addEventListener('pointerdown', () => {
  if (wanted && !sentinel) void acquire();
});
