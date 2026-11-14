/**
 * MapDef — pure-data description of a generated course.
 *
 * SHARED CONTRACT between generator (produces it), simulation (builds physics
 * from it) and renderer (draws its static parts). It must stay JSON-serialisable
 * (no classes, no functions). Do not rename/remove fields; adding OPTIONAL fields
 * is allowed.
 *
 * Coordinate system: metres, y DOWN. All points are WORLD coordinates unless
 * the field says "local". Angles are radians, measured the usual math way in
 * these coordinates (x' = x cos a - y sin a, y' = x sin a + y cos a), which on
 * screen (y down) looks clockwise for positive angles.
 */
import type { EffectType, MechanismKind, SkinType, SwitchActionType, WallReaction } from './config';

export interface Vec {
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ walls */

export type StaticShape =
  /** Thick wall following a polyline. Physics: one box per segment (+ circle at joints). */
  | { type: 'polyline'; points: Vec[]; thickness: number }
  /** CONVEX polygon, max 8 vertices, counter-clockwise or clockwise (sim must handle both). */
  | { type: 'polygon'; points: Vec[] }
  | { type: 'circle'; center: Vec; radius: number };

export interface Wall {
  id: string;
  shape: StaticShape;
  reaction: WallReaction;
  /** True for the course's outer side walls (reaction comes from config.walls.boundary). */
  boundary?: boolean;
  /** For 'launch': unit direction of the kick. If absent, kick along the contact normal (away from wall). */
  launchDir?: Vec;
  /** Visual hint only: bumper pegs, ramps, etc. */
  style?: 'wall' | 'peg' | 'bumper' | 'ramp' | 'bin';
}

/** Static obstacle that can be removed (opened) during the race. */
export interface Gate {
  id: string;
  shape: StaticShape;
  /** Gates start closed (solid). `start` gates open when the countdown ends. */
  role: 'start' | 'switch';
}

/* ------------------------------------------------------------ mechanisms */

/** Shape in a link's LOCAL frame: origin = the link's pivot, +x = link direction at angle 0. */
export type LocalShape =
  | { type: 'box'; cx: number; cy: number; hw: number; hh: number; angle: number }
  | { type: 'polygon'; points: Vec[] } // convex, max 8 vertices
  | { type: 'circle'; cx: number; cy: number; r: number };

export type LinkMotion =
  /** angle(t) = phase + speed * t  (speed in rad/s, affected by objects.speed and switches) */
  | { type: 'rotate'; speed: number; phase: number }
  /** angle(t) = center + amplitude * sin(phase + 2π * frequency * t) */
  | { type: 'oscillate'; center: number; amplitude: number; frequency: number; phase: number };

export interface MechLink {
  shapes: LocalShape[];
  /** Local point (in this link's frame) where the NEXT link's pivot is attached. */
  tip?: Vec;
  /** Angle of this link RELATIVE to its parent link (link 0: relative to world). */
  motion: LinkMotion;
}

export interface Mechanism {
  id: string;
  kind: MechanismKind;
  /** World position of link 0's pivot (fixed for the whole race). */
  pivot: Vec;
  /** links[0] rotates around `pivot`; links[i] rotates around links[i-1].tip. */
  links: MechLink[];
  /** Effect carried by this object, or null for a plain moving obstacle. */
  effect: EffectType | null;
  /**
   * For attract/repel: the field centre is the world position of this LOCAL point
   * on the LAST link (default {x:0,y:0} = last link's pivot).
   */
  fieldAnchor?: Vec;
  fieldRadius?: number; // metres (attract/repel)
  fieldStrength?: number; // acceleration m/s^2 at the centre (attract/repel)
}

/* ----------------------------------------------------------------- zones */

/** Static sensor pad that applies an effect to marbles touching / inside it. */
export interface Zone {
  id: string;
  shape: { type: 'circle'; center: Vec; radius: number } | { type: 'polygon'; points: Vec[] };
  effect: EffectType;
  /** attract/repel acceleration (m/s^2); grow/shrink scale factor per trigger (e.g. 1.25 / 0.8). */
  strength: number;
}

/* -------------------------------------------------------------- switches */

export interface SwitchAction {
  type: SwitchActionType;
  /** Meaning per type:
   *  lowGravity/highGravity: gravity multiplier (e.g. 0.35 / 1.8)
   *  tiltGravity: degrees added to the gravity direction (e.g. ±25)
   *  reverseGravity: multiplier (negative, e.g. -0.6)
   *  reverseMechanisms: speed multiplier (e.g. -1)
   *  fastMechanisms: speed multiplier (e.g. 2.5)
   *  wind: acceleration m/s^2 (direction in `angle`)
   *  bouncy: marble restitution while active (e.g. 0.9)
   *  openGate: unused (see gateId)
   */
  value: number;
  angle?: number; // direction angle in degrees (wind)
  gateId?: string; // openGate
}

export interface Switch {
  id: string;
  /** Button rectangle centre, half sizes and rotation. Marble contact triggers it. */
  position: Vec;
  halfWidth: number;
  halfHeight: number;
  angle: number;
  action: SwitchAction;
  /** 'timed': active for `duration` s then reverts (re-trigger restarts timer).
   *  'once': first hit applies permanently. */
  mode: 'timed' | 'once';
  duration: number;
  /** Short Spanish label for the HUD, e.g. "Gravedad baja". */
  label: string;
}

/* ------------------------------------------------------------- the map */

export interface SegmentInfo {
  type: string; // e.g. 'funnel', 'zigzag', 'pegs', 'propellers' ...
  /** Arc-length range along `path` covered by this segment. */
  from: number;
  to: number;
}

export interface MapDef {
  seed: number;
  /** Anything leaving these bounds is eliminated ('outOfBounds'). */
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
  /** Course centre-line from the start box to the finish line. Used for progress + camera. */
  path: Vec[];
  /** Unit vector: the "downhill" direction the course was generated for. */
  flowDir: Vec;
  walls: Wall[];
  gates: Gate[];
  mechanisms: Mechanism[];
  zones: Zone[];
  switches: Switch[];
  start: {
    /** One spawn point per marble (length === config.marbles.count). */
    spawnPoints: Vec[];
    /** Polygon outline of the start box (render only). */
    area: Vec[];
  };
  finish: {
    /** Finish line segment. A marble whose centre crosses it finishes. */
    a: Vec;
    b: Vec;
    /** Sensor polygon around the line (convex) used by the sim to detect crossing. */
    sensor: Vec[];
  };
  segments: SegmentInfo[];
  theme: { background: string; wall: string; accent: string };
}

/* --------------------------------------------------------------- marbles */

export interface MarbleSkin {
  type: SkinType;
  /** CSS colours. solid:1, bicolor:2, tricolor:3, striped:2, multicolor:>=5, silver/gold/glass: base tint(s). */
  colors: string[];
}

export interface MarbleProfile {
  id: number; // 0..count-1, index into spawnPoints
  name: string; // Spanish display name, e.g. "Rubí", "Plata", "Arcoíris"
  skin: MarbleSkin;
}
