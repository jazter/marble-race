/**
 * GameConfig — everything the player can configure before a race.
 *
 * SHARED CONTRACT: used by generator, simulation, validator, renderer and UI.
 * Do not rename or remove fields. Adding new OPTIONAL fields is allowed.
 *
 * Conventions (see also core/types.ts):
 *  - World units are metres, y axis points DOWN (screen-like).
 *  - "Direction angles" are degrees where 0 = down (+y), 90 = right (+x),
 *    -90 = left (-x), 180 = up (-y). Use `dirFromAngle()` from core/math.ts.
 */

export type WallReaction = 'solid' | 'bounce' | 'slow' | 'kill' | 'launch';
export type SpecialWallReaction = Exclude<WallReaction, 'solid'>;
/**
 * Outer-wall mode: one reaction for every outer wall, or 'mixed' — the generator
 * gives each outer-wall piece its own reaction (mostly solid, with bounce, slow
 * and downstream launch pieces; never kill) stored in Wall.reaction.
 */
export type BoundaryMode = WallReaction | 'mixed';

/** Effects that modifier objects (mechanisms and zones) apply to marbles. */
export type EffectType = 'grow' | 'shrink' | 'destroy' | 'attract' | 'repel';

/** Moving obstacle families. Each has one or more pivot points (links). */
export type MechanismKind =
  | 'propeller' // N blades rotating around 1 pivot
  | 'arm2' // 2-link arm: link 1 rotates around a fixed pivot, link 2 rotates at the tip of link 1
  | 'saw' // spinning toothed disc
  | 'triangle' // spinning triangle
  | 'hammer'; // pendulum-like bar oscillating around 1 pivot

export type SkinType =
  | 'solid'
  | 'bicolor'
  | 'tricolor'
  | 'multicolor'
  | 'silver'
  | 'gold'
  | 'glass'
  | 'striped';

export type CameraMode =
  | 'leader' // follows the marble with the most course progress
  | 'pack' // follows the median-progress racing marble
  | 'path' // stays on the course centre-line at the leader's progress
  | 'scroll'; // moves along the centre-line at a constant speed (chasing camera)

/** Creatures that grab marbles, hold them, then devour (destroy) or release them. */
export type MonsterKind =
  | 'spider' // hangs from a thread and drops onto the marble below it
  | 'octopus' // sits in the course; 8 tentacles, each can hold one marble
  | 'fish' // swims across the course and catches the marble it meets
  | 'snake'; // slithers across the course at any angle and catches a marble

/** Decorative scenery behind the course (visual only, never affects the race). */
export type BackgroundKind = 'auto' | 'sea' | 'space' | 'clouds' | 'dinosaurs' | 'castle';

export type SwitchActionType =
  | 'lowGravity'
  | 'highGravity'
  | 'tiltGravity'
  | 'reverseGravity'
  | 'reverseMechanisms'
  | 'fastMechanisms'
  | 'wind'
  | 'bouncy'
  | 'openGate';

export type RaceEndMode =
  | 'podium' // race ends a few seconds after the podium is filled
  | 'all'; // race ends when every marble finished or was eliminated (or time limit)

export interface GameConfig {
  /** Seed for map generation + roster + any in-sim randomness. */
  seed: number;

  marbles: {
    count: number; // 1..200
    radius: number; // base radius in metres
    skins: Record<SkinType, boolean>; // which skin families may be assigned
    density: number;
    friction: number;
    restitution: number;
    /** Radius limits relative to `radius` for grow/shrink effects. */
    minScale: number;
    maxScale: number;
  };

  physics: {
    gravity: number; // m/s^2
    gravityAngle: number; // direction angle (deg), 0 = down
    windStrength: number; // constant acceleration m/s^2 applied to every marble
    windAngle: number; // direction angle (deg)
    launchStrength: number; // speed (m/s) of the random kick each marble gets when the start gate opens
    linearDamping: number;
  };

  walls: {
    /** Reaction of the course's outer side walls ('mixed' = per-piece reactions chosen by the generator). */
    boundary: BoundaryMode;
    /** Which special reactions interior walls may get. */
    special: Record<SpecialWallReaction, boolean>;
    /** 0..1 fraction of interior walls that receive a special reaction. */
    specialRatio: number;
    bounceRestitution: number; // restitution used by 'bounce' walls (>1 adds energy)
    slowFactor: number; // 0..1 fraction of velocity removed per second while touching 'slow' walls
    launchStrength: number; // speed (m/s) added by 'launch' walls
  };

  objects: {
    kinds: Record<MechanismKind, boolean>;
    effects: Record<EffectType, boolean>;
    density: number; // 0..1 how many mechanisms per segment
    speed: number; // multiplier on mechanism angular speeds
    effectChance: number; // 0..1 chance a mechanism carries an effect (otherwise just solid)
    zones: boolean; // allow static modifier pads (zones)
  };

