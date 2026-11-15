/**
 * TEMPORARY dev mock (not part of the production bundle): a hand-made layout with one
 * monster of each kind and a scripted, looping timeline that mimics what the simulation
 * will report through `getMonsterStates()`. Used by the `?monsters-demo` page to look
 * at every phase of every monster.
 */
import type { Monster, Vec } from '../core/types';
import type { MarbleState, MonsterPhase, MonsterState, SimEvent, TentacleState } from '../sim/api';
import { sampleRoster } from '../core/fixtures';

export const CYCLE = 16;

export const MOCK_MONSTERS: Monster[] = [
  { id: 'spider-1', kind: 'spider', anchor: { x: -8, y: 10 }, down: { x: 0, y: 1 }, restLength: 3, maxLength: 10, huntWidth: 2, size: 0.8 },
  { id: 'octopus-1', kind: 'octopus', center: { x: 4, y: 20 }, bodyRadius: 1.6, reach: 6, tentacles: 8, facing: -Math.PI / 2, size: 1.6 },
  { id: 'fish-1', kind: 'fish', a: { x: -14, y: 34 }, b: { x: 14, y: 34 }, speed: 5, rest: 4, phase: 0, size: 0.8 },
  {
    id: 'snake-1',
    kind: 'snake',
    passes: [
      { a: { x: -12, y: 44 }, b: { x: 12, y: 50 } },
      { a: { x: 12, y: 56 }, b: { x: -12, y: 52 } },
    ],
    length: 7,
    speed: 4,
    rest: 4,
    phase: 0,
    size: 0.5,
  },
];

