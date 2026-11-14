import { describe, expect, it } from 'vitest';
import {
  D_HARMONIC_MINOR_PCS,
  D_MAJOR_PCS,
  OUTRO_BARS,
  PROGRESSION,
  SECTION_BARS,
  STEPS_PER_BAR,
  arpPool,
  chordForBar,
  chordPcs,
  countdownBlipMidis,
  generateStep,
  intensityFor,
  isTransitionBar,
  outroStep,
  padVoicing,
  pitchClass,
  sectionVariant,
  stingEvents,
  tempoFor,
  type Level,
  type NoteEvent,
} from '../src/audio/composer';
import { volumeToGain } from '../src/audio/synth';

const LEVELS: Level[] = [0, 1, 2, 3];

function bars(level: Level, seed: number, n: number, countdown?: number): NoteEvent[][][] {
  return Array.from({ length: n }, (_, bar) => Array.from({ length: STEPS_PER_BAR }, (_, step) => generateStep({ bar, step, level, seed, countdown })));
}

describe('composer: harmony', () => {
  it('progression is Dm - Bb - Gm - A, one bar each, looping', () => {
    expect(PROGRESSION.map((c) => c.name)).toEqual(['Dm', 'Bb', 'Gm', 'A']);
    expect([0, 1, 2, 3, 4, 5].map((b) => chordForBar(b).name)).toEqual(['Dm', 'Bb', 'Gm', 'A', 'Dm', 'Bb']);
    expect(chordPcs(PROGRESSION[0]).sort()).toEqual([2, 5, 9]);
    expect(chordPcs(PROGRESSION[3]).sort((a, b) => a - b)).toEqual([1, 4, 9]); // A C# E
  });

  it('every chord belongs to D harmonic minor', () => {
    for (const c of PROGRESSION) for (const pc of chordPcs(c)) expect(D_HARMONIC_MINOR_PCS).toContain(pc);
  });

  it('every scheduled pitch is in the current chord (and so in the scale)', () => {
    for (const seed of [1, 7, 99]) {
      for (const level of LEVELS) {
        bars(level, seed, 40).forEach((steps, bar) => {
          const pcs = chordPcs(chordForBar(bar));
          for (const evs of steps) {
            for (const e of evs) {
              const notes = e.midis ?? (e.midi !== undefined ? [e.midi] : []);
              for (const m of notes) {
                expect(pcs, `${e.voice} ${m} bar ${bar}`).toContain(pitchClass(m));
                expect(D_HARMONIC_MINOR_PCS).toContain(pitchClass(m));
              }
            }
          }
        });
      }
    }
  });

  it('stings, pools and voicings stay in the chord', () => {
    PROGRESSION.forEach((c) => {
      const pcs = chordPcs(c);
      for (const m of [...arpPool(c), ...padVoicing(c), ...stingEvents(c).map((e) => e.midi as number)]) expect(pcs).toContain(pitchClass(m));
      const st = stingEvents(c).map((e) => e.midi as number);
      expect([...st].sort((a, b) => a - b)).toEqual(st); // rising
    });
  });

  it('outro resolves to D major (picardy) and stays in D major', () => {
    const all: NoteEvent[] = [];
    for (let bar = 0; bar < OUTRO_BARS; bar++) for (let s = 0; s < STEPS_PER_BAR; s++) all.push(...outroStep(bar, s));
    const pcs = new Set(all.flatMap((e) => (e.midis ?? (e.midi !== undefined ? [e.midi] : [])).map(pitchClass)));
    for (const pc of pcs) expect(D_MAJOR_PCS).toContain(pc);
    expect(pcs.has(6)).toBe(true); // F#
    expect(pcs.has(5)).toBe(false); // no minor third
    expect(outroStep(0, 0).some((e) => e.voice === 'outroPad')).toBe(true);
  });

  it('countdown blips are in key', () => {
    for (const n of [3, 2, 1, 0]) for (const m of countdownBlipMidis(n)) expect(D_HARMONIC_MINOR_PCS).toContain(pitchClass(m));
  });
});

describe('composer: determinism and variation', () => {
  it('is deterministic', () => {
    for (const level of LEVELS) expect(JSON.stringify(bars(level, 5, 24))).toBe(JSON.stringify(bars(level, 5, 24)));
    expect(sectionVariant(3, 2)).toEqual(sectionVariant(3, 2));
  });

  it('varies between 8-bar sections', () => {
    const a = JSON.stringify(bars(3, 5, 8));
    const sections = new Set<string>();
    for (let s = 0; s < 6; s++) {
      const all = bars(3, 5, SECTION_BARS * 6);
      sections.add(JSON.stringify(all.slice(s * SECTION_BARS, (s + 1) * SECTION_BARS)));
    }
    expect(a.length).toBeGreaterThan(0);
    expect(sections.size).toBeGreaterThan(1);
  });
});

