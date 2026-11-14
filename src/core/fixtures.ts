/**
 * Small hand-made course used by tests and by the renderer while the real
 * generator is being built. Exercises every MapDef feature at least once.
 */
import { defaultConfig, type GameConfig } from './config';
import type { LocalShape, MapDef, MarbleProfile, Vec } from './types';

function propellerShapes(blades: number, length: number, width: number): LocalShape[] {
  const shapes: LocalShape[] = [{ type: 'circle', cx: 0, cy: 0, r: 0.4 }];
  for (let i = 0; i < blades; i++) {
    const a = (i / blades) * Math.PI * 2;
    shapes.push({
      type: 'box',
      cx: (Math.cos(a) * length) / 2,
      cy: (Math.sin(a) * length) / 2,
      hw: length / 2,
      hh: width / 2,
      angle: a,
    });
  }
  return shapes;
}

function sawShapes(radius: number, teeth: number): LocalShape[] {
  const shapes: LocalShape[] = [{ type: 'circle', cx: 0, cy: 0, r: radius }];
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2;
    const p = (ang: number, r: number): Vec => ({ x: Math.cos(ang) * r, y: Math.sin(ang) * r });
    shapes.push({ type: 'polygon', points: [p(a - 0.22, radius * 0.95), p(a + 0.22, radius * 0.95), p(a + 0.12, radius * 1.35)] });
  }
  return shapes;
}

export function sampleSpawnPoints(count: number, radius: number): Vec[] {
  const pts: Vec[] = [];
  const spacing = radius * 2.3;
  const perRow = Math.max(1, Math.floor(14 / spacing));
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    pts.push({ x: -7 + spacing / 2 + col * spacing + (row % 2) * (spacing / 2) * 0.5, y: 5.2 - row * spacing });
  }
  return pts;
}

