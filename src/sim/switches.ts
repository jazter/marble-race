/** Switch runtime state + combination of active switches into the physics state. */
import type { GameConfig } from '../core/config';
import { dirFromAngle } from '../core/math';
import type { Switch } from '../core/types';
import type { PhysicsState } from './api';

export interface SwitchRuntime {
  def: Switch;
  active: boolean;
  remaining: number;
  hits: number;
}

export function combinePhysics(config: GameConfig, switches: readonly SwitchRuntime[]): PhysicsState {
  let gScale = 1;
  let tilt = 0;
  let mech = config.objects.speed;
  let windX = 0;
  let windY = 0;
  let bouncy: number | null = null;
  const labels: string[] = [];
  const base = dirFromAngle(config.physics.windAngle);
  windX = base.x * config.physics.windStrength;
  windY = base.y * config.physics.windStrength;
  for (const s of switches) {
    if (!s.active) continue;
    labels.push(s.def.label);
    const a = s.def.action;
    switch (a.type) {
      case 'lowGravity':
      case 'highGravity':
      case 'reverseGravity':
        gScale *= a.value;
        break;
      case 'tiltGravity':
        tilt += a.value;
        break;
      case 'reverseMechanisms':
      case 'fastMechanisms':
        mech *= a.value;
        break;
      case 'wind': {
        const d = dirFromAngle(a.angle ?? 0);
        windX += d.x * a.value;
        windY += d.y * a.value;
        break;
      }
      case 'bouncy':
        bouncy = bouncy === null ? a.value : Math.max(bouncy, a.value);
        break;
      case 'openGate':
        break;
    }
  }
  const g = dirFromAngle(config.physics.gravityAngle + tilt);
  const gm = config.physics.gravity * gScale;
  return {
    gravity: { x: g.x * gm, y: g.y * gm },
    wind: { x: windX, y: windY },
    mechanismSpeed: mech,
    marbleRestitution: bouncy ?? config.marbles.restitution,
    activeLabels: labels,
  };
}