describe('composer: layers by intensity', () => {
  const count = (level: Level, voice: string, n = 16) => bars(level, 1, n).flat(2).filter((e) => e.voice === voice).length;

  it('layers enter with intensity', () => {
    expect(count(0, 'arp')).toBe(0);
    expect(count(0, 'kick')).toBe(0);
    expect(count(0, 'clap')).toBe(0);
    expect(count(0, 'tick')).toBeGreaterThan(0);
    expect(count(0, 'pad')).toBeGreaterThan(0);
    expect(count(0, 'bass')).toBeGreaterThan(0);
    expect(count(1, 'arp')).toBeGreaterThan(0);
    expect(count(1, 'kick')).toBeGreaterThan(0);
    expect(count(1, 'clap')).toBe(0);
    expect(count(2, 'clap')).toBeGreaterThan(0);
    expect(count(2, 'swell')).toBe(0);
    expect(count(3, 'swell')).toBe(4); // every 4 bars
    expect(count(1, 'tick')).toBe(16 * 16);
  });

  it('arp goes up an octave at level 3', () => {
    const top = (level: Level) => Math.max(...bars(level, 1, 4).flat(2).filter((e) => e.voice === 'arp').map((e) => e.midi as number));
    expect(top(3)).toBe(top(2) + 12);
  });

  it('kick on quarters, dropped on the bar before a new section', () => {
    const b = bars(2, 1, 8);
    const kicks = (bar: number) => b[bar].flat().filter((e) => e.voice === 'kick').length;
    expect(kicks(0)).toBe(4);
    expect(isTransitionBar(7)).toBe(true);
    expect(kicks(7)).toBe(0);
    const claps = b[0].flat().filter((e) => e.voice === 'clap');
    expect(claps).toHaveLength(2);
    expect(b[0][4].some((e) => e.voice === 'clap') && b[0][12].some((e) => e.voice === 'clap')).toBe(true);
  });

  it('countdown ticks accelerate', () => {
    const ticks = (p: number) => bars(0, 1, 1, p)[0].flat().filter((e) => e.voice === 'tick').length;
    expect(ticks(0.1)).toBe(4);
    expect(ticks(0.5)).toBe(8);
    expect(ticks(0.9)).toBe(16);
  });
});

describe('intensity mapping', () => {
  const base = { raceTime: 5, leaderFrac: 0.1, racing: 30, finished: 0, podiumSize: 3, over: false };
  it('maps race state to levels', () => {
    expect(intensityFor({ ...base, raceTime: -2 })).toBe(0);
    expect(intensityFor(base)).toBe(1);
    expect(intensityFor({ ...base, leaderFrac: 0.4 })).toBe(2);
    expect(intensityFor({ ...base, raceTime: 40 })).toBe(2);
    expect(intensityFor({ ...base, leaderFrac: 0.75 })).toBe(3);
    expect(intensityFor({ ...base, leaderFrac: 0.74 })).toBe(2);
    expect(intensityFor({ ...base, raceTime: 20, leaderFrac: 0.5, racing: 3 })).toBe(3);
    expect(intensityFor({ ...base, raceTime: 20, leaderFrac: 0.5, racing: 3, finished: 3 })).toBe(2);
    expect(intensityFor({ ...base, leaderFrac: 0.9, over: true })).toBe(0);
  });
});

describe('tempo and volume', () => {
  it('stays within 128-142 BPM and rises in the final stretch', () => {
    for (const level of LEVELS) for (let f = 0; f <= 1.0001; f += 0.05) expect(tempoFor(level, f)).toBeGreaterThanOrEqual(128);
    for (const level of LEVELS) for (let f = 0; f <= 1.0001; f += 0.05) expect(tempoFor(level, f)).toBeLessThanOrEqual(142);
    expect(tempoFor(1, 0.9)).toBe(132);
    expect(tempoFor(3, 0.75)).toBe(132);
    expect(tempoFor(3, 1)).toBe(140);
    expect(tempoFor(3, 0.9)).toBeGreaterThan(tempoFor(3, 0.8));
  });

  it('volume mapping is monotonic and 0 is silent', () => {
    expect(volumeToGain(0)).toBe(0);
    let prev = 0;
    for (let v = 5; v <= 100; v += 5) {
      expect(volumeToGain(v)).toBeGreaterThan(prev);
      prev = volumeToGain(v);
    }
  });
});
