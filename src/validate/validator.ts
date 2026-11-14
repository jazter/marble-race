/** Headless race validation (time-sliced so the browser UI stays responsive). */
import { SIM_DT, type GameConfig } from '../core/config';
import type { MapDef, MarbleProfile } from '../core/types';
import { generateMap } from '../gen';
import { createRoster } from '../core/roster';
import { createSimulation } from '../sim';
import type { Simulation } from '../sim';

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
  /** Marble looks to include first (e.g. ones spectators named). Cosmetic only: never changes the physics. */
  preferredKeys?: readonly string[];
}

export interface ValidationResult {
  ok: boolean;
  reason: string;
  firstFinishTime: number;
  finishers: number;
  simSeconds: number;
}

/**
 * Finishers a map must produce to be accepted: `race.minFinishers`, but never
 * more than there are marbles, nor (in podium mode, where the race ends shortly
 * after the podium fills) more than the podium size.
 */
export function requiredFinishers(config: GameConfig): number {
  let n = Math.min(config.race.minFinishers, config.marbles.count);
  if (config.race.endMode === 'podium') n = Math.min(n, config.race.podiumSize);
  return Math.max(1, Math.floor(n));
}

function judge(sim: Simulation, config: GameConfig): ValidationResult {
  const res = sim.getResult();
  const finishers = res.finishers.length;
  const base = { finishers, firstFinishTime: res.finishers[0]?.time ?? -1, simSeconds: sim.time };
  const need = requiredFinishers(config);
  if (finishers >= need) return { ok: true, reason: 'ok', ...base };
  let reason: string;
  if (res.reason === 'noMarbles') reason = 'Todas las canicas fueron eliminadas';
  else if (finishers === 0) reason = 'Ninguna canica llegó a la meta (tiempo agotado)';
  else reason = `Sólo ${finishers} canica(s) llegaron a la meta (mínimo ${need})`;
  return { ok: false, reason, ...base };
}

/** Synchronous headless validation. `maxSteps` guards against runaway sims. */
export function runValidation(
  map: MapDef,
  roster: MarbleProfile[],
  config: GameConfig,
  opts: { maxSteps?: number } = {},
): ValidationResult {
  const sim = createSimulation(map, roster, config);
  try {
    const maxSteps = opts.maxSteps ?? Math.ceil(((config.race.countdown + config.race.timeLimit) / SIM_DT) * 1.05) + 10;
    let n = 0;
    while (sim.getResult().finishers.length < requiredFinishers(config) && !sim.isOver() && n < maxSteps) {
      sim.step();
      n++;
    }
    return judge(sim, config);
  } finally {
    sim.destroy();
  }
}

function abortError(): Error {
  const e = new Error('Generación cancelada');
  e.name = 'AbortError';
  return e;
}

const yieldToHost = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

export async function generateValidatedRace(config: GameConfig, opts: ValidateOptions = {}): Promise<ValidatedRace> {
  const { onProgress, signal } = opts;
  const sliceMs = opts.sliceMs ?? 12;
  const maxAttempts = Math.max(1, config.map.maxAttempts);
  const rejected: { seed: number; reason: string }[] = [];
  const maxSteps = Math.ceil(((config.race.countdown + config.race.timeLimit) / SIM_DT) * 1.05) + 10;

  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) throw abortError();
    const seed = (config.seed + i) >>> 0;
    const report = (phase: ValidationProgress['phase'], simTime: number, reason?: string) =>
      onProgress?.({ attempt: i + 1, maxAttempts, seed, simTime, phase, reason });

    report('generating', 0);
    await yieldToHost();
    if (signal?.aborted) throw abortError();

    let map: MapDef;
    let roster: MarbleProfile[];
    try {
      map = generateMap(config, seed);
      roster = createRoster(config, seed, opts.preferredKeys ?? []);
    } catch (err) {
      const reason = 'Error al generar el mapa: ' + (err instanceof Error ? err.message : String(err));
      rejected.push({ seed, reason });
      report('rejected', 0, reason);
      continue;
    }

    let sim: Simulation | null = null;
    try {
      sim = createSimulation(map, roster, config);
      let n = 0;
      report('simulating', 0);
      while (sim.getResult().finishers.length < requiredFinishers(config) && !sim.isOver() && n < maxSteps) {
        const t0 = performance.now(); // scheduling only; never affects sim state
        do {
          sim.step();
          n++;
        } while (
          n < maxSteps &&
          !sim.isOver() &&
          sim.getResult().finishers.length < requiredFinishers(config) &&
          performance.now() - t0 < sliceMs
        );
        report('simulating', sim.time);
        await yieldToHost();
        if (signal?.aborted) throw abortError();
      }
      const v = judge(sim, config);
      if (v.ok) {
        report('accepted', v.simSeconds);
        return {
          map,
          roster,
          seed,
          attempts: i + 1,
          firstFinishTime: v.firstFinishTime,
          validationFinishers: v.finishers,
          rejected,
        };
      }
      rejected.push({ seed, reason: v.reason });
      report('rejected', v.simSeconds, v.reason);
    } finally {
      sim?.destroy();
    }
  }
  throw new Error(`No se encontró un mapa válido en ${maxAttempts} intentos`);
}
