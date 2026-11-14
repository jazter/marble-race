/**
 * Pure, deterministic music generation (no Web Audio, no DOM): given a bar,
 * a 16th-note step and an intensity level it returns the notes to play.
 *
 * Key: D minor (harmonic: D E F G A Bb C#). One bar per chord: Dm - Bb - Gm - A.
 * 4/4, 16 steps (16th notes) per bar.
 */

export type Level = 0 | 1 | 2 | 3;

export const STEPS_PER_BAR = 16;
export const PROGRESSION_LENGTH = 4;
export const SECTION_BARS = 8;

/** Pitch classes of D harmonic minor (D E F G A Bb C#). */
export const D_HARMONIC_MINOR_PCS: readonly number[] = [2, 4, 5, 7, 9, 10, 1];
/** Pitch classes of D major (picardy finale): D E F# G A B C#. */
export const D_MAJOR_PCS: readonly number[] = [2, 4, 6, 7, 9, 11, 1];

export interface Chord {
  name: string;
  rootPc: number;
  /** Semitones from root to the third (3 = minor, 4 = major). */
  third: number;
  /** MIDI note of the root in the bass register. */
  bassRoot: number;
}

export const PROGRESSION: readonly Chord[] = [
  { name: 'Dm', rootPc: 2, third: 3, bassRoot: 50 },
  { name: 'Bb', rootPc: 10, third: 4, bassRoot: 46 },
  { name: 'Gm', rootPc: 7, third: 3, bassRoot: 43 },
  { name: 'A', rootPc: 9, third: 4, bassRoot: 45 },
];

export const chordForBar = (bar: number): Chord => PROGRESSION[((bar % PROGRESSION_LENGTH) + PROGRESSION_LENGTH) % PROGRESSION_LENGTH];
export const chordPcs = (c: Chord): number[] => [c.rootPc, (c.rootPc + c.third) % 12, (c.rootPc + 7) % 12];
export const pitchClass = (midi: number): number => ((midi % 12) + 12) % 12;
export const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** Smallest MIDI note >= `low` having pitch class `pc`. */
function atOrAbove(pc: number, low: number): number {
  return low + ((pc - low) % 12 + 12) % 12;
}

export type Voice = 'bass' | 'tick' | 'kick' | 'clap' | 'arp' | 'pad' | 'swell' | 'sting' | 'bell' | 'outroPad';

export interface NoteEvent {
  voice: Voice;
  /** Single pitch (bass, arp, sting, bell). */
  midi?: number;
  /** Several pitches (pad). */
  midis?: number[];
  /** Velocity 0..1. */
  vel: number;
  /** Duration in 16th steps. */
  steps: number;
  /** Delay from the step start, in 16th steps. */
  off?: number;
  accent?: boolean;
  /** Arp only: use the brighter timbre (final stretch). */
  bright?: boolean;
}

/* ------------------------------------------------------------- tempo */

export const TEMPO_RACE = 132;
export const TEMPO_FINAL = 140;
export const TEMPO_CALM = 128;
export const TEMPO_OUTRO = 100;
export const FINAL_PROGRESS = 0.75;

/** Race tempo in BPM; independent from the sim speed. Nudges up in the final stretch. */
export function tempoFor(level: Level, leaderFrac = 0): number {
  if (level >= 3) {
    const k = Math.min(1, Math.max(0, (leaderFrac - FINAL_PROGRESS) / (1 - FINAL_PROGRESS)));
    return TEMPO_RACE + (TEMPO_FINAL - TEMPO_RACE) * k;
  }
  return level === 0 ? TEMPO_CALM : TEMPO_RACE;
}

/* --------------------------------------------------------- intensity */

export interface IntensityInput {
  /** Seconds since the start gate opened (negative during the countdown). */
  raceTime: number;
  /** Leader progress / path length, 0..1. */
  leaderFrac: number;
  /** Marbles still racing. */
  racing: number;
  /** Marbles already finished. */
  finished: number;
  podiumSize: number;
  over: boolean;
}

