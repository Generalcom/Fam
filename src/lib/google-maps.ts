// Google Maps pictures for the location card: a map view with a pin, and Street View. Google only serves
// these to requests that carry an API key, so nothing is shown from Google until
// EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is set (see README). The key ends up inside the app, so it must be
// restricted in the Google Cloud console to the two APIs below (and given a low quota and budget alert).
//
// APIs to enable: "Maps Static API" and "Street View Static API".

export const GOOGLE_MAPS_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY ?? '';
export const googleMapsConfigured = GOOGLE_MAPS_KEY.length > 0;

type Size = { width: number; height: number };
const DEFAULT_SIZE: Size = { width: 640, height: 360 };

const point = (lat: number, lng: number) => `${lat.toFixed(6)},${lng.toFixed(6)}`;

/** A satellite-with-labels map centred on the place, with a red pin on it. */
export function staticMapUrl(
  lat: number,
  lng: number,
  options: { zoom?: number; size?: Size; key?: string } = {},
): string {
  const size = options.size ?? DEFAULT_SIZE;
  const params = new URLSearchParams({
    center: point(lat, lng),
    zoom: String(options.zoom ?? 18),
    size: `${size.width}x${size.height}`,
    scale: '2',
    maptype: 'hybrid',
    markers: `color:red|${point(lat, lng)}`,
    key: options.key ?? GOOGLE_MAPS_KEY,
  });
  return `https://maps.googleapis.com/maps/api/staticmap?${params}`;
}

/**
 * A street-level photo looking at the place from the nearest road. `return_error_codes` makes Google answer
 * with an error, not a grey "no imagery" picture, where there is none, and `source=outdoor` skips indoor
 * panoramas.
 */
export function streetViewUrl(
  lat: number,
  lng: number,
  options: { size?: Size; key?: string } = {},
): string {
  const size = options.size ?? DEFAULT_SIZE;
  const params = new URLSearchParams({
    location: point(lat, lng),
    size: `${size.width}x${size.height}`,
    fov: '90',
    source: 'outdoor',
    return_error_codes: 'true',
    key: options.key ?? GOOGLE_MAPS_KEY,
  });
  return `https://maps.googleapis.com/maps/api/streetview?${params}`;
}

/**
 * Whether Street View has imagery near the place. Google's metadata endpoint is free and is meant for exactly
 * this check, so a picture is only requested when there is one. Never throws: any failure means "no".
 */
export async function streetViewAvailable(
  lat: number,
  lng: number,
  signal?: AbortSignal,
  key: string = GOOGLE_MAPS_KEY,
): Promise<boolean> {
  if (!key) return false;
  try {
    const params = new URLSearchParams({ location: point(lat, lng), source: 'outdoor', key });
    const res = await fetch(`https://maps.googleapis.com/maps/api/streetview/metadata?${params}`, { signal });
    if (!res.ok) return false;
    const body = (await res.json()) as { status?: string };
    return body.status === 'OK';
  } catch {
    return false;
  }
}
