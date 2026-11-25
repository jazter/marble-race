/**
 * Simulation public API — SHARED CONTRACT between sim (implements it),
 * validator, renderer and UI (consume it). Do not rename/remove members;
 * adding optional members is allowed.
 *
 * The simulation is fully deterministic: same (map, roster, config) and the
 * same number of step() calls => identical results. It must not depend on
 * wall-clock time, rendering, window size or Math.random().
 */
import type { EffectType, GameConfig, MonsterKind, WallReaction } from '../core/config';
import type { MapDef, MarbleProfile, Vec } from '../core/types';

export type MarbleStatus = 'waiting' | 'racing' | 'finished' | 'eliminated';

export type EliminationReason =
  | 'wall' // touched a 'kill' wall
  | 'destroy' // destroy effect (saw, mechanism, zone)
  | 'offscreen' // outside the camera too long (config.camera.offscreenKill)
  | 'outOfBounds' // left map.bounds
  | 'monster'; // devoured by a monster

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
  /** Id of the monster currently holding this marble (its x/y follow the monster). */
  heldBy?: string;
  /** Seconds left of being dazed by a 'stun' wall (absent / 0 when not stunned). */
  stunned?: number;
}

export interface LinkPose {
  x: number; // world position of the link's pivot
  y: number;
  angle: number; // world angle of the link (radians)
  /** Flipper links only: true while swinging up (renderer flash / thwack). */
  active?: boolean;
}

export interface MechanismPose {
  id: string;
  links: LinkPose[];
  /** World centre of the attract/repel field, if any. */
  field?: Vec;
}

export type MonsterPhase =
  | 'idle' // waiting (spider hanging, octopus resting)
  | 'hunting' // spider dropping / tentacle reaching / fish or snake crossing
  | 'holding' // has caught something and is holding it
  | 'returning' // spider climbing back, tentacle retracting
  | 'hidden'; // fish / snake between passes

export interface TentacleState {
  /** World position of the tentacle tip. */
  x: number;
  y: number;
  state: 'idle' | 'reach' | 'hold' | 'retract';
  marbleId?: number;
}

export interface MonsterState {
  id: string;
  kind: MonsterKind;
  phase: MonsterPhase;
  /** Seconds spent in the current phase (drives animations). */
  phaseTime: number;
  /** Body (spider/octopus) or head (fish/snake) position. */
  x: number;
  y: number;
  /** Facing / travel direction (radians). */
  angle: number;
  /** 0..1 visibility (fish/snake fade in/out at the course edges). */
  visible: number;
  /** Marble ids currently held. */
  holding: number[];
  /** Octopus only. */
  tentacles?: TentacleState[];
  /** Snake/fish: start of the current pass (render draws the body from here to the head). */
  passFrom?: Vec;
  /** Spider: current thread length. */
  threadLength?: number;
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
  | {
      t: number;
      type: 'monster';
      action: 'grab' | 'release' | 'devour';
      monsterId: string;
      kind: MonsterKind;
      marbleId: number;
      x: number;
      y: number;
    }
  | {
      t: number;
      type: 'portal';
      marbleId: number;
      portalId: string;
      kind: 'shortcut' | 'trap';
      /** Entrance and exit positions. */
      x: number;
      y: number;
      toX: number;
      toY: number;
    }
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
  /** Current state of every monster in map.monsters (same order). */
  getMonsterStates(): readonly MonsterState[];

  /** Returns and clears events emitted since the last call. */
  drainEvents(): SimEvent[];

  isOver(): boolean;
  getResult(): RaceResult;

  /** Release physics resources. */
  destroy(): void;
}

/** Factory signature implemented in sim/simulation.ts and re-exported from sim/index.ts. */
export type CreateSimulation = (map: MapDef, roster: MarbleProfile[], config: GameConfig) => Simulation;
