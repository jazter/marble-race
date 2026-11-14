/**
 * Deterministic marble roster: colours, skins and unique Spanish names.
 * Same (config, seed) => same roster. Uses only the seeded Rng.
 */
import type { GameConfig, SkinType } from './config';
import type { MarbleProfile } from './types';
import { Rng } from './rng';

const GOLDEN_ANGLE = 137.50776405;

/** Named hues (degrees). Used to give colours a Spanish gem/colour name. */
const NAMED_HUES: { name: string; hue: number }[] = [
  { name: 'Rubí', hue: 352 },
  { name: 'Carmesí', hue: 342 },
  { name: 'Granate', hue: 0 },
  { name: 'Coral', hue: 14 },
  { name: 'Ámbar', hue: 34 },
  { name: 'Topacio', hue: 48 },
  { name: 'Lima', hue: 80 },
  { name: 'Esmeralda', hue: 135 },
  { name: 'Jade', hue: 158 },
  { name: 'Menta', hue: 172 },
  { name: 'Turquesa', hue: 186 },
  { name: 'Cobalto', hue: 208 },
  { name: 'Zafiro', hue: 225 },
  { name: 'Índigo', hue: 250 },
  { name: 'Amatista', hue: 276 },
  { name: 'Fucsia', hue: 312 },
];

const SKIN_ORDER: SkinType[] = ['solid', 'bicolor', 'tricolor', 'striped', 'multicolor', 'silver', 'gold', 'glass'];

const hsl = (h: number, s: number, l: number): string => `hsl(${Math.round(((h % 360) + 360) % 360)}, ${Math.round(s)}%, ${Math.round(l)}%)`;

function hueDist(a: number, b: number): number {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
}

function toRoman(n: number): string {
  const table: [number, string][] = [
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'], [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  for (const [v, s] of table) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

export function createRoster(config: GameConfig, seed: number): MarbleProfile[] {
  const rng = new Rng((seed >>> 0) ^ 0x51ed270b);
  const count = Math.max(0, Math.floor(config.marbles.count));
  const enabled = SKIN_ORDER.filter((t) => config.marbles.skins[t]);
  const types: SkinType[] = enabled.length > 0 ? enabled : ['solid'];

  const hueOffset = rng.range(0, 360);
  const usedNames = new Set<string>();
  const baseCounts = new Map<string, number>();
  const usedSolidNames = new Set<string>();

  const unique = (base: string): string => {
    let n = baseCounts.get(base) ?? 0;
    let name: string;
    do {
      name = n === 0 ? base : `${base} ${toRoman(n + 1)}`;
      n++;
    } while (usedNames.has(name));
    baseCounts.set(base, n);
    usedNames.add(name);
    return name;
  };

  /** Nearest named colour by hue; prefers a not-yet-used one among the closest few. */
  const colourName = (hue: number, exclusive: boolean): string => {
    const sorted = [...NAMED_HUES].sort((a, b) => hueDist(a.hue, hue) - hueDist(b.hue, hue));
    if (exclusive) {
      for (const c of sorted.slice(0, 4)) {
        if (!usedSolidNames.has(c.name)) {
          usedSolidNames.add(c.name);
          return c.name;
        }
      }
    }
    return sorted[0].name;
  };

  // Weighted type table: solid gets ~45% when enabled with other types.
  const weights = types.map((t) => (types.length === 1 ? 1 : t === 'solid' ? 0.45 * (types.length - 1) / 0.55 : 1));
  // Sampled sequentially so counts stay close to the targets without big streaks.
  const profiles: MarbleProfile[] = [];
  for (let i = 0; i < count; i++) {
    const type = types.length === 1 ? types[0] : rng.weighted(types, weights);
    const hue = hueOffset + i * GOLDEN_ANGLE;
    const sat = rng.range(68, 90);
    const light = rng.range(48, 60);
    const main = hsl(hue, sat, light);
    let colors: string[];
    let base: string;
    switch (type) {
      case 'solid': {
        colors = [main];
        base = colourName(hue, true);
        break;
      }
      case 'bicolor': {
        const h2 = hue + rng.range(120, 220);
        colors = [main, hsl(h2, rng.range(68, 90), rng.range(50, 62))];
        base = `${colourName(hue, false)} y ${colourName(h2, false)}`;
        break;
      }
      case 'tricolor': {
        const h2 = hue + 120 + rng.range(-20, 20);
        const h3 = hue + 240 + rng.range(-20, 20);
        colors = [main, hsl(h2, 78, 55), hsl(h3, 78, 55)];
        base = `Trío ${colourName(hue, false)}`;
        break;
      }
      case 'striped': {
        const h2 = hue + rng.range(150, 210);
        colors = [main, hsl(h2, 25, rng.range(88, 96))];
        base = `${colourName(hue, false)} rayada`;
        break;
      }
      case 'multicolor': {
        const n = rng.int(5, 7);
        const h0 = rng.range(0, 360);
        colors = Array.from({ length: n }, (_, k) => hsl(h0 + (k * 360) / n, 85, 55));
        base = 'Arcoíris';
        break;
      }
      case 'silver':
        colors = [hsl(215, rng.range(8, 16), rng.range(78, 86)), hsl(220, 10, 46)];
        base = 'Plata';
        break;
      case 'gold':
        colors = [hsl(rng.range(44, 50), rng.range(88, 100), rng.range(58, 64)), hsl(38, 90, 36)];
        base = 'Oro';
        break;
      case 'glass':
      default:
        colors = [hsl(hue, 70, 62), hsl(hue + 40, 80, 80)];
        base = `Cristal ${colourName(hue, false)}`;
        break;
    }
    profiles.push({ id: i, name: unique(base), skin: { type, colors } });
  }
  return profiles;
}
