/**
 * MusicEngine: public API of the procedural soundtrack.
 * Owns the AudioContext, the lookahead scheduler ("A Tale of Two Clocks":
 * a ~25 ms timer schedules ~120 ms ahead on AudioContext.currentTime) and the
 * mute / volume / pause logic. It only ever reads game state, never writes it.
 * Every entry point is safe to call when Web Audio is missing or locked.
 */
import { countdownBlipMidis, type Level } from './composer';
import { Sequencer, type Scene } from './sequencer';
import { DEFAULT_VOLUME, Synth, volumeToGain } from './synth';

export interface AudioSettings {
  enabled: boolean;
  volume: number;
}

export const defaultAudioSettings = (): AudioSettings => ({ enabled: true, volume: DEFAULT_VOLUME });

const LOOKAHEAD = 0.12;
const TIMER_MS = 25;
const PAUSE_FADE = 0.12;

type AudioCtor = typeof AudioContext;

export class MusicEngine {
  private ctx: AudioContext | null = null;
  private synth: Synth | null = null;
  private seq: Sequencer | null = null;
  private timer: number | undefined;
  private suspendTimer: number | undefined;
  private failed = false;
  /** Scene the game wants; applied as soon as the context exists. */
  private want: Scene = 'idle';
  private wantLevel: Level = 1;
  private paused = false;
  private onChange: (() => void) | null = null;

  constructor(private settings: AudioSettings = defaultAudioSettings()) {}

  static supported(): boolean {
    if (typeof window === 'undefined') return false;
    const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
    return !!(w.AudioContext || w.webkitAudioContext);
  }

  get enabled(): boolean {
    return this.settings.enabled;
  }
  get volume(): number {
    return this.settings.volume;
  }
  /** True once an AudioContext exists (user gesture happened). */
  get unlocked(): boolean {
    return this.ctx !== null;
  }
  /** Subscribe to settings changes made through the engine (for UI sync / persistence). */
  subscribe(fn: () => void): void {
    this.onChange = fn;
  }

  /* ------------------------------------------------------------ context */

  /** Create / resume the AudioContext. Call from a user gesture. */
  unlock(): void {
    if (this.failed) return;
    if (this.ctx && this.ctx.state === 'running') return;
    if (!this.ctx) {
      if (!this.settings.enabled || !MusicEngine.supported()) return;
      try {
        const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
        const Ctor = (w.AudioContext ?? w.webkitAudioContext) as AudioCtor;
        this.ctx = new Ctor({ latencyHint: 'interactive' });
        this.synth = new Synth(this.ctx, this.settings.volume);
        this.seq = new Sequencer(this.synth, 7);
        this.timer = window.setInterval(() => this.tick(), TIMER_MS);
        this.applyScene(true);
      } catch {
        this.failed = true;
        this.ctx = null;
        this.synth = null;
        this.seq = null;
        return;
      }
    }
    this.syncActive();
  }

  private get active(): boolean {
    return this.settings.enabled && !this.paused;
  }

  /** Fade master in/out according to enabled/paused; suspend the context while silent. */
  private syncActive(): void {
    const ctx = this.ctx;
    const synth = this.synth;
    if (!ctx || !synth) return;
    window.clearTimeout(this.suspendTimer);
    if (this.active) {
      const go = () => synth.setMaster(volumeToGain(this.settings.volume), ctx.currentTime, 0.06);
      if (ctx.state === 'running') go();
      else {
        synth.master.gain.value = 0;
        void ctx.resume().then(go, () => undefined);
      }
    } else if (ctx.state === 'running') {
      synth.setMaster(0, ctx.currentTime, PAUSE_FADE / 3);
      this.suspendTimer = window.setTimeout(() => {
        if (!this.active) void ctx.suspend().catch(() => undefined);
      }, PAUSE_FADE * 1000 + 120);
    }
  }

  private tick(): void {
    const ctx = this.ctx;
    if (!ctx || !this.seq || ctx.state !== 'running') return;
    this.seq.advance(ctx.currentTime + LOOKAHEAD, ctx.currentTime);
  }

  /* ----------------------------------------------------------- settings */

