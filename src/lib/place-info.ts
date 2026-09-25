// Details about the place a person is at: a Google Maps link, the building's name, height and address from
// OpenStreetMap, and a real photo of it from Wikipedia / Wikimedia Commons when the building has one.
// No API keys are involved. OSM's Nominatim asks for at most one request a second and an identifying
// User-Agent, so calls are queued, cached, and only made for the person whose card is open.

export type PlacePhoto = {
  url: string;
  /** Photographer and licence, e.g. "Vanbasten 23 · CC BY-SA 3.0". */
  credit: string;
  /** Page to open for the full credit. */
  pageUrl: string | null;
};

export type PlaceInfo = {
  /** The building's own name, when OpenStreetMap has one. */
  name: string | null;
  /** e.g. "Main Street, Marshalltown, Johannesburg 2001". */
  address: string | null;
  levels: number | null;
  heightM: number | null;
  photo: PlacePhoto | null;
};

export type PlaceQuery = {
  lat: number;
  lng: number;
  /** The building's id in the map tiles, when the person is in or next to one. */
  tileId: number | null;
};

const NOMINATIM = 'https://nominatim.openstreetmap.org';
const HEADERS = { 'User-Agent': 'FamilyCircle/1.0 (family location sharing app)' };
const TIMEOUT_MS = 8000;

