import type { MemberLocation, PresenceState, Profile } from './types';

function accuracyText(accuracy: number | null | undefined): string {
  return accuracy == null ? '' : ` (±${Math.round(accuracy)} m)`;
}

/** Full wording for popups and screen readers. Null while the check has not finished. */
export function placeLabel(state: PresenceState | undefined, accuracy?: number | null): string | null {
  switch (state) {
    case 'inside':
      return 'Inside a building';
    case 'indoors':
      return 'Probably inside a building';
    case 'around':
      return 'Outside, next to a building';
    case 'outside':
      return 'Outside';
    case 'imprecise':
      return `Location too imprecise to tell${accuracyText(accuracy)}`;
    case 'unknown':
      return "Couldn't load the buildings here";
    default:
      return null;
  }
}

export function timeAgo(iso: string, now: number): string {
  const seconds = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.floor(hours / 24)} d ago`;
}

export function isStale(iso: string, now: number, minutes = 30): boolean {
  return now - new Date(iso).getTime() > minutes * 60_000;
}

type Point = { latitude: number; longitude: number };

export function distanceKm(a: Point, b: Point): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLon = toRad(b.longitude - a.longitude);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLon / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)));
}

export function formatDistance(km: number): string {
  if (km < 0.1) return 'nearby';
  if (km < 1) return `${Math.round(km * 100) * 10} m away`;
  if (km < 10) return `${km.toFixed(1)} km away`;
  return `${Math.round(km)} km away`;
}

export function memberStatus(
  profile: Profile,
  loc: MemberLocation | undefined,
  now: number,
  fromMe?: Point,
): string {
  if (!profile.sharing_enabled) return 'Sharing paused';
  if (!loc) return 'No location yet';
  const updated = `Updated ${timeAgo(loc.updated_at, now)}`;
  return fromMe ? `${updated} · ${formatDistance(distanceKm(fromMe, loc))}` : updated;
}

export function initial(name: string): string {
  return (name.trim()[0] ?? '?').toUpperCase();
}