export function sampleMap(count = 12, radius = 0.45): MapDef {
  return {
    seed: 0,
    bounds: { minX: -20, minY: -40, maxX: 20, maxY: 80 },
    path: [
      { x: 0, y: 0 },
      { x: 0, y: 8 },
      { x: 4, y: 12 },
      { x: -4, y: 18 },
      { x: 0, y: 22 },
      { x: 0, y: 50 },
      { x: 0, y: 62 },
    ],
    flowDir: { x: 0, y: 1 },
    walls: [
      {
        id: 'boundary',
        boundary: true,
        reaction: 'solid',
        style: 'wall',
        shape: {
          type: 'polyline',
          thickness: 0.5,
          points: [
            { x: -8, y: -30 },
            { x: -8, y: 50 },
            { x: -3, y: 58 },
            { x: -3, y: 62 },
            { x: -6, y: 65 },
            { x: -6, y: 72 },
            { x: 6, y: 72 },
            { x: 6, y: 65 },
            { x: 3, y: 62 },
            { x: 3, y: 58 },
            { x: 8, y: 50 },
            { x: 8, y: -30 },
          ],
        },
      },
      {
        id: 'ramp1',
        reaction: 'solid',
        style: 'ramp',
        shape: { type: 'polyline', thickness: 0.4, points: [{ x: -8, y: 10 }, { x: 2, y: 13 }] },
      },
      {
        id: 'ramp2',
        reaction: 'slow',
        style: 'ramp',
        shape: { type: 'polyline', thickness: 0.4, points: [{ x: 8, y: 16 }, { x: -2, y: 19 }] },
      },
      { id: 'peg1', reaction: 'solid', style: 'peg', shape: { type: 'circle', center: { x: -3, y: 23 }, radius: 0.35 } },
      { id: 'peg2', reaction: 'bounce', style: 'bumper', shape: { type: 'circle', center: { x: 2, y: 23.5 }, radius: 0.6 } },
      { id: 'peg3', reaction: 'solid', style: 'peg', shape: { type: 'circle', center: { x: 5, y: 25 }, radius: 0.35 } },
      {
        id: 'launcher',
        reaction: 'launch',
        launchDir: { x: 0.6, y: -0.8 },
        style: 'ramp',
        shape: { type: 'polygon', points: [{ x: -8, y: 44 }, { x: -5, y: 46 }, { x: -5, y: 46.5 }, { x: -8, y: 44.5 }] },
      },
      {
        id: 'lava',
        reaction: 'kill',
        style: 'wall',
        shape: { type: 'polyline', thickness: 0.3, points: [{ x: 8, y: 47 }, { x: 6.5, y: 48 }] },
      },
    ],
    gates: [
      {
        id: 'startGate',
        role: 'start',
        shape: { type: 'polygon', points: [{ x: -8, y: 6 }, { x: 8, y: 6 }, { x: 8, y: 6.4 }, { x: -8, y: 6.4 }] },
      },
      {
        id: 'trapdoor',
        role: 'switch',
        shape: { type: 'polygon', points: [{ x: -1, y: 52 }, { x: 1, y: 52 }, { x: 1, y: 52.3 }, { x: -1, y: 52.3 }] },
      },
    ],
    mechanisms: [
      {
        id: 'prop1',
        kind: 'propeller',
        pivot: { x: 0, y: 30 },
        links: [{ shapes: propellerShapes(3, 3, 0.4), motion: { type: 'rotate', speed: 1.5, phase: 0 } }],
        effect: 'shrink',
      },
      {
        id: 'arm1',
        kind: 'arm2',
        pivot: { x: -4, y: 36 },
        links: [
          {
            shapes: [{ type: 'box', cx: 1.5, cy: 0, hw: 1.5, hh: 0.2, angle: 0 }],
            tip: { x: 3, y: 0 },
            motion: { type: 'rotate', speed: 1, phase: 0 },
          },
          {
            shapes: [
              { type: 'box', cx: 1, cy: 0, hw: 1, hh: 0.15, angle: 0 },
              { type: 'circle', cx: 2, cy: 0, r: 0.35 },
            ],
            motion: { type: 'rotate', speed: -2, phase: 0 },
          },
        ],
        effect: 'attract',
        fieldAnchor: { x: 2, y: 0 },
        fieldRadius: 4,
        fieldStrength: 15,
      },
      {
        id: 'saw1',
        kind: 'saw',
        pivot: { x: 4.5, y: 41 },
        links: [{ shapes: sawShapes(1, 10), motion: { type: 'rotate', speed: 4, phase: 0 } }],
        effect: 'destroy',
      },
      {
        id: 'tri1',
        kind: 'triangle',
        pivot: { x: -3, y: 41 },
        links: [
          {
            shapes: [{ type: 'polygon', points: [{ x: 1.2, y: 0 }, { x: -0.6, y: 1.04 }, { x: -0.6, y: -1.04 }] }],
            motion: { type: 'rotate', speed: -1.2, phase: 0 },
          },
        ],
        effect: 'grow',
      },
      {
        id: 'hammer1',
        kind: 'hammer',
        pivot: { x: 0, y: 53.5 },
        links: [
          {
            shapes: [
              { type: 'box', cx: 0, cy: 1.2, hw: 0.12, hh: 1.2, angle: 0 },
              { type: 'box', cx: 0, cy: 2.5, hw: 0.6, hh: 0.3, angle: 0 },
            ],
            motion: { type: 'oscillate', center: 0, amplitude: 0.9, frequency: 0.5, phase: 0 },
          },
        ],
        effect: 'repel',
        fieldAnchor: { x: 0, y: 2.5 },
        fieldRadius: 2.5,
        fieldStrength: 10,
      },
    ],
    zones: [{ id: 'growPad', effect: 'grow', strength: 1.25, shape: { type: 'circle', center: { x: -5.5, y: 27 }, radius: 1 } }],
    switches: [
      {
        id: 'sw1',
        position: { x: 2.9, y: 17.16 },
        halfWidth: 0.8,
        halfHeight: 0.15,
        angle: -0.2915,
        action: { type: 'lowGravity', value: 0.4 },
        mode: 'timed',
        duration: 5,
        label: 'Gravedad baja',
      },
      {
        id: 'sw2',
        position: { x: -6.2, y: 45.6 },
        halfWidth: 0.5,
        halfHeight: 0.12,
        angle: 0.588,
        action: { type: 'openGate', value: 0, gateId: 'trapdoor' },
        mode: 'once',
        duration: 0,
        label: 'Abrir compuerta',
      },
    ],
    start: {
      spawnPoints: sampleSpawnPoints(count, radius),
      area: [
        { x: -8, y: -30 },
        { x: 8, y: -30 },
        { x: 8, y: 6 },
        { x: -8, y: 6 },
      ],
    },
    finish: {
      a: { x: -3, y: 62 },
      b: { x: 3, y: 62 },
      sensor: [
        { x: -3, y: 61.7 },
        { x: 3, y: 61.7 },
        { x: 3, y: 62.3 },
        { x: -3, y: 62.3 },
      ],
    },
    segments: [
      { type: 'start', from: 0, to: 8 },
      { type: 'zigzag', from: 8, to: 22 },
      { type: 'pegs', from: 22, to: 28 },
      { type: 'mechanisms', from: 28, to: 50 },
      { type: 'finish', from: 50, to: 62 },
    ],
    theme: { background: '#10131c', wall: '#c9d1e0', accent: '#ffcc33' },
  };
}

export function sampleRoster(count = 12): MarbleProfile[] {
  const colors = ['#e6194b', '#3cb44b', '#ffe119', '#4363d8', '#f58231', '#911eb4', '#46f0f0', '#f032e6'];
  return Array.from({ length: count }, (_, i) => ({
    id: i,
    name: `Canica ${i + 1}`,
    skin: { type: 'solid' as const, colors: [colors[i % colors.length]] },
  }));
}

export function sampleConfig(count = 12): GameConfig {
  const c = defaultConfig();
  c.marbles.count = count;
  return c;
}
