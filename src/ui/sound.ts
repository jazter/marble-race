/** Sound button(s), volume slider(s), `M` shortcut and the audio-unlock gesture hook. */
import type { AudioSettings, MusicEngine } from '../audio/music';
import { $ } from './dom';

const ICON_ON =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="M15.5 8.5a5 5 0 0 1 0 7"/><path d="M18.5 5.5a9 9 0 0 1 0 13"/></svg>';
const ICON_OFF =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11 5 6 9H3v6h3l5 4z" fill="currentColor"/><path d="m16 9 6 6"/><path d="m22 9-6 6"/></svg>';

export function initSoundControls(music: MusicEngine, persist: (s: AudioSettings) => void): void {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('.btn-music'));
  const sliders = Array.from(document.querySelectorAll<HTMLInputElement>('input.vol'));
  const valueEl = $('vol-val');

  const render = (): void => {
    const on = music.enabled;
    for (const b of buttons) {
      b.innerHTML = on ? ICON_ON : ICON_OFF;
      b.title = on ? 'Silenciar música (M)' : 'Activar música (M)';
      b.setAttribute('aria-label', 'Música');
      b.setAttribute('aria-pressed', String(on));
    }
    for (const s of sliders) if (Number(s.value) !== music.volume) s.value = String(music.volume);
    valueEl.textContent = String(music.volume);
    document.body.classList.toggle('music-off', !on);
  };

  music.subscribe(() => {
    render();
    persist({ enabled: music.enabled, volume: music.volume });
  });

  for (const b of buttons) b.addEventListener('click', () => music.toggle());
  for (const s of sliders) {
    s.addEventListener('input', () => {
      music.setVolume(Number(s.value));
      if (!music.enabled && music.volume > 0) music.setEnabled(true);
    });
  }

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyM' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
    const t = e.target as HTMLElement | null;
    if (t && (/TEXTAREA|SELECT/.test(t.tagName) || (t.tagName === 'INPUT' && (t as HTMLInputElement).type !== 'range'))) return;
    music.toggle();
  });

  // Browsers only allow audio after a user gesture: unlock on the first one.
  const unlock = (): void => music.unlock();
  for (const type of ['pointerdown', 'pointerup', 'click', 'keydown', 'touchend']) document.addEventListener(type, unlock, { capture: true, passive: true });

  render();
}
