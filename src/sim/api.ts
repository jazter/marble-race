/**
 * Simulation public API — SHARED CONTRACT between sim (implements it),
 * validator, renderer and UI (consume it). Do not rename/remove members;
 * adding optional members is allowed.
 *
 * The simulation is fully deterministic: same (map, roster, config) and the
 * same number of step() calls => identical results. It must not depend on
 * wall-clock time, rendering, window size or Math.random().
 */
import type { EffectType, GameConfig, WallReaction } from '../core/config';
import type { MapDef, MarbleProfile, Vec } from '../core/types';

export type MarbleStatus = 'waiting' | 'racing' | 'finished' | 'eliminated';

export type EliminationReason =
  | 'wall' // touched a 'kill' wall
  | 'destroy' // destroy effect (saw, mechanism, zone)
  | 'offscreen' // outside the camera too long (config.camera.offscreenKill)
  | 'outOfBounds'; // left map.bounds

export interface MarbleState {
  id: number;
  profile: MarbleProfile;
  x: number;
  y: number;
  angle: number; // body rotation (radians) — renderer rotates the skin with it
  radius: number; // current radius (changes with grow/shrink)
  vx: number;
  vy: number;
  status: MarbleStatus;
  /** Arc length along map.path of the marble's projection (for ranking + camera). */
  progress: number;
  /** Seconds since the start gate opened when it crossed the finish line. */
  finishTime?: number;
  /** 1-based finishing position. */
  rank?: number;
  eliminatedReason?: EliminationReason;
  eliminatedAt?: number;
  /** Seconds this marble has been outside the camera view (0 when inside). */
  offscreenTime: number;
}

export interface LinkPose {
  x: number; // world position of the link's pivot
  y: number;
  angle: number; // world angle of the link (radians)
}

export interface MechanismPose {
  id: string;
  links: LinkPose[];
  /** World centre of the attract/repel field, if any. */
  field?: Vec;
}

export interface SwitchState {
  id: string;
  active: boolean;
  /** Seconds left for a timed switch (0 if inactive or 'once'). */
  remaining: number;
  /** Times it has been triggered. */
  hits: number;
}

export interface CameraState {
  /** Centre of the view in world coordinates. */
  x: number;
  y: number;
  /** View size in world metres (width = config.camera.viewWidth, height = width * VIEW_ASPECT). */
  width: number;
  height: number;
}

export interface PhysicsState {
  gravity: Vec; // current gravity vector (m/s^2)
  wind: Vec; // current wind acceleration (m/s^2)
  mechanismSpeed: number; // current global multiplier (includes config.objects.speed)
  marbleRestitution: number;
  /** Labels of currently active switch effects (Spanish, from Switch.label). */
  activeLabels: string[];
}

export type SimEvent =
  | { t: number; type: 'gateOpen'; gateId: string }
  | { t: number; type: 'finish'; marbleId: number; rank: number; time: number }
  | { t: number; type: 'eliminated'; marbleId: number; reason: EliminationReason; x: number; y: number }
  | {
      t: number;
      type: 'effect';
      marbleId: number;
      effect: EffectType | WallReaction;
      x: number;
      y: number;
    }
  | { t: number; type: 'switch'; switchId: string; active: boolean }
  | { t: number; type: 'raceEnd'; reason: RaceEndReason };

export type RaceEndReason = 'podium' | 'allDone' | 'timeout' | 'noMarbles';

export interface RaceResult {
  over: boolean;
  reason?: RaceEndReason;
  /** Finished marbles in finishing order. */
  finishers: { marbleId: number; name: string; time: number; rank: number }[];
  eliminated: number;
  /** Seconds since the start gate opened (negative during countdown). */
  raceTime: number;
}

export interface Simulation {
  readonly map: MapDef;
  readonly config: GameConfig;
  /** Total simulated seconds since creation (includes the countdown). */
  readonly time: number;
  readonly stepCount: number;

  /** Advance exactly one fixed step of SIM_DT. No-op once the race is over. */
  step(): void;
  /** Convenience: call step() n times. */
  stepMany(n: number): void;

  getMarbles(): readonly MarbleState[];
  getMechanismPoses(): readonly MechanismPose[];
  /** Ids of gates that are currently open (removed). */
  getOpenGates(): readonly string[];
  getSwitchStates(): readonly SwitchState[];
  getCamera(): CameraState;
  getPhysicsState(): PhysicsState;

  /** Returns and clears events emitted since the last call. */
  drainEvents(): SimEvent[];

  isOver(): boolean;
  getResult(): RaceResult;

  /** Release physics resources. */
  destroy(): void;
}

/** Factory signature implemented in sim/simulation.ts and re-exported from sim/index.ts. */
export type CreateSimulation = (map: MapDef, roster: MarbleProfile[], config: GameConfig) => Simulation;
