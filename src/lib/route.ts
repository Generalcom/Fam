export type LatLng = { lat: number; lng: number };

export type TravelMode = 'drive' | 'walk';

/** One instruction along the way, from the routing service's steps. */
export type RouteStep = {
  /** Where the manoeuvre happens, [longitude, latitude]. */
  location: [number, number];
  type: string;
  modifier: string | null;
  /** The road or path taken from here, if it has a name or number. */
  name: string | null;
  /** The roundabout exit to take, when there is one. */
  exit: number | null;
  /** Compass heading just after the manoeuvre, 0 to 359. */
  bearingAfter: number;
};

/** A route by road or path: the line to draw, how far it is, how long it takes, and the turns along it. */
export type Route = {
  mode: TravelMode;
  coordinates: [number, number][];
  distanceM: number;
  durationS: number;
  steps: RouteStep[];
};

/**
 * FOSSGIS's public OSRM servers (the ones behind openstreetmap.org's directions): driving on roads, and walking on
 * footpaths, pavements and steps. Free and keyless, but for light use only and without guarantees: before a real
 * launch point these at your own OSRM / Valhalla server or a paid routing service. They are sent the two places the
 * route joins, which is another reason to host your own.
 */
const ROUTING_URLS: Record<TravelMode, string> = {
  drive: 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  walk: 'https://routing.openstreetmap.de/routed-foot/route/v1/driving',
};

/** Below this straight-line distance the route starts on foot. */
export const WALK_UNDER_M = 1200;

/** The line is simplified to within this many metres of the road, which keeps every bend but drops needless points. */
const SIMPLIFY_M = 2;
const MAX_POINTS = 2500;

export function metresBetween(a: LatLng, b: LatLng): number {
  const dy = (a.lat - b.lat) * 110_540;
  const dx = (a.lng - b.lng) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dx, dy);
}

/**
 * Douglas-Peucker simplification in metres: drops points that lie within `tolerance` of the line through their
 * neighbours, so straight stretches become a single segment and every corner survives. (Keeping every n-th point
 * instead cuts corners on a long route, and the line then runs straight across blocks.)
 */
export function simplify(points: [number, number][], tolerance: number = SIMPLIFY_M): [number, number][] {
  if (points.length <= 2) return points;
  const lat0 = points[0][1] * (Math.PI / 180);
  const kx = 111_320 * Math.cos(lat0);
  const ky = 110_540;
  const xy = points.map(([lng, lat]) => [lng * kx, lat * ky]);
  const keep = new Uint8Array(points.length);
  keep[0] = keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  const tol2 = tolerance * tolerance;
  while (stack.length) {
    const [first, last] = stack.pop()!;
    const [ax, ay] = xy[first];
    const [bx, by] = xy[last];
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let worst = -1;
    let worstD = tol2;
    for (let i = first + 1; i < last; i++) {
      const [px, py] = xy[i];
      const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
      const ex = ax + t * dx - px;
      const ey = ay + t * dy - py;
      const d = ex * ex + ey * ey;
      if (d > worstD) {
        worstD = d;
        worst = i;
      }
    }
    if (worst >= 0) {
      keep[worst] = 1;
      stack.push([first, worst], [worst, last]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}

/** Simplifies more coarsely only if a very long route still has too many points to send to the map. */
function lighten(points: [number, number][]): [number, number][] {
  let tolerance = SIMPLIFY_M;
  let out = simplify(points, tolerance);
  while (out.length > MAX_POINTS) {
    tolerance *= 2;
    out = simplify(points, tolerance);
  }
  return out;
}

type OsrmStep = {
  name?: string;
  ref?: string;
  maneuver: { type: string; modifier?: string; location: [number, number]; exit?: number; bearing_after?: number };
};

/** The route by road (or on foot) between two places, or null when there is none or the service cannot be reached. */
export async function fetchRoute(from: LatLng, to: LatLng, mode: TravelMode, signal?: AbortSignal): Promise<Route | null> {
  try {
    const url = `${ROUTING_URLS[mode]}/${from.lng.toFixed(6)},${from.lat.toFixed(6)};${to.lng.toFixed(6)},${to.lat.toFixed(6)}?overview=full&geometries=geojson&steps=true`;
    const res = await fetch(url, { signal, headers: { Accept: 'application/json' } });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      code?: string;
      routes?: { distance: number; duration: number; geometry: { coordinates: [number, number][] }; legs?: { steps?: OsrmStep[] }[] }[];
    };
    const best = body.code === 'Ok' ? body.routes?.[0] : undefined;
    if (!best || !Array.isArray(best.geometry?.coordinates) || best.geometry.coordinates.length < 2) return null;
    const steps: RouteStep[] = (best.legs?.[0]?.steps ?? []).map((s) => ({
      location: s.maneuver.location,
      type: s.maneuver.type,
      modifier: s.maneuver.modifier ?? null,
      name: s.name || s.ref || null,
      exit: s.maneuver.exit ?? null,
      bearingAfter: s.maneuver.bearing_after ?? 0,
    }));
    return { mode, coordinates: lighten(best.geometry.coordinates), distanceM: best.distance, durationS: best.duration, steps };
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
export function directionsUrl(from: LatLng, to: LatLng, mode: TravelMode = 'drive'): string {
  return `https://www.google.com/maps/dir/?api=1&origin=${from.lat},${from.lng}&destination=${to.lat},${to.lng}&travelmode=${mode === 'walk' ? 'walking' : 'driving'}`;
}
