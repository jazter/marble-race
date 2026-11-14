/**
 * Dev-only: renders the real synth + sequencer graph into an OfflineAudioContext
 * so levels can be measured (see scripts/audio-offline.html). Not imported by the game.
 */
import type { Level } from './composer';
import { Sequencer, type Scene } from './sequencer';
import { Synth } from './synth';

export interface OfflineOptions {
  scene: Scene;
  level: Level;
  seconds: number;
  volume?: number;
  leaderFrac?: number;
  /** Seconds at which to inject a first-finish sting (race scene). */
  stingAt?: number;
}

export interface OfflineStats {
  peak: number;
  rms: number;
  rmsSteady: number;
  hasNaN: boolean;
  seconds: number;
}

export async function renderOffline(o: OfflineOptions): Promise<OfflineStats> {
  const sr = 44100;
  const ctx = new OfflineAudioContext(2, Math.ceil(sr * o.seconds), sr);
  const synth = new Synth(ctx, o.volume ?? 60);
  const seq = new Sequencer(synth, 7);
  seq.setScene(o.scene, 0.05, 0, o.level);
  seq.leaderFrac = o.leaderFrac ?? 0;
  seq.countdownProgress = 0.85;
  if (o.stingAt !== undefined) {
    seq.advance(o.stingAt);
    seq.stingPending = true;
  }
  seq.advance(o.seconds);
  const buf = await ctx.startRendering();
  let peak = 0;
  let sum = 0;
  let sumSteady = 0;
  let n = 0;
  let nSteady = 0;
  let hasNaN = false;
  const from = Math.floor(sr * Math.min(2, o.seconds / 4));
  for (let c = 0; c < buf.numberOfChannels; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < d.length; i++) {
      const v = d[i];
      if (!Number.isFinite(v)) {
        hasNaN = true;
        continue;
      }
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
      n++;
      if (i >= from) {
        sumSteady += v * v;
        nSteady++;
      }
    }
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, n)), rmsSteady: Math.sqrt(sumSteady / Math.max(1, nSteady)), hasNaN, seconds: o.seconds };
}