  setEnabled(on: boolean): void {
    if (on === this.settings.enabled) return;
    this.settings.enabled = on;
    if (on) this.unlock();
    else this.syncActive();
    this.onChange?.();
  }

  toggle(): void {
    this.setEnabled(!this.settings.enabled);
  }

  setVolume(v: number): void {
    this.settings.volume = Math.min(100, Math.max(0, Math.round(v)));
    if (this.ctx && this.synth && this.active && this.ctx.state === 'running') {
      this.synth.setMaster(volumeToGain(this.settings.volume), this.ctx.currentTime, 0.04);
    }
    this.onChange?.();
  }

  /** Pause / resume with a quick fade (game pause). */
  setPaused(p: boolean): void {
    if (p === this.paused) return;
    this.paused = p;
    this.syncActive();
  }

  /* -------------------------------------------------------------- scenes */

  private applyScene(force: boolean): void {
    const ctx = this.ctx;
    const seq = this.seq;
    if (!ctx || !seq) return;
    const at = ctx.currentTime + 0.06;
    switch (this.want) {
      case 'calm':
        if (force || seq.scene !== 'calm') seq.setScene('calm', at, seq.scene === 'outro' ? 1.2 : 0.5);
        break;
      case 'countdown':
        seq.setScene('countdown', at, 0.25);
        break;
      case 'race':
        seq.setScene('race', at, 0.08, this.wantLevel);
        break;
      default:
        break;
    }
  }

  /** Preview / generating / idle: anticipation layer (pad + soft tick + quiet bass). */
  calm(): void {
    this.paused = false;
    if (this.want === 'calm' && this.seq?.scene === 'calm') return;
    this.want = 'calm';
    this.applyScene(false);
    this.syncActive();
  }

  /** A race (re)starts: ticking countdown. Also resets pause state. */
  startCountdown(): void {
    this.paused = false;
    this.want = 'countdown';
    if (this.seq) this.seq.countdownProgress = 0;
    this.applyScene(true);
    this.syncActive();
  }

  setCountdownProgress(p: number): void {
    if (this.seq) this.seq.countdownProgress = Math.min(1, Math.max(0, p));
  }

  /** Countdown blips: 3, 2, 1 and 0 = ¡YA! (also starts the groove). */
  cue(n: number): void {
    const ctx = this.ctx;
    const seq = this.seq;
    if (n === 0) {
      this.want = 'race';
      this.wantLevel = 1;
    }
    if (!ctx || !seq) return;
    const at = ctx.currentTime + 0.02;
    if (n > 0) {
      if (seq.scene === 'countdown') seq.blip(at, countdownBlipMidis(n), 0.22, 0.8);
      return;
    }
    seq.setScene('race', at + 0.01, 0.08, 1);
    seq.blip(at, countdownBlipMidis(0), 0.5, 1);
  }

  /** Race state from the director. Level only ever goes up within a race. */
  setRaceState(level: Level, leaderFrac: number): void {
    const seq = this.seq;
    if (this.want !== 'race') return;
    this.wantLevel = Math.max(this.wantLevel, level) as Level;
    if (!seq || seq.scene !== 'race') return;
    seq.target = Math.max(seq.target, level) as Level;
    seq.leaderFrac = leaderFrac;
  }

  firstFinish(): void {
    if (this.seq && this.seq.scene === 'race') this.seq.stingPending = true;
  }

  /** Race over: groove fades out on the next beat, resolving D major + calm pad. */
  raceOver(): void {
    const ctx = this.ctx;
    const seq = this.seq;
    if (this.want === 'outro') return;
    this.want = 'outro';
    if (!ctx || !seq || seq.scene === 'idle') return;
    const t = Math.max(seq.nextBeatTime(), ctx.currentTime + 0.05);
    seq.setScene('outro', t, 0.6, 0, t);
  }

  /** Stop completely (fade out). */
  stop(): void {
    this.want = 'idle';
    if (this.ctx && this.seq) this.seq.silence(this.ctx.currentTime, 0.4);
  }

  dispose(): void {
    window.clearInterval(this.timer);
    window.clearTimeout(this.suspendTimer);
    void this.ctx?.close().catch(() => undefined);
    this.ctx = null;
    this.synth = null;
    this.seq = null;
  }
}
