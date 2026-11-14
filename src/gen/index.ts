// STUB — replaced by the generator agent. Contract: deterministic for (config, seed).
import type { GameConfig } from '../core/config';
import type { MapDef } from '../core/types';
import { sampleMap } from '../core/fixtures';

export function generateMap(config: GameConfig, seed: number): MapDef {
  return { ...sampleMap(config.marbles.count, config.marbles.radius), seed };
}