/** 0 = anticipation, 1 = early race, 2 = mid race, 3 = final stretch. */
export function intensityFor(i: IntensityInput): Level {
  if (i.over || i.raceTime < 0) return 0;
  const podiumFull = i.finished >= i.podiumSize;
  if (i.leaderFrac >= FINAL_PROGRESS) return 3;
  if (!podiumFull && i.racing <= 3 && i.raceTime >= 8) return 3;
  if (i.leaderFrac >= 0.35 || i.raceTime >= 30) return 2;
  return 1;
}

/* --------------------------------------------------------- variation */

export function hash32(a: number, b = 0, c = 0): number {
  let h = (a | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (b | 0), 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h ^ (c | 0), 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export interface SectionVariant {
  bass: number; // 0..2
  arp: number; // 0..2
}

export function sectionVariant(seed: number, section: number): SectionVariant {
  const h = hash32(seed, section, 77);
  return { bass: h % 3, arp: ((h >>> 7) + section) % 3 };
}

/* ----------------------------------------------------------- patterns */

/** Bass 8th-note slots (steps 0,2,..14): semitone offset above chord root, null = rest. */
const BASS_PATTERNS: readonly (readonly (number | null)[])[] = [
  [0, 0, 12, 0, 0, 0, 12, 0],
  [0, 12, 0, 12, 0, 0, 12, 7],
  [0, 0, 12, 0, 0, 7, 12, 0],
];

/** Arp patterns: indices into [root, third, fifth, octave]; -1 = rest. */
const ARP_PATTERNS: readonly (readonly number[])[] = [
  [0, 1, 2, 3, 2, 1, 2, 1, 0, 1, 2, 3, 2, 3, 2, 1],
  [0, 2, 1, 2, 3, 2, 1, 2, 0, 2, 1, 2, 3, 2, 3, 2],
  [0, -1, 2, 1, -1, 3, 2, -1, 0, 1, -1, 2, 3, -1, 2, 1],
];

export function arpPool(chord: Chord): number[] {
  const base = atOrAbove(chord.rootPc, 55);
  return [base, base + chord.third, base + 7, base + 12];
}

export function padVoicing(chord: Chord): number[] {
  const base = atOrAbove(chord.rootPc, 50);
  return [base, base + chord.third, base + 7];
}

/* --------------------------------------------------------- generation */

export interface StepContext {
  bar: number;
  step: number;
  level: Level;
  seed: number;
  /** 0..1 while the start countdown plays; undefined otherwise. */
  countdown?: number;
}

/** True on the last bar of an 8-bar section (kick drops, snare fill). */
export const isTransitionBar = (bar: number): boolean => bar % SECTION_BARS === SECTION_BARS - 1;

export function generateStep(ctx: StepContext): NoteEvent[] {
  const { bar, step, level, seed } = ctx;
  const out: NoteEvent[] = [];
  const chord = chordForBar(bar);
  const section = Math.floor(bar / SECTION_BARS);
  const variant = sectionVariant(seed, section);
  const cd = ctx.countdown;
  const inCountdown = cd !== undefined;

  // Pad: holds each chord for the whole bar.
  if (step === 0) out.push({ voice: 'pad', midis: padVoicing(chord), vel: 1, steps: STEPS_PER_BAR });

  // Bass.
  if (level === 0) {
    if (!inCountdown || (cd as number) > 0.25) {
      if (step === 0) out.push({ voice: 'bass', midi: chord.bassRoot, vel: 0.65, steps: 3 });
      if (step === 8) out.push({ voice: 'bass', midi: chord.bassRoot, vel: 0.5, steps: 2.5 });
    }
  } else if (step % 2 === 0) {
    const off = BASS_PATTERNS[variant.bass][step / 2];
    if (off !== null) out.push({ voice: 'bass', midi: chord.bassRoot + off, vel: step === 0 ? 1 : off === 12 ? 0.8 : 0.9, steps: 1.7 });
  }

  // Tick: the anxious clock.
  let tickOn: boolean;
  if (inCountdown) {
    const p = cd as number;
    tickOn = p < 0.34 ? step % 4 === 0 : p < 0.67 ? step % 2 === 0 : true;
  } else {
    tickOn = level === 0 ? step % 2 === 0 : true;
  }
  if (tickOn) {
    const offbeat = step % 4 === 2;
    const quarter = step % 4 === 0;
    out.push({ voice: 'tick', vel: offbeat ? 1 : quarter ? 0.6 : 0.38, steps: 0.5, accent: offbeat || (inCountdown && quarter) });
  }

  // Kick on quarters (not in the calm layer; dropped on the transition bar).
  const kickOn = inCountdown ? (cd as number) >= 0.5 : level >= 1 && !isTransitionBar(bar);
  if (kickOn && step % 4 === 0) out.push({ voice: 'kick', vel: step === 0 ? 1 : 0.8, steps: 2 });

  // Clap on 2 and 4 (higher intensity) + fill on the transition bar.
  if (!inCountdown && level >= 2) {
    if (step === 4 || step === 12) out.push({ voice: 'clap', vel: 0.8, steps: 2 });
    if (isTransitionBar(bar) && (step === 8 || step === 10 || step >= 13)) {
      out.push({ voice: 'clap', vel: 0.35 + (step - 8) * 0.07, steps: 1 });
    }
  }

  // Arpeggio.
  if (!inCountdown && level >= 1 && (level >= 2 || step % 2 === 0)) {
    const idx = ARP_PATTERNS[variant.arp][step];
    if (idx >= 0) {
      const pool = arpPool(chord);
      const shift = level >= 3 ? 12 : 0;
      const quiet = level === 1 ? 0.7 : 1;
      out.push({ voice: 'arp', midi: pool[idx] + shift, vel: (step % 4 === 0 ? 1 : 0.72) * quiet, steps: 1.6, bright: level >= 3 });
    }
  }

  // Final-stretch swell: rises over the 4th bar of every 4.
  if (!inCountdown && level >= 3 && bar % 4 === 3 && step === 0) out.push({ voice: 'swell', vel: 1, steps: STEPS_PER_BAR });

  return out;
}

/** Bright rising sting (4 notes on consecutive 16ths) in the current chord. */
export function stingEvents(chord: Chord): NoteEvent[] {
  const pool = arpPool(chord).map((m) => m + 12);
  return pool.map((m, i) => ({ voice: 'sting' as const, midi: m, vel: 0.8 + i * 0.07, steps: i === 3 ? 7 : 1.8, off: i }));
}

/** MIDI notes for the countdown blips: 3, 2, 1 (A4) and 0 = go (D5 + A5). */
export function countdownBlipMidis(n: number): number[] {
  return n > 0 ? [69] : [74, 81];
}

/* ------------------------------------------------------------- outro */

export const OUTRO_BARS = 4;

const OUTRO_BAR0 = [62, 66, 69, 74, 78, 81, 86, 81];
const OUTRO_BAR1 = [78, 74, 69, 66];

/** Resolving D major (picardy third), gentle arpeggio, then a calm pad. */
export function outroStep(bar: number, step: number): NoteEvent[] {
  const out: NoteEvent[] = [];
  if (bar === 0 && step === 0) {
    out.push({ voice: 'outroPad', midis: [50, 57, 62, 66], vel: 1, steps: STEPS_PER_BAR * 2 });
    out.push({ voice: 'bass', midi: 38 + 12, vel: 0.7, steps: 8 });
  }
  if (bar === 0 && step % 2 === 0) out.push({ voice: 'bell', midi: OUTRO_BAR0[step / 2], vel: 0.7 + (step === 0 ? 0.3 : 0), steps: 8 });
  if (bar === 1 && step % 4 === 0) out.push({ voice: 'bell', midi: OUTRO_BAR1[step / 4], vel: 0.55 - step * 0.01, steps: 10 });
  if (bar === 2 && step === 0) {
    // calm Dmaj9-ish pad (D E F# A), then it fades to silence
    out.push({ voice: 'outroPad', midis: [50, 57, 64, 66], vel: 0.75, steps: STEPS_PER_BAR * 2 });
    out.push({ voice: 'bell', midi: 74, vel: 0.35, steps: 12 });
  }
  return out;
}
