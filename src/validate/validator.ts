// STUB — replaced by the sim agent (time-sliced validation). Signature is the contract.
import type { GameConfig } from '../core/config';
import type { MapDef, MarbleProfile } from '../core/types';
import { generateMap } from '../gen';
import { createRoster } from '../core/roster';

export interface ValidationProgress {
  attempt: number; // 1-based
  maxAttempts: number;
  seed: number;
  simTime: number; // simulated seconds so far in this attempt
  phase: 'generating' | 'simulating' | 'accepted' | 'rejected';
  reason?: string; // Spanish, for rejected attempts
}

export interface ValidatedRace {
  map: MapDef;
  roster: MarbleProfile[];
  seed: number; // accepted seed
  attempts: number;
  firstFinishTime: number; // race seconds of the first finisher in validation
  validationFinishers: number;
  rejected: { seed: number; reason: string }[];
}

export interface ValidateOptions {
  onProgress?: (p: ValidationProgress) => void;
  signal?: AbortSignal;
  sliceMs?: number;
}

export async function generateValidatedRace(config: GameConfig, _opts: ValidateOptions = {}): Promise<ValidatedRace> {
  const seed = config.seed >>> 0;
  return {
    map: generateMap(config, seed),
    roster: createRoster(config, seed),
    seed,
    attempts: 1,
    firstFinishTime: 0,
    validationFinishers: 0,
    rejected: [],
  };
}