export function googleMapsUrl(lat: number, lng: number): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const onAbort = () => controller.abort();
  signal?.addEventListener('abort', onAbort);
  try {
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    if (!res.ok) throw new Error(`${res.status} from ${new URL(url).host}`);
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// Nominatim's usage policy: one request per second at most.
let lastNominatimAt = 0;
let nominatimQueue: Promise<unknown> = Promise.resolve();

function nominatim<T>(path: string, signal?: AbortSignal): Promise<T> {
  const run = nominatimQueue.then(async () => {
    const wait = lastNominatimAt + 1100 - Date.now();
    if (wait > 0) await sleep(wait);
    lastNominatimAt = Date.now();
    return getJson<T>(`${NOMINATIM}${path}`, signal);
  });
  nominatimQueue = run.catch(() => undefined);
  return run;
}

type NominatimPlace = {
  category?: string;
  name?: string;
  address?: Record<string, string>;
  extratags?: Record<string, string>;
  error?: string;
};

export function addressLine(address: Record<string, string> | undefined): string | null {
  if (!address) return null;
  const street = [address.house_number, address.road].filter(Boolean).join(' ');
  const area = address.suburb ?? address.neighbourhood ?? address.quarter ?? null;
  const city = address.city ?? address.town ?? address.village ?? address.municipality ?? null;
  const cityLine = city && address.postcode ? `${city} ${address.postcode}` : city;
  const parts = [street || null, area, cityLine].filter((part): part is string => !!part);
  return parts.length ? parts.join(', ') : null;
}

function plainText(html: string | undefined): string {
  return (html ?? '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .trim();
}

const isHttps = (url: string | undefined): url is string => !!url && url.startsWith('https://');

type CommonsMeta = { Artist?: { value?: string }; LicenseShortName?: { value?: string } };

function creditFrom(meta: CommonsMeta | undefined): string {
  const artist = plainText(meta?.Artist?.value).slice(0, 60);
  const licence = plainText(meta?.LicenseShortName?.value);
  return [artist, licence].filter(Boolean).join(' · ') || 'Wikimedia Commons';
}

const commonsApi = (params: Record<string, string>) =>
  `https://commons.wikimedia.org/w/api.php?${new URLSearchParams({ format: 'json', formatversion: '2', ...params })}`;

/** The photo on a building's Wikipedia article. `tag` looks like "en:Absa Tower". */
async function wikipediaPhoto(tag: string, signal?: AbortSignal): Promise<PlacePhoto | null> {
  const separator = tag.indexOf(':');
  if (separator < 1) return null;
  const lang = tag.slice(0, separator);
  const title = tag.slice(separator + 1);
  if (!/^[a-z-]{2,10}$/.test(lang)) return null;

  const page = await getJson<{
    query?: { pages?: { fullurl?: string; pageimage?: string; thumbnail?: { source?: string } }[] };
  }>(
    `https://${lang}.wikipedia.org/w/api.php?${new URLSearchParams({
      action: 'query', format: 'json', formatversion: '2', prop: 'pageimages|info', piprop: 'thumbnail|name',
      pithumbsize: '800', inprop: 'url', redirects: '1', titles: title,
    })}`,
    signal,
  );
  const found = page.query?.pages?.[0];
  if (!found || !isHttps(found.thumbnail?.source)) return null;

  let credit = 'Wikipedia';
  if (found.pageimage) {
    const file = await getJson<{ query?: { pages?: { imageinfo?: { extmetadata?: CommonsMeta }[] }[] } }>(
      commonsApi({ action: 'query', prop: 'imageinfo', iiprop: 'extmetadata', titles: `File:${found.pageimage}` }),
      signal,
    ).catch(() => null);
    credit = creditFrom(file?.query?.pages?.[0]?.imageinfo?.[0]?.extmetadata);
  }
  return { url: found.thumbnail.source, credit, pageUrl: isHttps(found.fullurl) ? found.fullurl : null };
}

/** A photo from Wikimedia Commons: a file, or the first file of a category. */
async function commonsPhoto(tag: string, signal?: AbortSignal): Promise<PlacePhoto | null> {
  const isCategory = tag.startsWith('Category:');
  if (!isCategory && !tag.startsWith('File:')) return null;
  const params: Record<string, string> = isCategory
    ? { action: 'query', generator: 'categorymembers', gcmtitle: tag, gcmtype: 'file', gcmlimit: '1', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '800' }
    : { action: 'query', prop: 'imageinfo', iiprop: 'url|extmetadata', iiurlwidth: '800', titles: tag };
  const res = await getJson<{
    query?: { pages?: { title?: string; imageinfo?: { thumburl?: string; extmetadata?: CommonsMeta }[] }[] };
  }>(commonsApi(params), signal);
  const file = res.query?.pages?.[0];
  const info = file?.imageinfo?.[0];
  if (!file || !isHttps(info?.thumburl)) return null;
  return {
    url: info.thumburl,
    credit: creditFrom(info.extmetadata),
    pageUrl: file.title ? `https://commons.wikimedia.org/wiki/${encodeURIComponent(file.title.replace(/ /g, '_'))}` : null,
  };
}

const cache = new Map<string, Promise<PlaceInfo>>();

const empty = (): PlaceInfo => ({ name: null, address: null, levels: null, heightM: null, photo: null });

async function load(query: PlaceQuery, signal?: AbortSignal): Promise<PlaceInfo> {
  let place: NominatimPlace | undefined;

  if (query.tileId !== null) {
    // The map's building ids are OpenStreetMap ids times ten plus a type digit. Only named or addressed
    // buildings are in Nominatim's index, so plain ones simply return nothing here.
    const base = Math.floor(query.tileId / 10);
    const found = await nominatim<NominatimPlace[]>(
      `/lookup?osm_ids=W${base},R${base}&format=jsonv2&addressdetails=1&extratags=1`,
      signal,
    ).catch(() => []);
    place = found[0];
  }
  if (!place) {
    const reverse = await nominatim<NominatimPlace>(
      `/reverse?format=jsonv2&lat=${query.lat}&lon=${query.lng}&zoom=18&addressdetails=1&extratags=1`,
      signal,
    ).catch(() => undefined);
    place = reverse && !reverse.error ? reverse : undefined;
  }
  if (!place) return empty();

  const tags = place.extratags ?? {};
  const levels = Number.parseInt(tags['building:levels'] ?? '', 10);
  const height = Number.parseFloat(tags.height ?? '');

  let photo: PlacePhoto | null = null;
  try {
    if (tags.wikipedia) photo = await wikipediaPhoto(tags.wikipedia, signal);
    if (!photo && tags.wikimedia_commons) photo = await commonsPhoto(tags.wikimedia_commons, signal);
  } catch {
    photo = null;
  }

  return {
    // A road or shop returned for a street position is not the building's name.
    name: place.category === 'building' && place.name ? place.name : null,
    address: addressLine(place.address),
    levels: Number.isFinite(levels) && levels > 0 ? levels : null,
    heightM: Number.isFinite(height) && height > 0 ? height : null,
    photo,
  };
}

/** Never rejects: a failed lookup gives an empty result, so the card still shows the coordinates. */
export function fetchPlaceInfo(query: PlaceQuery, signal?: AbortSignal): Promise<PlaceInfo> {
  const key = query.tileId !== null ? `t${query.tileId}` : `c${query.lat.toFixed(4)},${query.lng.toFixed(4)}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const pending = load(query, signal).catch(() => empty());
  cache.set(key, pending);
  // Do not keep a failed lookup: try again next time.
  void pending.then((info) => {
    if (!info.name && !info.address) cache.delete(key);
  });
  return pending;
}
