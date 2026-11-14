/**
 * MusicDirector: reads simulation state each frame (READ ONLY) and drives the
 * MusicEngine: countdown cues, intensity level, first-finish sting, race end.
 */
import type { SimEvent, Simulation } from '../sim/api';
import { intensityFor } from './composer';
import type { MusicEngine } from './music';

export class MusicDirector {
  private cuesFired = 0;
  private went = false;
  private ended = false;
  private frame = 0;

  constructor(
    private music: MusicEngine,
    private pathLength: number,
  ) {}

  update(sim: Simulation, events: readonly SimEvent[]): void {
    const cd = sim.config.race.countdown;
    const t = sim.time;
    const music = this.music;

    if (!this.went) {
      music.setCountdownProgress(cd > 0 ? t / cd : 1);
      // blips for "3", "2", "1" at t = 0, 1, 2 ... (matches the on-screen digits)
      const total = Math.ceil(cd);
      while (this.cuesFired < total && t >= this.cuesFired - 1e-9 + (cd - total)) {
        music.cue(total - this.cuesFired);
        this.cuesFired++;
      }
      if (t + 1e-9 >= cd) {
        this.went = true;
        music.cue(0);
      }
      return;
    }

    for (const e of events) {
      if (e.type === 'finish' && e.rank === 1) music.firstFinish();
    }

    if (sim.isOver()) {
      if (!this.ended) {
        this.ended = true;
        music.raceOver();
      }
      return;
    }

    if (this.frame++ % 6 !== 0) return;
    let lead = 0;
    let racing = 0;
    let finished = 0;
    for (const m of sim.getMarbles()) {
      if (m.status === 'finished') {
        finished++;
        lead = this.pathLength;
      } else if (m.status === 'racing') {
        racing++;
        if (m.progress > lead) lead = m.progress;
      } else if (m.status === 'waiting') racing++;
    }
    const frac = this.pathLength > 0 ? Math.min(1, lead / this.pathLength) : 0;
    const level = intensityFor({
      raceTime: t - cd,
      leaderFrac: frac,
      racing,
      finished,
      podiumSize: sim.config.race.podiumSize,
      over: false,
    });
    music.setRaceState(level, frac);
  }
}
