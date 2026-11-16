/** Course progress: arc length of the closest point on map.path. */
import { cumulativeLengths } from '../core/math';
import type { Vec } from '../core/types';

export class PathProgress {
  readonly cum: number[];
  readonly total: number;
  private readonly segCount: number;

  constructor(readonly path: Vec[]) {
    this.cum = cumulativeLengths(path);
    this.total = this.cum[this.cum.length - 1] ?? 0;
    this.segCount = Math.max(0, path.length - 1);
  }

  /**
   * Project `p` onto the path. `hint` = segment index found last time (or -1):
   * a local window around it is searched first, falling back to a global search
   * when the local result is far away (keeps cost low and results stable).
   * Returns arc length; `outSeg[0]` receives the segment index.
   */
  project(p: Vec, hint: number, outSeg: number[]): number {
    if (this.segCount === 0) {
      outSeg[0] = 0;
      return 0;
    }
    let best = Infinity;
    let bestS = 0;
    let bestI = 0;
    const path = this.path;
    const cum = this.cum;
    const px = p.x;
    const py = p.y;
    const scan = (from: number, to: number) => {
      for (let i = from; i < to; i++) {
        const a = path[i];
        const b = path[i + 1];
        const abx = b.x - a.x;
        const aby = b.y - a.y;
        const l2 = abx * abx + aby * aby;
        let t = 0;
        if (l2 > 0) {
          t = ((px - a.x) * abx + (py - a.y) * aby) / l2;
          t = t < 0 ? 0 : t > 1 ? 1 : t;
        }
        const dx = px - (a.x + abx * t);
        const dy = py - (a.y + aby * t);
        const d = dx * dx + dy * dy;
        if (d < best) {
          best = d;
          bestI = i;
          bestS = cum[i] + t * (cum[i + 1] - cum[i]);
        }
      }
    };
    if (hint >= 0) {
      scan(Math.max(0, hint - 12), Math.min(this.segCount, hint + 13));
      if (best > 36) {
        best = Infinity;
        scan(0, this.segCount);
      }
    } else {
      scan(0, this.segCount);
    }
    outSeg[0] = bestI;
    return bestS;
  }
}
