/** Deterministic simulation camera (world units). Never depends on the renderer. */
import { SIM_DT, VIEW_ASPECT, type GameConfig } from '../core/config';
import { pointAtLength } from '../core/math';
import type { MapDef, Vec } from '../core/types';
import type { CameraState, MarbleState } from './api';
import type { PathProgress } from './progress';

export class SimCamera {
  readonly state: CameraState;
  private target: Vec;
  private scrollS = 0;
  private scrollStarted = false;
  private readonly k = 1 - Math.exp(-4 * SIM_DT);

  constructor(
    private readonly map: MapDef,
    private readonly config: GameConfig,
    private readonly prog: PathProgress,
  ) {
    const sp = map.start.spawnPoints;
    let cx = 0;
    let cy = 0;
    for (const p of sp) {
      cx += p.x;
      cy += p.y;
    }
    if (sp.length) {
      cx /= sp.length;
      cy /= sp.length;
    } else if (map.path.length) {
      cx = map.path[0].x;
      cy = map.path[0].y;
    }
    this.target = { x: cx, y: cy };
    const width = config.camera.viewWidth;
    this.state = { x: cx, y: cy, width, height: width * VIEW_ASPECT };
  }

  /** @param started true once the start gate has opened */
  update(marbles: readonly MarbleState[], started: boolean): void {
    if (started) {
      const mode = this.config.camera.mode;
      if (mode === 'scroll') {
        // Chasing camera: advances at least at scrollSpeed, starting where the
        // pack is, and never lets the leader escape past the lower part of the
        // view (stragglers left above the view are the ones that get eliminated).
        let leaderProgress = -Infinity;
        for (const m of marbles) if (m.status === 'racing' && m.progress > leaderProgress) leaderProgress = m.progress;
        if (!this.scrollStarted) {
          this.scrollStarted = true;
          this.scrollS = this.prog.project({ x: this.state.x, y: this.state.y }, -1, []);
        }
        this.scrollS += this.config.camera.scrollSpeed * SIM_DT;
        if (leaderProgress > -Infinity) this.scrollS = Math.max(this.scrollS, leaderProgress - this.state.height * 0.25);
        this.target = pointAtLength(this.map.path, this.prog.cum, this.scrollS);
      } else {
        // racing marbles sorted by progress (desc), ties by id (stable)
        let leader: MarbleState | null = null;
        let count = 0;
        for (const m of marbles) {
          if (m.status !== 'racing') continue;
          count++;
          if (!leader || m.progress > leader.progress) leader = m;
        }
        if (leader) {
          if (mode === 'leader') this.target = { x: leader.x, y: leader.y };
          else if (mode === 'path') this.target = pointAtLength(this.map.path, this.prog.cum, leader.progress);
          else {
            const racing = marbles.filter((m) => m.status === 'racing');
            racing.sort((a, b) => a.progress - b.progress || a.id - b.id);
            const m = racing[Math.floor(count / 2)];
            this.target = { x: m.x, y: m.y };
          }
        }
      }
    }
    this.state.x += (this.target.x - this.state.x) * this.k;
    this.state.y += (this.target.y - this.state.y) * this.k;
  }
}
