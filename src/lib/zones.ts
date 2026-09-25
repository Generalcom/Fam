import type { SafetyZone, ZoneLevel } from './types';

export const ZONE_COLORS: Record<ZoneLevel, string> = { red: '#DC2626', aware: '#F59E0B' };
export const ZONE_NAMES: Record<ZoneLevel, string> = { red: 'red zone', aware: 'be-aware zone' };

export const RADIUS_CHOICES_M = [100, 250, 500, 1000, 2000] as const;

export type ZoneHit = {
  zone: SafetyZone;
  distanceM: number;
  /** True when the position is inside the circle; false when only its uncertainty reaches it. */
  inside: boolean;
};

export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371000 * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * The zones a position is in, or is close enough to that its GPS uncertainty could put it inside. Being
 * "near" a zone still counts, because a reading is often 20-50 m off. Most serious first: red before
 * be-aware, inside before near, then nearest.
 */
export function zonesAt(zones: SafetyZone[], lat: number, lng: number, accuracy: number | null): ZoneHit[] {
  const slack = Math.min(300, Math.max(30, accuracy ?? 30));
  return zones
    .map((zone) => {
      const d = distanceM(lat, lng, zone.latitude, zone.longitude);
      return { zone, distanceM: d, inside: d <= zone.radius_m };
    })
    .filter((hit) => hit.inside || hit.distanceM <= hit.zone.radius_m + slack)
    .sort(
      (a, b) =>
        (a.zone.level === 'red' ? 0 : 1) - (b.zone.level === 'red' ? 0 : 1) ||
        Number(b.inside) - Number(a.inside) ||
        a.distanceM - b.distanceM,
    );
}

/** The most serious level among the hits, or null when there are none. */
export function alertLevel(hits: ZoneHit[]): ZoneLevel | null {
  if (hits.some((hit) => hit.zone.level === 'red')) return 'red';
  return hits.length > 0 ? 'aware' : null;
}

/** e.g. "In a red zone: Hillbrow" or "Near a be-aware zone: Main Street at night". */
export function describeHit(hit: ZoneHit): string {
  return `${hit.inside ? 'In' : 'Near'} a ${ZONE_NAMES[hit.zone.level]}: ${hit.zone.name}`;
}

/** A sentence for a banner: "Thandi is in a red zone: Hillbrow" / "You are near a be-aware zone: Main Street". */
export function alertText(name: string, isMe: boolean, hit: ZoneHit): string {
  const who = isMe ? 'You are' : `${name} is`;
  return `${who} ${hit.inside ? 'in' : 'near'} a ${ZONE_NAMES[hit.zone.level]}: ${hit.zone.name}`;
}

/** The kind of zone people usually add, so the sheet can open on a sensible radius. */
export const DEFAULT_RADIUS_M = 500;
