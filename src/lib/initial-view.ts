import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';

import { TIMEZONE_CITIES } from '@/constants/timezones';

export type InitialView = {
  lat: number;
  lng: number;
  zoom: number;
  source: 'last-known' | 'saved' | 'timezone' | 'fix';
};

/** Street level: about a few blocks across. */
export const NEAR_ZOOM = 15;
/** Metro area, used when only the phone's time zone is known. */
const CITY_ZOOM = 10;

const KEY = 'family-circle:last-position';

function isCoord(v: unknown): v is { lat: number; lng: number } {
  const c = v as { lat?: unknown; lng?: unknown } | null;
  return (
    !!c &&
    typeof c.lat === 'number' &&
    typeof c.lng === 'number' &&
    Math.abs(c.lat) <= 90 &&
    Math.abs(c.lng) <= 180
  );
}

/** The time zone is a city ("Africa/Johannesburg"), so it says roughly where the phone is with no permission and no network. */
export function timezoneView(): InitialView | null {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const city = zone ? TIMEZONE_CITIES[zone] : undefined;
    return city ? { lat: city[0], lng: city[1], zoom: CITY_ZOOM, source: 'timezone' } : null;
  } catch {
    return null;
  }
}

async function savedView(): Promise<InitialView | null> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const v: unknown = raw ? JSON.parse(raw) : null;
    return isCoord(v) ? { lat: v.lat, lng: v.lng, zoom: NEAR_ZOOM, source: 'saved' } : null;
  } catch {
    return null;
  }
}

async function lastKnownView(): Promise<InitialView | null> {
  try {
    const permission = await Location.getForegroundPermissionsAsync();
    if (permission.status !== 'granted') return null;
    const pos = await Location.getLastKnownPositionAsync();
    return pos
      ? { lat: pos.coords.latitude, lng: pos.coords.longitude, zoom: NEAR_ZOOM, source: 'last-known' }
      : null;
  } catch {
    return null;
  }
}

function within<T>(promise: Promise<T | null>, ms: number): Promise<T | null> {
  return Promise.race([promise, new Promise<null>((resolve) => setTimeout(() => resolve(null), ms))]);
}

/**
 * Where the map should start, found in milliseconds and without waiting for GPS: the phone's cached last
 * position, then the position this app saved, then the city of the phone's time zone. Null means none is
 * known, and the caller waits for the first fix rather than showing a world map.
 */
export async function loadInitialView(): Promise<InitialView | null> {
  const [lastKnown, saved] = await Promise.all([within(lastKnownView(), 300), within(savedView(), 300)]);
  return lastKnown ?? saved ?? timezoneView();
}

let lastSavedAt = 0;

/** Remembers where this phone was, on this phone only, so the next launch opens right there. */
export function rememberPosition(lat: number, lng: number): void {
  const now = Date.now();
  if (now - lastSavedAt < 30_000) return;
  lastSavedAt = now;
  void AsyncStorage.setItem(KEY, JSON.stringify({ lat, lng })).catch(() => {});
}

export async function forgetPosition(): Promise<void> {
  lastSavedAt = 0;
  await AsyncStorage.removeItem(KEY).catch(() => {});
}