  monsters: {
    kinds: Record<MonsterKind, boolean>;
    /** Monster GROUPS per map (0..8). Octopuses come alone; spiders, fish and
     *  snakes come in groups (colony / school / nest) of up to `groupSize`. */
    count: number;
    /** Max members of a spider / fish / snake group (1..6). */
    groupSize: number;
    /** 0..1 probability that a monster devours (destroys) a caught marble instead of releasing it. */
    destroyChance: number;
    /** Seconds a monster holds a caught marble before deciding. */
    holdTime: number;
    /** Multiplier on monster movement speeds. */
    speed: number;
  };

  switches: {
    enabled: boolean;
    actions: Record<SwitchActionType, boolean>;
    frequency: number; // 0..1 how often a segment gets a switch
    duration: number; // seconds a timed switch effect lasts
  };

  display: {
    /** Scenery drawn behind the course; 'auto' = the map's own plain theme. Visual only. */
    background: BackgroundKind;
  };

  camera: {
    mode: CameraMode;
    /** Width of the camera view in world metres. Height = width * 9/16. */
    viewWidth: number;
    /** If true, racing marbles outside the camera view for `offscreenGrace` seconds are eliminated. */
    offscreenKill: boolean;
    offscreenGrace: number;
    /** Speed (m/s along the centre-line) for 'scroll' mode. */
    scrollSpeed: number;
  };

  race: {
    podiumSize: number; // N marbles shown on the podium (default 3)
    timeLimit: number; // seconds after the start gate opens
    countdown: number; // seconds before the start gate opens
    /** Validation requires at least this many marbles to finish. */
    minFinishers: number;
    /** Nudge marbles that have not moved for a while (deterministic). */
    unstuck: boolean;
    endMode: RaceEndMode;
  };

  map: {
    segments: number; // number of obstacle segments between start and finish
    width: number; // corridor width in metres
    difficulty: number; // 0..1
    maxAttempts: number; // validator: max seeds tried before giving up
    /** Regroup points per map: funnels / circular chambers with a turning propeller
     *  that holds marbles and lets them through a few at a time (0..4). */
    regroups: number;
  };
}

/** Fixed simulation timestep (seconds). Simulation is ALWAYS stepped with this dt. */
export const SIM_DT = 1 / 120;
/** View aspect ratio used by the deterministic sim camera (height = width * VIEW_ASPECT). */
export const VIEW_ASPECT = 9 / 16;

export function defaultConfig(): GameConfig {
  return {
    seed: 12345,
    marbles: {
      count: 20,
      radius: 0.45,
      skins: {
        solid: true,
        bicolor: true,
        tricolor: true,
        multicolor: true,
        silver: true,
        gold: true,
        glass: true,
        striped: true,
      },
      density: 1,
      friction: 0.1,
      restitution: 0.35,
      minScale: 0.5,
      maxScale: 2,
    },
    physics: {
      gravity: 9.8,
      gravityAngle: 0,
      windStrength: 0,
      windAngle: 90,
      launchStrength: 1.5,
      linearDamping: 0.05,
    },
    walls: {
      boundary: 'mixed',
      special: { bounce: true, slow: true, kill: true, launch: true },
      specialRatio: 0.25,
      bounceRestitution: 1.1,
      slowFactor: 0.85,
      launchStrength: 12,
    },
    objects: {
      kinds: { propeller: true, arm2: true, saw: true, triangle: true, hammer: true },
      effects: { grow: true, shrink: true, destroy: true, attract: true, repel: true },
      density: 0.5,
      speed: 1,
      effectChance: 0.6,
      zones: true,
    },
    monsters: {
      kinds: { spider: true, octopus: true, fish: true, snake: true },
      count: 5,
      groupSize: 4,
      destroyChance: 0.4,
      holdTime: 2,
      speed: 1,
    },
    switches: {
      enabled: true,
      actions: {
        lowGravity: true,
        highGravity: true,
        tiltGravity: true,
        reverseGravity: false,
        reverseMechanisms: true,
        fastMechanisms: true,
        wind: true,
        bouncy: true,
        openGate: true,
      },
      frequency: 0.35,
      duration: 6,
    },
    display: {
      background: 'auto',
    },
    camera: {
      mode: 'leader',
      viewWidth: 30,
      offscreenKill: false,
      offscreenGrace: 2,
      scrollSpeed: 1.5,
    },
    race: {
      podiumSize: 3,
      timeLimit: 180,
      countdown: 3,
      minFinishers: 3,
      unstuck: true,
      endMode: 'podium',
    },
    map: {
      segments: 8,
      width: 16,
      difficulty: 0.5,
      maxAttempts: 25,
      regroups: 2,
    },
  };
}
