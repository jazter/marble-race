/**
 * Portals: pairs of entrance + exit discs placed on "drop spots" (the gap columns marbles fall
 * through below ramp ends), once the whole course is built. A shortcut exits further down the
 * course; a trap sends the marble back a little. Uses its own Rng: the course never depends on it.
 */
import type { Portal, Vec, Zone } from '../core/types';
import { Rng } from '../core/rng';
import type { Ctx } from './util';
import type { World } from './monsters';

export const PORTAL_RADIUS = 0.9;
const SALT = 0x504f5254; // "PORT"

export function placePortals(ctx: Ctx, seed: number, world: World, courseEnd: number): Portal[] {
  if (ctx.cfg.objects.portals === false) return [];
  const rng = new Rng((seed ^ SALT) >>> 0);
  const need = PORTAL_RADIUS + Math.max(0.35, ctx.R * 0.6);
  const zones: Zone[] = ctx.zones;
  const free = (p: Vec): boolean =>
    world.clear(p) >= need &&
    zones.every((z) => (z.shape.type === 'circle' ? Math.hypot(p.x - z.shape.center.x, p.y - z.shape.center.y) > z.shape.radius + need : true));
  const spots = ctx.dropSpots
    .filter((p) => p.y > 18 && p.y < courseEnd - 18 && free(p))
    .sort((a, b) => a.y - b.y);
  const taken: Vec[] = [];
  const ok = (p: Vec): boolean => taken.every((q) => Math.hypot(p.x - q.x, p.y - q.y) > 4);
  const out: Portal[] = [];
  const add = (kind: Portal['kind'], minDy: number, maxDy: number, from: number, to: number): void => {
    const entrances = rng.shuffle(spots.filter((p) => p.y >= courseEnd * from && p.y <= courseEnd * to && ok(p)));
    for (const e of entrances) {
      const exits = spots.filter((p) => p.y - e.y >= minDy && p.y - e.y <= maxDy && ok(p) && Math.hypot(p.x - e.x, p.y - e.y) > 6);
      if (!exits.length) continue;
      const x = rng.pick(exits);
      out.push({ id: `portal${out.length + 1}`, entrance: e, exit: x, radius: PORTAL_RADIUS, kind });
      taken.push(e, x);
      return;
    }
  };
  // a shortcut that skips a good stretch, and a trap that sends marbles back a little
  if (rng.bool(0.85)) add('shortcut', 25, 90, 0.08, 0.7);
  if (rng.bool(0.75)) add('trap', -40, -12, 0.25, 0.92);
  return out;
}
