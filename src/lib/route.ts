export type LatLng = { lat: number; lng: number };

/** A driving route: the line to draw, how far it is by road and how long it takes. */
export type Route = { coordinates: [number, number][]; distanceM: number; durationS: number };

/**
 * The public OSRM demo server. It is free and needs no key, but it is for light use only and has no guarantees:
 * before a real launch, point this at your own OSRM / Valhalla server or a paid routing service. It is sent the two
 * places the route joins, so this is also a reason to host your own.
 */
const ROUTING_URL = 'https://router.project-osrm.org/route/v1/driving';

const MAX_POINTS = 400;

/** Keeps the start, the end and an even spread between, so a long route stays light to send to the map. */
export function thin(points: [number, number][], max: number = MAX_POINTS): [number, number][] {
  if (points.length <= max) return points;
  const out: [number, number][] = [];
  const step = (points.length - 1) / (max - 1);
  for (let i = 0; i < max; i++) out.push(points[Math.round(i * step)]);
  return out;
}

/** The route by road between two places, or null when there is none or the service cannot be reached. */
export async function fetchRoute(from: LatLng, to: LatLng, signal?: AbortSignal): Promise<Route | null> {
  try {
    const url = `${ROUTING_URL}/${from.lng.toFixed(5)},${from.lat.toFixed(5)};${to.lng.toFixed(5)},${to.lat.toFixed(5)}?overview=full&geometries=geojson`;
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      code?: string;
      routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] } }[];
    };
    const best = body.code === 'Ok' ? body.routes?.[0] : undefined;
    if (!best || !Array.isArray(best.geometry?.coordinates) || best.geometry.coordinates.length < 2) return null;
    return { coordinates: thin(best.geometry.coordinates), distanceM: best.distance, durationS: best.duration };
  } catch {
    return null;
  }
}

/** "9 min", "1 h 5 min", "less than a minute". */
export function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 1) return 'less than a minute';
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/** "850 m" under a kilometre, otherwise "5.2 km" (whole kilometres from 100 km). */
export function formatRouteDistance(metres: number): string {
  if (metres < 1000) return `${Math.round(metres / 10) * 10} m`;
  const km = metres / 1000;
  return km >= 100 ? `${Math.round(km)} km` : `${km.toFixed(1)} km`;
}

/** Opens turn-by-turn directions in Google Maps (or the phone's default maps app) from one place to another. */
export function directionsUrl(from: LatLng, to: LatLng): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=driving`;
}
