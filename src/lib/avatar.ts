import { createAvatar } from '@dicebear/core';
import * as lorelei from '@dicebear/lorelei';

/**
 * A person's chosen icon: the options of DiceBear's "Lorelei" style (artwork by Lisa Wischofsky, CC0; code MIT).
 * Only these options are stored, a few hundred bytes; the picture is drawn from them on every screen, so it is
 * always crisp and other people's phones need nothing but this object.
 */
export type AvatarConfig = {
  hair: string;
  hairColor: string;
  head: string;
  skinColor: string;
  eyes: string;
  eyebrows: string;
  nose: string;
  mouth: string;
  glasses: string | null;
  beard: string | null;
  earrings: string | null;
  freckles: boolean;
  backgroundColor: string;
};

const options = lorelei.schema.properties as unknown as Record<string, { items?: { enum?: string[] } }>;
const variants = (key: string): string[] => [...(options[key]?.items?.enum ?? [])];

const byNumber = (a: string, b: string) => Number(a.replace(/\D/g, '')) - Number(b.replace(/\D/g, ''));

export const AVATAR_PARTS = {
  hair: variants('hair').sort(byNumber),
  head: variants('head').sort(byNumber),
  eyes: variants('eyes').sort(byNumber),
  eyebrows: variants('eyebrows').sort(byNumber),
  nose: variants('nose').sort(byNumber),
  mouth: variants('mouth'),
  glasses: variants('glasses').sort(byNumber),
  beard: variants('beard').sort(byNumber),
  earrings: variants('earrings').sort(byNumber),
} as const;

export const SKIN_COLORS = ['fde3d0', 'f6cfb0', 'e6b088', 'c98d5e', 'a56a3f', '84512c', '5e3a22', '3f2616'] as const;
export const HAIR_COLORS = [
  '0d0d0d',
  '2b1a12',
  '5a3825',
  'a55728',
  'd9b26f',
  'c1440e',
  'b3b3b3',
  'f2f2f2',
  '3b6fd8',
  '7c3aed',
] as const;
export const BACKGROUND_COLORS = [
  'fde68a',
  'fca5a5',
  'fdba74',
  'a7f3d0',
  '99f6e4',
  'bfdbfe',
  'c7d2fe',
  'ddd6fe',
  'fbcfe8',
  'd4d4d8',
] as const;

const FALLBACK: AvatarConfig = {
  hair: 'variant01',
  hairColor: HAIR_COLORS[1],
  head: 'variant01',
  skinColor: SKIN_COLORS[3],
  eyes: 'variant01',
  eyebrows: 'variant01',
  nose: 'variant01',
  mouth: 'happy01',
  glasses: null,
  beard: null,
  earrings: null,
  freckles: false,
  backgroundColor: BACKGROUND_COLORS[5],
};

/** A small seeded generator so "surprise me" and the demo member are repeatable when given a seed. */
function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s >>>= 0;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 4294967296;
  };
}

export function randomAvatar(seed: number = Math.floor(Math.random() * 2 ** 31)): AvatarConfig {
  const next = rng(seed);
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(next() * list.length)] ?? list[0];
  const maybe = (list: readonly string[], chance: number) => (next() < chance ? pick(list) : null);
  return {
    hair: pick(AVATAR_PARTS.hair),
    hairColor: pick(HAIR_COLORS.slice(0, 8)),
    head: pick(AVATAR_PARTS.head),
    skinColor: pick(SKIN_COLORS),
    eyes: pick(AVATAR_PARTS.eyes),
    eyebrows: pick(AVATAR_PARTS.eyebrows),
    nose: pick(AVATAR_PARTS.nose),
    mouth: pick(AVATAR_PARTS.mouth),
    glasses: maybe(AVATAR_PARTS.glasses, 0.2),
    beard: maybe(AVATAR_PARTS.beard, 0.12),
    earrings: maybe(AVATAR_PARTS.earrings, 0.2),
    freckles: next() < 0.15,
    backgroundColor: pick(BACKGROUND_COLORS),
  };
}

/** Reads a stored value, dropping anything that is not a valid part so a bad row never breaks a screen. */
export function parseAvatar(value: unknown): AvatarConfig | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const part = (key: keyof typeof AVATAR_PARTS, fallback: string) =>
    typeof v[key] === 'string' && (AVATAR_PARTS[key] as readonly string[]).includes(v[key] as string)
      ? (v[key] as string)
      : fallback;
  const optional = (key: 'glasses' | 'beard' | 'earrings') =>
    typeof v[key] === 'string' && (AVATAR_PARTS[key] as readonly string[]).includes(v[key] as string)
      ? (v[key] as string)
      : null;
  const color = (key: 'hairColor' | 'skinColor' | 'backgroundColor', fallback: string) =>
    typeof v[key] === 'string' && /^[0-9a-f]{6}$/i.test(v[key] as string) ? (v[key] as string).toLowerCase() : fallback;
  return {
    hair: part('hair', FALLBACK.hair),
    hairColor: color('hairColor', FALLBACK.hairColor),
    head: part('head', FALLBACK.head),
    skinColor: color('skinColor', FALLBACK.skinColor),
    eyes: part('eyes', FALLBACK.eyes),
    eyebrows: part('eyebrows', FALLBACK.eyebrows),
    nose: part('nose', FALLBACK.nose),
    mouth: part('mouth', FALLBACK.mouth),
    glasses: optional('glasses'),
    beard: optional('beard'),
    earrings: optional('earrings'),
    freckles: v.freckles === true,
    backgroundColor: color('backgroundColor', FALLBACK.backgroundColor),
  };
}

type StyleOptions = NonNullable<Parameters<typeof createAvatar<typeof lorelei>>[1]>;

const cache = new Map<string, string>();

/** The avatar as an SVG document (a circle, no embedded metadata). */
export function avatarSvg(config: AvatarConfig): string {
  const key = JSON.stringify(config);
  const hit = cache.get(key);
  if (hit) return hit;
  // Every part was checked against the style's own lists when it was read (parseAvatar), hence the cast.
  const styleOptions = {
    seed: 'family-circle',
    size: 256,
    radius: 50,
    backgroundColor: [config.backgroundColor],
    hair: [config.hair],
    hairColor: [config.hairColor],
    head: [config.head],
    skinColor: [config.skinColor],
    eyes: [config.eyes],
    eyesColor: ['1f1f1f'],
    eyebrows: [config.eyebrows],
    eyebrowsColor: [config.hairColor],
    nose: [config.nose],
    mouth: [config.mouth],
    glasses: [config.glasses ?? 'variant01'],
    glassesProbability: config.glasses ? 100 : 0,
    beard: [config.beard ?? 'variant01'],
    beardProbability: config.beard ? 100 : 0,
    earrings: [config.earrings ?? 'variant01'],
    earringsProbability: config.earrings ? 100 : 0,
    freckles: ['variant01'],
    frecklesProbability: config.freckles ? 100 : 0,
    hairAccessoriesProbability: 0,
  } as StyleOptions;
  const svg = createAvatar(lorelei, styleOptions)
    .toString()
    .replace(/<metadata[\s\S]*?<\/metadata>/, '');
  if (cache.size > 200) cache.clear();
  cache.set(key, svg);
  return svg;
}

/** For places that take an image address, such as the map's markers. */
export function avatarDataUri(config: AvatarConfig): string {
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(avatarSvg(config));
}