const ease = (t: number): number => {
  t = Math.max(0, Math.min(1, t));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp01 = (t: number): number => Math.max(0, Math.min(1, t));

export interface MockFrame {
  states: MonsterState[];
  marbles: MarbleState[];
}

const roster = sampleRoster(16);
const R = 0.45;

function marble(id: number, x: number, y: number, t: number, heldBy?: string, status: MarbleState['status'] = 'racing'): MarbleState {
  return {
    id,
    profile: roster[id % roster.length],
    x,
    y,
    angle: t * 2 + id,
    radius: R,
    vx: 0,
    vy: 0,
    status,
    progress: 0,
    offscreenTime: 0,
    heldBy,
  };
}

/** A marble that is free (hovering / falling) until `tFall`, then drops. */
function fall(x: number, y: number, since: number): Vec {
  const d = Math.max(0, since);
  return { x, y: y + 0.5 * 9.8 * d * d * 0.35 };
}

type Outcome = 'release' | 'devour';
export const outcomeOf = (cycle: number): Outcome => (cycle % 2 === 0 ? 'release' : 'devour');

export function mockFrame(time: number): MockFrame {
  const cycle = Math.floor(time / CYCLE);
  const u = time - cycle * CYCLE;
  const out = outcomeOf(cycle);
  const states: MonsterState[] = [];
  const marbles: MarbleState[] = [];
  let mid = 0;

  /* ---- spider: idle 0-3, hunting 3-5.5, holding 5.5-10, returning 10-13, idle */
  {
    const d = MOCK_MONSTERS[0] as Extract<Monster, { kind: 'spider' }>;
    const target = 9; // marble hangs 9 m below the anchor
    const bodyAtHold = target - (0.75 * d.size + R);
    let phase: MonsterPhase = 'idle';
    let pt = u;
    let len = d.restLength;
    let held = false;
    if (u >= 3 && u < 5.5) {
      phase = 'hunting';
      pt = u - 3;
      len = lerp(d.restLength, bodyAtHold, ease(pt / 2));
    } else if (u >= 5.5 && u < 10) {
      phase = 'holding';
      pt = u - 5.5;
      len = bodyAtHold;
      held = true;
    } else if (u >= 10 && u < 13) {
      phase = 'returning';
      pt = u - 10;
      len = lerp(bodyAtHold, d.restLength, ease(pt / 3));
      held = out === 'release' && u < 12 ? true : false;
      if (out === 'devour') held = false;
    } else if (u >= 13) {
      pt = u - 13;
    }
    const bx = d.anchor.x + d.down.x * len;
    const by = d.anchor.y + d.down.y * len;
    states.push({ id: d.id, kind: 'spider', phase, phaseTime: pt, x: bx, y: by, angle: Math.PI / 2, visible: 1, holding: held ? [mid] : [], threadLength: len });
    if (held) marbles.push(marble(mid, bx + d.down.x * (0.75 * d.size + R), by + d.down.y * (0.75 * d.size + R), time, d.id));
    else if (u < 10) marbles.push(marble(mid, d.anchor.x, d.anchor.y + target, time));
    else if (out === 'release') {
      const p = fall(d.anchor.x, d.anchor.y + bodyAtHold + 1.5, u - 12);
      marbles.push(marble(mid, p.x, p.y, time));
    }
    mid++;
  }

  /* ---- octopus: idle 0-3, hunting 3-5, holding 5-11, retract 11-13, idle */
  {
    const d = MOCK_MONSTERS[1] as Extract<Monster, { kind: 'octopus' }>;
    const tents: TentacleState[] = [];
    let phase: MonsterPhase = 'idle';
    let pt = u;
    const heldIds: number[] = [];
    const base = mid;
    for (let i = 0; i < 8; i++) {
      const a = d.facing + Math.PI + ((i + 0.5) / 8) * Math.PI * 2;
      const rr = d.bodyRadius + 0.74 * (d.reach - d.bodyRadius); // same rest length as the sim
      const rest: Vec = { x: d.center.x + Math.cos(a + 0.35) * rr, y: d.center.y + Math.sin(a + 0.35) * rr };
      const tgtA = a + 0.15 * Math.sin(i * 3.1);
      const tgt: Vec = { x: d.center.x + Math.cos(tgtA) * 4.2, y: d.center.y + Math.sin(tgtA) * 4.2 };
      let tip = rest;
      let state: TentacleState['state'] = 'idle';
      let mId: number | undefined;
      const stagger = i * 0.08;
      if (u >= 3 && u < 5) {
        phase = 'hunting';
        pt = u - 3;
        const k = ease((pt - stagger) / 1.2);
        tip = { x: lerp(rest.x, tgt.x, k), y: lerp(rest.y, tgt.y, k) };
        state = 'reach';
        marbles.push(marble(base + i, tgt.x, tgt.y, time));
      } else if (u >= 5 && u < 11) {
        phase = 'holding';
        pt = u - 5;
        const sw = Math.sin(time * 2 + i) * 0.12;
        tip = { x: tgt.x + sw, y: tgt.y + sw * 0.6 };
        state = 'hold';
        mId = base + i;
        heldIds.push(mId);
        marbles.push(marble(mId, tip.x, tip.y, time, d.id));
      } else if (u >= 11 && u < 13) {
        phase = 'returning';
        pt = u - 11;
        const k = ease((pt - stagger) / 1.2);
        tip = { x: lerp(tgt.x, rest.x, k), y: lerp(tgt.y, rest.y, k) };
        state = 'retract';
        const p = fall(tgt.x, tgt.y, pt);
        if (out === 'release' || i % 2 === 1) marbles.push(marble(base + i, p.x, p.y, time));
      } else {
        if (u >= 13) pt = u - 13;
        if (u < 3) marbles.push(marble(base + i, d.center.x + Math.cos(a) * 9, d.center.y + Math.sin(a) * 9 - 3, time));
      }
      tents.push({ x: tip.x, y: tip.y, state, marbleId: mId });
    }
    states.push({ id: d.id, kind: 'octopus', phase, phaseTime: pt, x: d.center.x, y: d.center.y, angle: d.facing, visible: 1, holding: heldIds, tentacles: tents });
    mid += 8;
  }

  /* ---- fish: hidden 0-2, crossing 2-8 (grab at 5, let go at 7), hidden */
  {
    const d = MOCK_MONSTERS[2] as Extract<Monster, { kind: 'fish' }>;
    const total = 6;
    const k = clamp01((u - 2) / total);
    const x = lerp(d.a.x - 2, d.b.x + 2, k);
    const y = d.a.y + Math.sin(k * 6) * 0.3;
    const catchU = 5;
    const letU = 7.2;
    const visible = u < 2 || u > 8 ? 0 : Math.min(1, (u - 2) / 0.6, (8 - u) / 0.6);
    let phase: MonsterPhase = u < 2 || u > 8 ? 'hidden' : 'hunting';
    let held = false;
    if (u >= catchU && u < letU) {
      phase = 'holding';
      held = true;
    }
    states.push({ id: d.id, kind: 'fish', phase, phaseTime: u, x, y, angle: 0, visible, holding: held ? [mid] : [], passFrom: { x: d.a.x - 2, y: d.a.y } });
    if (held) marbles.push(marble(mid, x + 0.1, y, time, d.id));
    else if (u < catchU) marbles.push(marble(mid, -1, d.a.y + 0.2, time));
    else if (out === 'release') {
      const p = fall(x, y, u - letU);
      marbles.push(marble(mid, p.x, p.y - 1 * Math.max(0, 0.6 - (u - letU)), time));
    }
    mid++;
  }

  /* ---- snake: hidden 0-1.5, pass 1.5-9 along a skewed line, grab at 5.2, let go at 7.4 */
  {
    const d = MOCK_MONSTERS[3] as Extract<Monster, { kind: 'snake' }>;
    const p = d.passes[cycle % 2];
    const dir = { x: p.b.x - p.a.x, y: p.b.y - p.a.y };
    const L = Math.hypot(dir.x, dir.y);
    const ux = dir.x / L;
    const uy = dir.y / L;
    const k = clamp01((u - 1.5) / 7.5);
    const dist = lerp(0, L + d.length * 0.6, k);
    const x = p.a.x + ux * dist;
    const y = p.a.y + uy * dist;
    const visible = u < 1.5 || u > 9 ? 0 : Math.min(1, (u - 1.5) / 0.5, (9 - u) / 0.8);
    let phase: MonsterPhase = u < 1.5 || u > 9 ? 'hidden' : 'hunting';
    const catchU = 5.2;
    const letU = 7.4;
    const held = u >= catchU && u < letU;
    if (held) phase = 'holding';
    states.push({ id: d.id, kind: 'snake', phase, phaseTime: u, x, y, angle: Math.atan2(uy, ux), visible, holding: held ? [mid] : [], passFrom: p.a });
    const mx = p.a.x + ux * (L * 0.5);
    const my = p.a.y + uy * (L * 0.5);
    if (held) marbles.push(marble(mid, x + ux * 0.05, y + uy * 0.05, time, d.id));
    else if (u < catchU) marbles.push(marble(mid, mx, my, time));
    else if (out === 'release') {
      const q = fall(x, y, u - letU);
      marbles.push(marble(mid, q.x, q.y, time));
    }
    mid++;
  }
  return { states, marbles };
}

/** Events that happen between two mock times (grab / release / devour). */
export function mockEvents(t0: number, t1: number): SimEvent[] {
  const evs: SimEvent[] = [];
  const c0 = Math.floor(t0 / CYCLE);
  const c1 = Math.floor(t1 / CYCLE);
  const sched = [
    { idx: 0, m: 0, kind: 'spider' as const, grab: 5.5, end: 10 },
    { idx: 1, m: 1, kind: 'octopus' as const, grab: 5.0, end: 11 },
    { idx: 2, m: 9, kind: 'fish' as const, grab: 5.0, end: 7.2 },
    { idx: 3, m: 10, kind: 'snake' as const, grab: 5.2, end: 7.4 },
  ];
  for (let c = c0; c <= c1; c++) {
    for (const s of sched) {
      const n = s.kind === 'octopus' ? 8 : 1;
      for (let i = 0; i < n; i++) {
        const mId = s.m + i;
        const act: { u: number; action: 'grab' | 'release' | 'devour' }[] = [
          { u: s.grab + i * 0.05, action: 'grab' },
          { u: s.end, action: outcomeOf(c) === 'devour' && (s.kind !== 'octopus' || i % 2 === 0) ? 'devour' : 'release' },
        ];
        for (const a of act) {
          const abs = c * CYCLE + a.u;
          if (abs <= t0 || abs > t1) continue;
          const f = mockFrame(abs - 1e-3);
          const mm = f.marbles.find((m) => m.id === mId);
          const st = f.states.find((x) => x.kind === s.kind)!;
          evs.push({ t: abs, type: 'monster', action: a.action, monsterId: st.id, kind: s.kind, marbleId: mId, x: mm?.x ?? st.x, y: mm?.y ?? st.y });
        }
      }
    }
  }
  return evs;
}
