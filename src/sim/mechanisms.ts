/** Kinematic mechanism runtime: motion state, world poses, planck bodies. */
import type { Body } from 'planck';
import type { LinkMotion, Mechanism } from '../core/types';
import type { LinkPose } from './api';

export interface MechRuntime {
  def: Mechanism;
  bodies: Body[];
  /** rotate: current angle; oscillate: current theta (phase argument). */
  state: number[];
  poses: LinkPose[];
  field?: { x: number; y: number };
  /** Per-link flipper state machine (null for rotate/oscillate links). */
  flip: (FlipState | null)[];
  /** Per-link: a racing marble is touching this link right now (set by the sim each step). */
  touch: boolean[];
}

export type FlipPhase = 'rest' | 'up' | 'hold' | 'down';

export interface FlipState {
  phase: FlipPhase;
  /** Seconds spent in the current phase (hold timer). */
  timer: number;
  /** Seconds since the last `down` phase began (cooldown clock). Starts large. */
  sinceDown: number;
}

export function initFlip(def: Mechanism): (FlipState | null)[] {
  return def.links.map((l) => (l.motion.type === 'flipper' ? { phase: 'rest', timer: 0, sinceDown: 1e9 } : null));
}

function moveToward(cur: number, target: number, maxStep: number): number {
  const d = target - cur;
  return Math.abs(d) <= maxStep ? target : cur + Math.sign(d) * maxStep;
}

/** Advance one flipper link's angle (state[i]); `touching` = a racing marble is on it. */
function advanceFlipper(rt: MechRuntime, i: number, m: Extract<LinkMotion, { type: 'flipper' }>, dt: number): void {
  const f = rt.flip[i]!;
  f.sinceDown += dt;
  f.timer += dt;
  if ((f.phase === 'rest' || f.phase === 'down') && rt.touch[i] && f.sinceDown >= m.cooldown) {
    f.phase = 'up';
    f.timer = 0;
  }
  let a = rt.state[i];
  if (f.phase === 'up') {
    a = moveToward(a, m.up, m.upSpeed * dt);
    if (a === m.up) {
      f.phase = 'hold';
      f.timer = 0;
    }
  } else if (f.phase === 'hold') {
    if (f.timer >= m.hold) {
      f.phase = 'down';
      f.timer = 0;
      f.sinceDown = 0;
    }
  } else if (f.phase === 'down') {
    a = moveToward(a, m.rest, m.downSpeed * dt);
    if (a === m.rest) {
      f.phase = 'rest';
      f.timer = 0;
    }
  }
  rt.state[i] = a;
}

export function initState(def: Mechanism): number[] {
  return def.links.map((l) => (l.motion.type === 'flipper' ? l.motion.rest : l.motion.phase));
}

/**
 * `mult` (objects.speed * switch effects) scales rotate/oscillate only. Flippers ignore it
 * on purpose: their kick must stay predictable regardless of speed settings/switches.
 */
export function advanceState(rt: MechRuntime, mult: number, dt: number): void {
  const links = rt.def.links;
  for (let i = 0; i < links.length; i++) {
    const m = links[i].motion;
    if (m.type === 'flipper') advanceFlipper(rt, i, m, dt);
    else if (m.type === 'rotate') rt.state[i] += m.speed * mult * dt;
    else if (m.type === 'slide') rt.state[i] += 2 * Math.PI * m.frequency * dt;
    else rt.state[i] += 2 * Math.PI * m.frequency * mult * dt;
  }
}

/** Fill rt.poses (+ field) from rt.state. */
export function computePoses(rt: MechRuntime): void {
  const links = rt.def.links;
  let px = rt.def.pivot.x;
  let py = rt.def.pivot.y;
  let wa = 0;
  for (let i = 0; i < links.length; i++) {
    const m = links[i].motion;
    const rel =
      m.type === 'rotate' || m.type === 'flipper' ? rt.state[i] : m.type === 'slide' ? m.angle : m.center + m.amplitude * Math.sin(rt.state[i]);
    if (m.type === 'slide') {
      const k = (1 - Math.cos(rt.state[i])) / 2;
      px += m.dx * k;
      py += m.dy * k;
    }
    wa += rel;
    const pose = rt.poses[i];
    pose.x = px;
    pose.y = py;
    pose.angle = wa;
    const fl = rt.flip[i];
    if (fl) pose.active = fl.phase === 'up';
    const tip = links[i].tip;
    if (tip) {
      const c = Math.cos(wa);
      const s = Math.sin(wa);
      px += tip.x * c - tip.y * s;
      py += tip.x * s + tip.y * c;
    }
  }
  if (rt.def.effect === 'attract' || rt.def.effect === 'repel') {
    const last = rt.poses[rt.poses.length - 1];
    const a = rt.def.fieldAnchor ?? { x: 0, y: 0 };
    const c = Math.cos(last.angle);
    const s = Math.sin(last.angle);
    const f = rt.field ?? (rt.field = { x: 0, y: 0 });
    f.x = last.x + a.x * c - a.y * s;
    f.y = last.y + a.x * s + a.y * c;
  }
}
