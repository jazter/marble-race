/**
 * Web Audio instruments + master bus. Works on any BaseAudioContext
 * (AudioContext in the game, OfflineAudioContext in the offline check).
 * All timbres are deliberately soft: no harsh noise, low-passed everywhere.
 */
import { midiToFreq } from './composer';

/** Overall level calibration: volume 60 (default) maps to this linear gain. */
export const MASTER_AT_DEFAULT = 1.25;
export const DEFAULT_VOLUME = 60;

export function volumeToGain(volume: number): number {
  const v = Math.min(100, Math.max(0, volume)) / DEFAULT_VOLUME;
  return v <= 0 ? 0 : MASTER_AT_DEFAULT * Math.pow(v, 1.25);
}

/** One musical section: its own bus (so it can be faded out / killed) + ping-pong delay for the arp. */
export interface Segment {
  bus: GainNode;
  arpIn: GainNode;
  nodes: AudioNode[];
  delayL: DelayNode;
  delayR: DelayNode;
}

export interface PadOptions {
  attack?: number;
  cutoff0?: number;
  cutoff1?: number;
  release?: number;
}

export class Synth {
  readonly master: GainNode;
  private readonly mix: GainNode;
  private readonly noise: AudioBuffer;
  private noiseCounter = 0;

  constructor(
    readonly ctx: BaseAudioContext,
    volume = DEFAULT_VOLUME,
  ) {
    this.mix = ctx.createGain();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 7500;
    lp.Q.value = 0.5;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.knee.value = 12;
    comp.ratio.value = 2.5;
    comp.attack.value = 0.008;
    comp.release.value = 0.2;
    this.master = ctx.createGain();
    this.master.gain.value = volumeToGain(volume);
    // Gentle soft clipper as a safety net: peaks can never exceed ~0.72.
    const shaper = ctx.createWaveShaper();
    const n = 2049;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i / (n - 1)) * 2 - 1;
      curve[i] = 0.9 * Math.tanh(x / 0.9);
    }
    shaper.curve = curve;
    this.mix.connect(lp).connect(comp).connect(this.master).connect(shaper).connect(ctx.destination);

    // 2 s of white noise (looped for swells).
    const len = Math.floor(ctx.sampleRate * 2);
    this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    let s = 12345;
    for (let i = 0; i < len; i++) {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      d[i] = (s / 4294967296) * 2 - 1;
    }
  }

  /** Smoothly move the master gain (used for volume, mute, pause). */
  setMaster(gain: number, at = this.ctx.currentTime, tau = 0.05): void {
    const p = this.master.gain;
    p.cancelScheduledValues(at);
    p.setTargetAtTime(gain, at, tau);
  }

  /* ----------------------------------------------------------- segments */

  newSegment(delayTime = 0.34): Segment {
    const ctx = this.ctx;
    const bus = ctx.createGain();
    bus.connect(this.mix);
    const arpIn = ctx.createGain();
    arpIn.gain.value = 0.42;
    const delayL = ctx.createDelay(2);
    const delayR = ctx.createDelay(2);
    delayL.delayTime.value = delayR.delayTime.value = delayTime;
    const fbL = ctx.createGain();
    const fbR = ctx.createGain();
    fbL.gain.value = fbR.gain.value = 0.36;
    const panL = ctx.createStereoPanner();
    const panR = ctx.createStereoPanner();
    panL.pan.value = -0.65;
    panR.pan.value = 0.65;
    arpIn.connect(delayL);
    delayL.connect(panL).connect(bus);
    delayL.connect(fbL).connect(delayR);
    delayR.connect(panR).connect(bus);
    delayR.connect(fbR).connect(delayL);
    return { bus, arpIn, delayL, delayR, nodes: [bus, arpIn, delayL, delayR, fbL, fbR, panL, panR] };
  }

  setSegmentDelay(seg: Segment, seconds: number, at: number): void {
    seg.delayL.delayTime.setTargetAtTime(seconds, at, 0.05);
    seg.delayR.delayTime.setTargetAtTime(seconds, at, 0.05);
  }

  /** Fade a segment out starting at `at`, then free its nodes. */
  disposeSegment(seg: Segment, at: number, fade: number): void {
    seg.bus.gain.cancelScheduledValues(at);
    seg.bus.gain.setTargetAtTime(0, at, Math.max(0.01, fade / 4));
    const offline = typeof OfflineAudioContext !== 'undefined' && this.ctx instanceof OfflineAudioContext;
    if (typeof setTimeout === 'function' && !offline) {
      const wait = Math.max(0, at - this.ctx.currentTime) + fade * 1.5 + 1.5;
      setTimeout(() => {
        for (const n of seg.nodes) {
          try {
            n.disconnect();
          } catch {
            /* already gone */
          }
        }
      }, wait * 1000);
    }
  }

  /* ------------------------------------------------------------ helpers */

  private noiseSource(loop = false): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = loop;
    return src;
  }

  private noiseOffset(): number {
    this.noiseCounter = (this.noiseCounter + 1) % 37;
    return this.noiseCounter * 0.05;
  }

  /* -------------------------------------------------------- instruments */

  bass(seg: Segment, t: number, midi: number, dur: number, vel: number): void {
    const ctx = this.ctx;
    const f = midiToFreq(midi);
    const saw = ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.value = f;
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.value = f / 2;
    const subG = ctx.createGain();
    subG.gain.value = 0.55;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 1.6;
    lp.frequency.setValueAtTime(950, t);
    lp.frequency.setTargetAtTime(380, t + 0.01, 0.06);
    const g = ctx.createGain();
    const peak = 0.15 * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.008);
    g.gain.setTargetAtTime(peak * 0.6, t + 0.008, 0.09);
    g.gain.setTargetAtTime(0, t + dur, 0.03);
    saw.connect(lp);
    sub.connect(subG).connect(lp);
    lp.connect(g).connect(seg.bus);
    const end = t + dur + 0.3;
    saw.start(t);
    sub.start(t);
    saw.stop(end);
    sub.stop(end);
  }

  kick(seg: Segment, t: number, vel: number): void {
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(125, t);
    o.frequency.setTargetAtTime(46, t, 0.03);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.34 * vel, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.004, 0.065);
    o.connect(g).connect(seg.bus);
    o.start(t);
    o.stop(t + 0.5);
  }

  tick(seg: Segment, t: number, vel: number, accent: boolean): void {
    const ctx = this.ctx;
    const n = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = accent ? 4600 : 3300;
    bp.Q.value = 3;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1 * vel, t + 0.001);
    g.gain.setTargetAtTime(0, t + 0.001, 0.009);
    n.connect(bp).connect(g).connect(seg.bus);
    n.start(t, this.noiseOffset());
    n.stop(t + 0.09);
    if (accent) {
      // woodblock-like "tock"
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 1760;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0, t);
      og.gain.linearRampToValueAtTime(0.035 * vel, t + 0.001);
      og.gain.setTargetAtTime(0, t + 0.001, 0.012);
      o.connect(og).connect(seg.bus);
      o.start(t);
      o.stop(t + 0.1);
    }
  }

  clap(seg: Segment, t: number, vel: number): void {
    const ctx = this.ctx;
    const n = this.noiseSource();
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    const peak = 0.11 * vel;
    g.gain.setValueAtTime(0, t);
    for (let i = 0; i < 3; i++) {
      g.gain.linearRampToValueAtTime(peak * (i === 2 ? 1 : 0.7), t + i * 0.011 + 0.002);
      if (i < 2) g.gain.linearRampToValueAtTime(peak * 0.2, t + i * 0.011 + 0.009);
    }
    g.gain.setTargetAtTime(0, t + 0.026, 0.05);
    n.connect(bp).connect(g).connect(seg.bus);
    n.start(t, this.noiseOffset());
    n.stop(t + 0.4);
  }

  arp(seg: Segment, t: number, midi: number, dur: number, vel: number, bright: boolean): void {
    const ctx = this.ctx;
    const f = midiToFreq(midi);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = f;
    const g = ctx.createGain();
    const peak = 0.09 * vel;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.004, Math.max(0.03, dur * 0.4));
    o.connect(g);
    const end = t + dur + 0.4;
    o.start(t);
    o.stop(end);
    if (bright) {
      const sq = ctx.createOscillator();
      sq.type = 'square';
      sq.frequency.value = f;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 1900;
      const sg = ctx.createGain();
      sg.gain.setValueAtTime(0, t);
      sg.gain.linearRampToValueAtTime(peak * 0.28, t + 0.004);
      sg.gain.setTargetAtTime(0, t + 0.004, Math.max(0.025, dur * 0.3));
      sq.connect(lp).connect(sg).connect(g);
      sq.start(t);
      sq.stop(end);
    }
    g.connect(seg.bus);
    g.connect(seg.arpIn);
  }

  pad(seg: Segment, t: number, midis: number[], dur: number, vel: number, opts: PadOptions = {}): void {
    const ctx = this.ctx;
    const attack = opts.attack ?? 0.7;
    const release = opts.release ?? 0.35;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.Q.value = 0.5;
    lp.frequency.setValueAtTime(opts.cutoff0 ?? 750, t);
    lp.frequency.linearRampToValueAtTime(opts.cutoff1 ?? 1300, t + dur * 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.4 * vel, t + attack);
    g.gain.setTargetAtTime(0, t + dur, release);
    lp.connect(g).connect(seg.bus);
    const end = t + dur + release * 8;
    for (const m of midis) {
      for (const cents of [-7, 7]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiToFreq(m);
        o.detune.value = cents;
        const og = ctx.createGain();
        og.gain.value = 0.05;
        o.connect(og).connect(lp);
        o.start(t);
        o.stop(end);
      }
    }
  }

  outroPad(seg: Segment, t: number, midis: number[], dur: number, vel: number): void {
    this.pad(seg, t, midis, dur, vel, { attack: 1.2, cutoff0: 650, cutoff1: 1000, release: 0.9 });
  }

  swell(seg: Segment, t: number, dur: number, vel: number): void {
    const ctx = this.ctx;
    const n = this.noiseSource(true);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.3;
    bp.frequency.setValueAtTime(350, t);
    bp.frequency.exponentialRampToValueAtTime(3600, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.085 * vel, t + dur);
    g.gain.setTargetAtTime(0, t + dur, 0.04);
    n.connect(bp).connect(g).connect(seg.bus);
    n.start(t, this.noiseOffset());
    n.stop(t + dur + 0.4);
  }

  blip(seg: Segment, t: number, midi: number, dur: number, vel: number): void {
    const ctx = this.ctx;
    const f = midiToFreq(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16 * vel, t + 0.005);
    g.gain.setTargetAtTime(0, t + 0.005, dur / 4);
    g.connect(seg.bus);
    for (const [type, mult, level] of [
      ['sine', 1, 1],
      ['triangle', 2, 0.25],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mult;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dur * 2.5);
    }
  }

  sting(seg: Segment, t: number, midi: number, dur: number, vel: number): void {
    const ctx = this.ctx;
    const f = midiToFreq(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.1 * vel, t + 0.004);
    g.gain.setTargetAtTime(0, t + 0.004, Math.max(0.05, dur / 3.5));
    for (const [type, mult, level] of [
      ['triangle', 1, 1],
      ['sine', 2, 0.35],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f * mult;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dur + 0.8);
    }
    g.connect(seg.bus);
    g.connect(seg.arpIn);
  }

  bell(seg: Segment, t: number, midi: number, dur: number, vel: number): void {
    const ctx = this.ctx;
    const f = midiToFreq(midi);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.09 * vel, t + 0.006);
    g.gain.setTargetAtTime(0, t + 0.006, Math.max(0.08, dur / 4));
    for (const [mult, level] of [
      [1, 1],
      [2, 0.22],
    ] as const) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * mult;
      const og = ctx.createGain();
      og.gain.value = level;
      o.connect(og).connect(g);
      o.start(t);
      o.stop(t + dur + 1.5);
    }
    g.connect(seg.bus);
    g.connect(seg.arpIn);
  }
}
