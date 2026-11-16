/**
 * Stunners (stun walls/nubs, Tesla coils, stun mechanisms) switch on and off: 1 s on, 2 s off.
 * Each one has its own phase (from its id) so they don't all blink together. Pure function of
 * (id, sim time): the simulation and the renderer agree without sharing state.
 */
import { hashSeed } from './rng';

export const STUN_ON_SECONDS = 1;
export const STUN_OFF_SECONDS = 2;

export function stunnerOn(id: string, time: number): boolean {
  const period = STUN_ON_SECONDS + STUN_OFF_SECONDS;
  const phase = (hashSeed(`stun:${id}`) / 4294967296) * period;
  return (((time + phase) % period) + period) % period < STUN_ON_SECONDS;
}
