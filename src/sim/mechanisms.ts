/** Kinematic mechanism runtime: motion state, world poses, planck bodies. */
import type { Body } from 'planck';
import type { Mechanism } from '../core/types';
import type { LinkPose } from './api';

export interface MechRuntime {
  def: Mechanism;
  bodies: Body[];
  /** rotate: current angle; oscillate: current theta (phase argument). */
  state: number[];
  poses: LinkPose[];
  field?: { x: number; y: number };
}

export function initState(def: Mechanism): number[] {
  return def.links.map((l) => (l.motion.type === 'rotate' ? l.motion.phase : l.motion.phase));
}

export function advanceState(rt: MechRuntime, mult: number, dt: number): void {
  const links = rt.def.links;
  for (let i = 0; i < links.length; i++) {
    const m = links[i].motion;
    if (m.type === 'rotate') rt.state[i] += m.speed * mult * dt;
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
    const rel = m.type === 'rotate' ? rt.state[i] : m.center + m.amplitude * Math.sin(rt.state[i]);
    wa += rel;
    const pose = rt.poses[i];
    pose.x = px;
    pose.y = py;
    pose.angle = wa;
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
