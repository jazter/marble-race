// STUB — replaced by the render/UI agent. Contract: deterministic for (config, seed).
import type { GameConfig } from './config';
import type { MarbleProfile } from './types';
import { sampleRoster } from './fixtures';

export function createRoster(config: GameConfig, _seed: number): MarbleProfile[] {
  return sampleRoster(config.marbles.count);
}
