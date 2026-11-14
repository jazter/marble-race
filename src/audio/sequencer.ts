/**
 * Step sequencer: walks a 16th-note grid and turns composer events into
 * synth calls. It never looks at the wall clock; `advance(until)` schedules
 * every step that starts before `until` (in AudioContext time).
 */
import {
  OUTRO_BARS,
  STEPS_PER_BAR,
  TEMPO_CALM,
  TEMPO_OUTRO,
  TEMPO_RACE,
  chordForBar,
  generateStep,
  outroStep,
  stingEvents,
  tempoFor,
  type Level,
  type NoteEvent,
} from './composer';
import type { Segment, Synth } from './synth';

export type Scene = 'idle' | 'calm' | 'countdown' | 'race' | 'outro';

export class Sequencer {
  scene: Scene = 'idle';
  bar = 0;
  step = 0;
  nextTime = 0;
  /** Level currently playing (applied on bar boundaries). */
  level: Level = 0;
  /** Level requested by the game; applied at the next bar boundary. */
  target: Level = 0;
  leaderFrac = 0;
  countdownProgress = 0;
  stingPending = false;
  private seg: Segment | null = null;
  private rotation = 0;

  constructor(
    private synth: Synth,
    private seed = 1,
  ) {}

  get segment(): Segment | null {
    return this.seg;
  }

  tempo(): number {
    switch (this.scene) {
      case 'outro':
        return TEMPO_OUTRO;
      case 'countdown':
        return TEMPO_RACE;
      case 'race':
        return tempoFor(this.level, this.leaderFrac);
      default:
        return TEMPO_CALM;
    }
  }

  stepDur(): number {
    return 60 / this.tempo() / 4;
  }

  /** Time of the next quarter-note beat that has not been scheduled yet. */
  nextBeatTime(): number {
    const k = (4 - (this.step % 4)) % 4;
    return this.nextTime + k * this.stepDur();
  }

  /** Start a new scene at `at`; the previous section fades out over `fade` seconds. */
  setScene(scene: Scene, at: number, fade: number, level: Level = 0, fadeStart = at): void {
    if (this.seg) this.synth.disposeSegment(this.seg, fadeStart, fade);
    this.seg = null;
    this.scene = scene;
    this.bar = 0;
    this.step = 0;
    this.nextTime = at;
    this.level = level;
    this.target = level;
    this.stingPending = false;
    if (scene === 'race') this.rotation++;
    if (scene !== 'idle') this.seg = this.synth.newSegment(3 * this.stepDur());
  }

  /** Fade everything out and stop scheduling. */
  silence(at: number, fade: number): void {
    if (this.seg) this.synth.disposeSegment(this.seg, at, fade);
    this.seg = null;
    this.scene = 'idle';
  }

  /** Schedule every step starting before `until`. `now` lets us skip steps after a stall. */
  advance(until: number, now = -Infinity): void {
    if (this.scene !== 'idle' && this.nextTime < now - 0.1) {
      const n = Math.floor((now + 0.02 - this.nextTime) / this.stepDur());
      for (let i = 0; i < n; i++) {
        this.bump();
        if (this.step === 0 && this.scene === 'race') this.level = this.target;
      }
      this.nextTime += n * this.stepDur();
    }
    while (this.scene !== 'idle' && this.nextTime < until) {
      const t = this.nextTime;
      const dur = this.stepDur();
      this.playStep(t, dur);
      if ((this.scene as Scene) === 'idle') break;
      this.nextTime = t + dur;
      this.bump();
    }
  }

  private bump(): void {
    if (++this.step >= STEPS_PER_BAR) {
      this.step = 0;
      this.bar++;
    }
  }

  private playStep(t: number, dur: number): void {
    const seg = this.seg;
    if (!seg) return;
    if (this.scene === 'outro' && this.bar >= OUTRO_BARS) {
      this.silence(t, 2.5);
      return;
    }
    if (this.step === 0) {
      if (this.scene === 'race') this.level = this.target;
      else if (this.scene !== 'outro') this.level = 0;
      this.synth.setSegmentDelay(seg, 3 * dur, t);
    }
    let events: NoteEvent[];
    if (this.scene === 'outro') events = outroStep(this.bar, this.step);
    else {
      events = generateStep({
        bar: this.bar,
        step: this.step,
        level: this.level,
        seed: this.seed + this.rotation * 101,
        countdown: this.scene === 'countdown' ? this.countdownProgress : undefined,
      });
      if (this.stingPending && this.scene === 'race' && this.step % 4 === 0) {
        events = events.concat(stingEvents(chordForBar(this.bar)));
        this.stingPending = false;
      }
    }
    for (const ev of events) this.play(ev, t + (ev.off ?? 0) * dur, dur);
  }

  private play(ev: NoteEvent, t: number, dur: number): void {
    const seg = this.seg;
    if (!seg) return;
    const s = this.synth;
    const len = ev.steps * dur;
    switch (ev.voice) {
      case 'bass':
        s.bass(seg, t, ev.midi as number, len, ev.vel);
        break;
      case 'kick':
        s.kick(seg, t, ev.vel);
        break;
      case 'tick':
        s.tick(seg, t, ev.vel, !!ev.accent);
        break;
      case 'clap':
        s.clap(seg, t, ev.vel);
        break;
      case 'arp':
        s.arp(seg, t, ev.midi as number, len, ev.vel, !!ev.bright);
        break;
      case 'pad':
        s.pad(seg, t, ev.midis as number[], len, ev.vel);
        break;
      case 'outroPad':
        s.outroPad(seg, t, ev.midis as number[], len, ev.vel);
        break;
      case 'swell':
        s.swell(seg, t, len, ev.vel);
        break;
      case 'sting':
        s.sting(seg, t, ev.midi as number, len, ev.vel);
        break;
      case 'bell':
        s.bell(seg, t, ev.midi as number, len, ev.vel);
        break;
    }
  }

  /** One-shot blip (countdown), played immediately into the current segment. */
  blip(t: number, midis: number[], dur: number, vel: number): void {
    if (!this.seg) return;
    for (const m of midis) this.synth.blip(this.seg, t, m, dur, vel);
  }
}
