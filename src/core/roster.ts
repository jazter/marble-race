/**
 * Deterministic marble roster built from a FIXED catalog of unique looks.
 *
 * - The catalog is not seeded: every look has a stable `key` (derived only from
 *   the look itself) and a unique Spanish name, so spectator-given names can be
 *   remembered across races.
 * - `createRoster(config, seed)` takes the first `count` catalog entries for the
 *   enabled skin types (interleaved in a fixed mix) and only shuffles WHO starts
 *   WHERE with the seed. Same (config, seed) => identical roster; same enabled
 *   types + count => same set of looks for every seed.
 */
import type { GameConfig, SkinType } from './config';
import type { MarbleProfile, MarbleSkin } from './types';
import { Rng } from './rng';

export interface CatalogEntry {
  key: string;
  name: string;
  skin: MarbleSkin;
}

/* ------------------------------------------------------------ colour maths */

interface Hsl {
  h: number;
  s: number;
  l: number;
}

const hslCss = (h: number, s: number, l: number): string =>
  `hsl(${Math.round(((h % 360) + 360) % 360)}, ${Math.round(s)}%, ${Math.round(l)}%)`;

function hslToLab(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = s / 100;
  const ll = l / 100;
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  const f = (t0: number): number => {
    let t = t0;
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };
  const lin = (c: number): number => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const r = lin(f(hh + 1 / 3));
  const g = lin(f(hh));
  const b = lin(f(hh - 1 / 3));
  const x = (0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047;
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const z = (0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883;
  const t = (v: number): number => (v > 0.008856 ? Math.cbrt(v) : 7.787 * v + 16 / 116);
  const fx = t(x);
  const fy = t(y);
  const fz = t(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

type Lab = [number, number, number];
const labDist = (a: Lab, b: Lab): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

/** Perceptual distance (CIE76 deltaE) between two `hsl(h, s%, l%)` CSS strings produced by this module. */
export function colorDistance(a: string, b: string): number {
  const parse = (c: string): Lab => {
    const m = /hsl\(\s*(-?[\d.]+)\s*,\s*([\d.]+)%\s*,\s*([\d.]+)%\s*\)/i.exec(c);
    if (!m) throw new Error(`colorDistance: unsupported colour ${c}`);
    return hslToLab(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  };
  return labDist(parse(a), parse(b));
}

/* ----------------------------------------------------------------- naming */

const slug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

/** Hue names every 15 degrees (solid / glass / rainbow naming). */
const HUE_NAMES = [
  'Escarlata', 'Coral', 'Calabaza', 'Ámbar', 'Limón', 'Pistacho', 'Manzana', 'Hierba',
  'Verde', 'Selva', 'Jade', 'Menta', 'Aguamarina', 'Cian', 'Cobalto', 'Azul',
  'Añil', 'Índigo', 'Amatista', 'Orquídea', 'Magenta', 'Frambuesa', 'Cereza', 'Carmesí',
];

/** Tint adjectives every 15 degrees (metal naming: "Plata azulada"). */
const TINT_NAMES = [
  'rojiza', 'coral', 'anaranjada', 'ambarina', 'amarillenta', 'cetrina', 'lima', 'herbosa',
  'verdosa', 'esmeralda', 'jade', 'menta', 'aguamarina', 'celeste', 'cobalto', 'azulada',
  'añil', 'índigo', 'violácea', 'orquídea', 'magenta', 'frambuesa', 'rosada', 'carmesí',
];

const MASCULINE: Record<string, string> = {
  rojiza: 'rojizo', anaranjada: 'anaranjado', ambarina: 'ambarino', amarillenta: 'amarillento', cetrina: 'cetrino',
  herbosa: 'herboso', verdosa: 'verdoso', azulada: 'azulado', violácea: 'violáceo', rosada: 'rosado',
  marcada: 'marcado', intensa: 'intenso', oscura: 'oscuro', clara: 'claro',
};
/** Agree an adjective with "Oro" (masculine); invariable words pass through. */
const masc = (w: string): string => MASCULINE[w] ?? w;

/** Visiting order for the 24 hues: 7 is coprime with 24, so neighbours in the order are far apart. */
const HUE_ORDER = Array.from({ length: 24 }, (_, i) => (i * 7) % 24);

/* -------------------------------------------------------------- solids */

interface Solid {
  key: string;
  name: string;
  hsl: Hsl;
  css: string;
  lab: Lab;
}

const mkSolid = (key: string, name: string, h: number, s: number, l: number): Solid => ({
  key,
  name,
  hsl: { h, s, l },
  css: hslCss(h, s, l),
  lab: hslToLab(h, s, l),
});

/** Hand-picked base colours, in an order where neighbours are as different as possible. */
const BASE_SOLIDS: [string, number, number, number][] = [
  ['Rubí', 356, 82, 44],
  ['Zafiro', 224, 82, 42],
  ['Girasol', 50, 96, 52],
  ['Esmeralda', 142, 72, 34],
  ['Fucsia', 316, 82, 54],
  ['Mandarina', 24, 96, 52],
  ['Celeste', 198, 92, 62],
  ['Ébano', 0, 0, 11],
  ['Lima', 86, 72, 48],
  ['Violeta', 268, 66, 48],
  ['Marfil', 48, 40, 94],
  ['Turquesa', 176, 78, 40],
  ['Chocolate', 24, 56, 26],
  ['Rosa', 340, 92, 80],
  ['Burdeos', 338, 68, 24],
  ['Oliva', 66, 62, 30],
];

const GRID_LIGHT: [number, string][] = [
  [20, 'muy oscuro'],
  [34, 'oscuro'],
  [50, 'vivo'],
  [68, 'claro'],
  [84, 'pastel'],
];
const GRID_SAT: [number, string][] = [
  [90, ''],
  [60, 'suave'],
  [30, 'apagado'],
];

let solidsCache: Solid[] | null = null;

/** Base colours first, then hue x lightness x saturation variants by farthest-point order. */
function solids(): Solid[] {
  if (solidsCache) return solidsCache;
  const out: Solid[] = BASE_SOLIDS.map(([n, h, s, l]) => mkSolid(`solid-${slug(n)}`, n, h, s, l));
  const pool: Solid[] = [];
  for (const [l, lw] of GRID_LIGHT) {
    for (const [s, sw] of GRID_SAT) {
      for (let i = 0; i < 24; i++) {
        const name = `${HUE_NAMES[i]} ${lw}${sw ? ` ${sw}` : ''}`;
        pool.push(mkSolid(`solid-${slug(name)}`, name, i * 15, s, l));
      }
    }
  }
  const minD = pool.map((c) => Math.min(...out.map((o) => labDist(c.lab, o.lab))));
  const taken = new Array<boolean>(pool.length).fill(false);
  for (;;) {
    let best = -1;
    for (let i = 0; i < pool.length; i++) {
      if (!taken[i] && (best < 0 || minD[i] > minD[best])) best = i;
    }
    if (best < 0 || minD[best] < 1.5) break;
    taken[best] = true;
    const c = pool[best];
    out.push(c);
    for (let i = 0; i < pool.length; i++) {
      if (!taken[i]) minD[i] = Math.min(minD[i], labDist(pool[i].lab, c.lab));
    }
  }
  solidsCache = out;
  return out;
}

/* ------------------------------------------------- greedy combo ordering */

interface Combo {
  members: number[];
  score: number;
  entry: CatalogEntry;
}

/** Repeatedly pick the best-scoring combo, penalising colours that were already used. */
function greedyOrder(combos: Combo[], penalty: number): CatalogEntry[] {
  const used = new Map<number, number>();
  const left = combos.slice();
  const out: CatalogEntry[] = [];
  while (left.length > 0) {
    let best = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < left.length; i++) {
      let sc = left[i].score;
      for (const m of left[i].members) sc -= penalty * (used.get(m) ?? 0);
      if (sc > bestScore) {
        bestScore = sc;
        best = i;
      }
    }
    const c = left.splice(best, 1)[0];
    for (const m of c.members) used.set(m, (used.get(m) ?? 0) + 1);
    out.push(c.entry);
  }
  return out;
}

const list = (and: string[]): string => (and.length <= 1 ? and.join('') : `${and.slice(0, -1).join(', ')} y ${and[and.length - 1]}`);

/* ------------------------------------------------------ per-type catalogs */

function solidEntries(): CatalogEntry[] {
  return solids().map((s) => ({ key: s.key, name: s.name, skin: { type: 'solid', colors: [s.css] } }));
}

function bicolorEntries(): CatalogEntry[] {
  const S = solids();
  const mk = (i: number, j: number): Combo => ({
    members: [i, j],
    score: labDist(S[i].lab, S[j].lab),
    entry: {
      key: `bicolor-${slug(S[i].name)}-${slug(S[j].name)}`,
      name: list([S[i].name, S[j].name]),
      skin: { type: 'bicolor', colors: [S[i].css, S[j].css] },
    },
  });
  const stage1: Combo[] = [];
  const stage2: Combo[] = [];
  for (let j = 1; j < 24; j++) {
    for (let i = 0; i < j; i++) {
      const c = mk(i, j);
      if (c.score < 14) continue;
      (j < 16 ? stage1 : stage2).push(c);
    }
  }
  return [...greedyOrder(stage1, 8), ...greedyOrder(stage2, 8)];
}

function tricolorEntries(): CatalogEntry[] {
  const S = solids();
  const combos: Combo[] = [];
  for (let a = 0; a < 16; a++) {
    for (let b = a + 1; b < 16; b++) {
      for (let c = b + 1; c < 16; c++) {
        const score = Math.min(labDist(S[a].lab, S[b].lab), labDist(S[a].lab, S[c].lab), labDist(S[b].lab, S[c].lab));
        if (score < 14) continue;
        combos.push({
          members: [a, b, c],
          score,
          entry: {
            key: `tricolor-${slug(S[a].name)}-${slug(S[b].name)}-${slug(S[c].name)}`,
            name: list([S[a].name, S[b].name, S[c].name]),
            skin: { type: 'tricolor', colors: [S[a].css, S[b].css, S[c].css] },
          },
        });
      }
    }
  }
  return greedyOrder(combos, 8);
}

function stripedEntries(): CatalogEntry[] {
  const S = solids();
  const marfil = S.findIndex((s) => s.name === 'Marfil');
  const stage1: Combo[] = [];
  const stage2: Combo[] = [];
  for (let m = 0; m < 16; m++) {
    for (let t = 0; t < 24; t++) {
      if (t === m) continue;
      const score = labDist(S[m].lab, S[t].lab);
      if (score < 25) continue;
      const name = t === marfil ? `Rayas ${S[m].name}` : `${S[m].name} con rayas ${S[t].name}`;
      const c: Combo = {
        members: [m, t],
        score,
        entry: {
          key: `striped-${slug(S[m].name)}-${slug(S[t].name)}`,
          name,
          skin: { type: 'striped', colors: [S[m].css, S[t].css] },
        },
      };
      (t < 16 ? stage1 : stage2).push(c);
    }
  }
  return [...greedyOrder(stage1, 10), ...greedyOrder(stage2, 10)];
}

/**
 * Multicolour looks. The renderer draws them as a conic gradient that turns as
 * the marble rolls, so two palettes that are the same hue cycle started at a
 * different point would look identical. Every entry therefore uses a different
 * SET of colours: themed palettes first, then gradients over distinct hue windows.
 */
function multicolorEntries(): CatalogEntry[] {
  const out: CatalogEntry[] = [];
  const seen = new Set<string>();
  const push = (key: string, name: string, colors: string[]): void => {
    const sig = [...colors].sort().join(',');
    if (seen.has(sig)) return;
    seen.add(sig);
    out.push({ key, name, skin: { type: 'multicolor', colors } });
  };
  const hs = (list: [number, number, number][]): string[] => list.map(([h, sat, l]) => hslCss(h, sat, l));
  const vivid = (hues: number[], sat = 85, l = 55): string[] => hues.map((h) => hslCss(h, sat, l));

  push('multicolor-arcoiris', 'Arcoíris', vivid(Array.from({ length: 7 }, (_, k) => (k * 360) / 7)));
  push('multicolor-atardecer', 'Atardecer', vivid([330, 350, 10, 28, 45], 88, 56));
  push('multicolor-oceano', 'Océano', vivid([168, 184, 200, 216, 234], 80, 50));
  push('multicolor-bosque', 'Bosque', vivid([58, 82, 108, 132, 152], 70, 42));
  push('multicolor-galaxia', 'Galaxia', vivid([236, 256, 276, 296, 318], 75, 50));
  push('multicolor-caramelo', 'Caramelo', vivid([330, 50, 160, 200, 280], 80, 78));
  push('multicolor-fuego', 'Fuego', vivid([0, 12, 24, 38, 52], 95, 52));
  push('multicolor-aurora', 'Aurora', vivid([140, 165, 190, 270, 300], 80, 55));
  push('multicolor-tropical', 'Tropical', vivid([50, 90, 170, 320, 15], 90, 55));
  push('multicolor-tierra', 'Tierra', hs([[25, 55, 32], [35, 60, 45], [45, 45, 58], [80, 35, 40], [15, 50, 26]]));
  push('multicolor-hielo', 'Hielo', hs([[180, 60, 80], [200, 70, 85], [220, 60, 72], [190, 30, 92], [240, 50, 80]]));
  push('multicolor-neon', 'Neón', vivid([300, 60, 180, 120, 20], 100, 56));

  // Long tail (needed when only multicolour is enabled): gradients over a hue
  // window — 12 centres x 3 widths x 3 styles x 2 tone counts.
  const widths: [number, string][] = [[70, ''], [130, ' amplio'], [200, ' extendido']];
  const styles: [string, number, number][] = [['', 85, 55], [' pastel', 75, 78], [' oscuro', 70, 34]];
  for (const [sw, sat, l] of styles) {
    for (const [w, wn] of widths) {
      for (const n of [5, 7]) {
        for (let c = 0; c < 12; c++) {
          const centre = ((c * 7) % 12) * 30;
          const hues = Array.from({ length: n }, (_, k) => centre - w / 2 + (k * w) / (n - 1));
          const name = `Degradado ${HUE_NAMES[centre / 15]}${wn}${sw}${n === 5 ? '' : ' de 7 tonos'}`;
          push(`multicolor-${slug(name)}`, name, vivid(hues, sat, l));
        }
      }
    }
  }
  return out;
}

/** Tinted metal: neutral base first, then strength x lightness combos with hues spread out. */
function metalEntries(metal: 'silver' | 'gold'): CatalogEntry[] {
  const label = metal === 'silver' ? 'Plata' : 'Oro';
  const out: CatalogEntry[] = [];
  out.push({
    key: `${metal}-${slug(label)}`,
    name: label,
    skin: {
      type: metal,
      colors: metal === 'silver' ? [hslCss(215, 12, 82), hslCss(220, 10, 46)] : [hslCss(47, 95, 60), hslCss(38, 90, 36)],
    },
  });
  const strengths: [string, number][] =
    metal === 'silver'
      ? [['', 22], ['marcada', 40], ['intensa', 60]]
      : [['', 70], ['marcada', 85], ['intensa', 100]];
  const tiers: [string, number, number][] =
    metal === 'silver'
      ? [['', 82, 46], ['oscura', 62, 30], ['clara', 92, 62]]
      : [['', 60, 36], ['oscura', 46, 26], ['clara', 74, 48]];
  const combos: [[string, number], [string, number, number]][] = [];
  for (const t of tiers) for (const s of strengths) combos.push([s, t]);
  // Visit the (strength, tier) combos tier-major but start with the plain one.
  for (const [[sw, sat], [tw, hi, lo]] of combos) {
    for (const hIdx of HUE_ORDER) {
      // Gold keeps a golden cast: its hue only leans towards the tint instead of fully taking it.
      const h = metal === 'gold' ? 47 + ((((hIdx * 15 - 47 + 540) % 360) - 180) * 0.4) : hIdx * 15;
      const g = metal === 'gold' ? masc : (w: string): string => w;
      const name = `${label} ${g(TINT_NAMES[hIdx])}${sw ? ` ${g(sw)}` : ''}${tw ? ` ${g(tw)}` : ''}`;
      out.push({
        key: `${metal}-${slug(name.slice(label.length + 1))}`,
        name,
        skin: {
          type: metal,
          colors:
            metal === 'silver'
              ? [hslCss(h, sat, hi), hslCss(h, sat * 0.7, lo)]
              : [hslCss(h, sat, hi), hslCss(h - 9, sat, lo)],
        },
      });
    }
  }
  return out;
}

function glassEntries(): CatalogEntry[] {
  const S = solids();
  const out: CatalogEntry[] = [];
  out.push({
    key: 'glass-cristal',
    name: 'Cristal',
    skin: { type: 'glass', colors: [hslCss(200, 22, 78), hslCss(200, 30, 94)] },
  });
  const seen = new Set<string>();
  for (const s of S) {
    const { h, s: sat, l } = s.hsl;
    const tint = hslCss(h, Math.max(sat, 35), Math.min(Math.max(l, 28), 74));
    const tint2 = hslCss(h + 20, Math.max(sat, 35), Math.min(l + 28, 90));
    if (seen.has(tint + tint2)) continue;
    seen.add(tint + tint2);
    out.push({
      key: `glass-${slug(s.name)}`,
      name: `Cristal ${s.name}`,
      skin: { type: 'glass', colors: [tint, tint2] },
    });
  }
  return out;
}

/* ------------------------------------------------------------- catalogs */

/** Types in tie-break order for the interleave (the first entries of each family are the "showpieces"). */
const SKIN_ORDER: SkinType[] = ['solid', 'silver', 'gold', 'multicolor', 'glass', 'bicolor', 'tricolor', 'striped'];

const builders: Record<SkinType, () => CatalogEntry[]> = {
  solid: solidEntries,
  silver: () => metalEntries('silver'),
  gold: () => metalEntries('gold'),
  multicolor: multicolorEntries,
  glass: glassEntries,
  bicolor: bicolorEntries,
  tricolor: tricolorEntries,
  striped: stripedEntries,
};

const typeCache = new Map<SkinType, CatalogEntry[]>();

/** The full, fixed, ordered catalog of one skin type (most distinct looks first). */
export function catalogForType(type: SkinType): readonly CatalogEntry[] {
  let c = typeCache.get(type);
  if (!c) {
    c = builders[type]();
    typeCache.set(type, c);
  }
  return c;
}

/** Share of the roster given to each type when several are enabled (solids ~45%). */
function weightsFor(types: SkinType[]): number[] {
  if (types.length === 1) return [1];
  const hasSolid = types.includes('solid');
  return types.map((t) => (t === 'solid' ? 0.45 : (hasSolid ? 0.55 : 1) / (types.length - (hasSolid ? 1 : 0))));
}

/**
 * The first `count` catalog entries for the enabled types, interleaved with a
 * fixed smooth weighted round-robin. A prefix of a longer result is always the
 * shorter result, so raising the count only adds entries.
 */
export function skinCatalog(enabled: readonly SkinType[], count = 200): CatalogEntry[] {
  const types = SKIN_ORDER.filter((t) => enabled.includes(t));
  if (types.length === 0) types.push('solid');
  const w = weightsFor(types);
  const total = w.reduce((a, b) => a + b, 0);
  const credit = types.map(() => 0);
  const next = types.map(() => 0);
  const out: CatalogEntry[] = [];
  const n = Math.max(0, Math.floor(count));
  while (out.length < n) {
    let best = -1;
    for (let i = 0; i < types.length; i++) {
      if (next[i] >= catalogForType(types[i]).length) continue;
      credit[i] += w[i];
    }
    for (let i = 0; i < types.length; i++) {
      if (next[i] >= catalogForType(types[i]).length) continue;
      if (best < 0 || credit[i] > credit[best] + 1e-9) best = i;
    }
    if (best < 0) break;
    credit[best] -= total;
    out.push(catalogForType(types[best])[next[best]++]);
  }
  return out;
}

/** Build the roster: fixed looks for (enabled types, count); only the spawn order depends on the seed. */
/**
 * @param preferredKeys looks that must be in the race when possible (e.g. the
 *   marbles spectators have named). They are taken first — in catalog order,
 *   keeping only enabled skin types — and the rest is filled from the catalog.
 *   If there are more preferred looks than `count`, the first `count` (in
 *   catalog order) are used. Empty => exactly the plain first-N catalog roster.
 */
export function createRoster(config: GameConfig, seed: number, preferredKeys: readonly string[] = []): MarbleProfile[] {
  const count = Math.max(0, Math.floor(config.marbles.count));
  const enabled = SKIN_ORDER.filter((t) => config.marbles.skins[t]);
  const entries = preferredKeys.length ? pickWithPreferred(enabled, count, preferredKeys) : skinCatalog(enabled, count);
  const rng = new Rng((seed >>> 0) ^ 0x51ed270b);
  rng.shuffle(entries);
  return entries.map((e, i) => ({
    id: i,
    name: e.name,
    key: e.key,
    skin: { type: e.skin.type, colors: [...e.skin.colors] },
  }));
}

function pickWithPreferred(enabled: SkinType[], count: number, preferredKeys: readonly string[]): CatalogEntry[] {
  const wanted = new Set(preferredKeys);
  const types = enabled.length ? enabled : (['solid'] as SkinType[]);
  // catalog order of the mixed roster first, then any wanted look further down its type list
  const mixed = skinCatalog(types, 200);
  const found: CatalogEntry[] = mixed.filter((e) => wanted.has(e.key));
  const seen = new Set(found.map((e) => e.key));
  for (const t of types) {
    for (const e of catalogForType(t)) {
      if (wanted.has(e.key) && !seen.has(e.key)) {
        found.push(e);
        seen.add(e.key);
      }
    }
  }
  const out = found.slice(0, count);
  const used = new Set(out.map((e) => e.key));
  for (const e of skinCatalog(types, count + out.length)) {
    if (out.length >= count) break;
    if (!used.has(e.key)) {
      out.push(e);
      used.add(e.key);
    }
  }
  return out;
}
