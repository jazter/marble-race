import type { LinkPose, MechanismPose } from "../sim/api";
import type { Mechanism, Vec } from "../core/types";

/** Poses of a mechanism at race time `t` (default 0), computed from its link motions only. */
export function mechanismPoseAt(m: Mechanism, t = 0): MechanismPose {
  const links: LinkPose[] = [];
  let px = m.pivot.x;
  let py = m.pivot.y;
  let angle = 0;
  for (let i = 0; i < m.links.length; i++) {
    const link = m.links[i];
    const mo = link.motion;
    const rel =
      mo.type === "flipper"
        ? mo.rest
        : mo.type === "rotate"
          ? mo.phase + mo.speed * t
          : mo.type === "slide"
            ? mo.angle
            : mo.center +
              mo.amplitude * Math.sin(mo.phase + Math.PI * 2 * mo.frequency * t);
    if (mo.type === "slide") {
      const k = (1 - Math.cos(mo.phase + Math.PI * 2 * mo.frequency * t)) / 2;
      px += mo.dx * k;
      py += mo.dy * k;
    }
    angle += rel;
    links.push({ x: px, y: py, angle });
    if (link.tip) {
      const c = Math.cos(angle);
      const s = Math.sin(angle);
      px += link.tip.x * c - link.tip.y * s;
      py += link.tip.x * s + link.tip.y * c;
    }
  }
  let field: Vec | undefined;
  if (m.effect === "attract" || m.effect === "repel") {
    const last = links[links.length - 1];
    const a = m.fieldAnchor ?? { x: 0, y: 0 };
    const c = Math.cos(last.angle);
    const s = Math.sin(last.angle);
    field = { x: last.x + a.x * c - a.y * s, y: last.y + a.x * s + a.y * c };
  }
  return { id: m.id, links, field };
}
