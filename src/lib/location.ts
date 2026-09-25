import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';

import { supabase } from './supabase';
import type { MemberLocation } from './types';

export const LOCATION_TASK = 'family-circle-background-location';

export type SharingPermission = 'background' | 'foreground' | 'denied' | 'undetermined';

const MIN_PUSH_INTERVAL_MS = 4_000;
let lastPushAt = 0;

let pushEnabled = true;

/** Turned off while sharing is paused so a send already in flight can't put a location back. */
export function setPushEnabled(enabled: boolean): void {
  pushEnabled = enabled;
}

export async function pushLocation(loc: Location.LocationObject): Promise<void> {
  if (!pushEnabled) return;
  const now = Date.now();
  if (now - lastPushAt < MIN_PUSH_INTERVAL_MS) return;
  lastPushAt = now;

  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;

  await supabase.from('locations').upsert({
    user_id: userId,
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracy: loc.coords.accuracy,
    speed: loc.coords.speed,
    updated_at: new Date(loc.timestamp).toISOString(),
  });
}

// Must be registered at module scope so the OS can wake the app headlessly.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK,
  async ({ data, error }) => {
    if (error || !data?.locations?.length) return;
    await pushLocation(data.locations[data.locations.length - 1]);
  },
);

export async function getSharingPermission(): Promise<SharingPermission> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (fg.status === 'undetermined') return 'undetermined';
  if (fg.status !== 'granted') return 'denied';
  try {
    const bg = await Location.getBackgroundPermissionsAsync();
    if (bg.status === 'granted') return 'background';
  } catch {
    // Background permission is unavailable in Expo Go.
  }
  return 'foreground';
}

/** Shows the system prompt for "while using the app" access; the background upgrade is opt-in. */
export async function requestSharingPermission(includeBackground = false): Promise<SharingPermission> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (fg.status !== 'granted') return fg.status === 'undetermined' ? 'undetermined' : 'denied';
  if (includeBackground) {
    try {
      await Location.requestBackgroundPermissionsAsync();
    } catch {
      // Background permission is unavailable in Expo Go.
    }
  }
  return getSharingPermission();
}

export async function startBackgroundUpdates(): Promise<boolean> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) return true;
    await Location.startLocationUpdatesAsync(LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: 60_000,
      distanceInterval: 50,
      showsBackgroundLocationIndicator: true,
      pausesUpdatesAutomatically: true,
      activityType: Location.ActivityType.Other,
      foregroundService: {
        notificationTitle: 'Family Circle',
        notificationBody: 'Sharing your location with your family circle',
      },
    });
    return true;
  } catch {
    return false;
  }
}

export async function stopBackgroundUpdates(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(LOCATION_TASK);
    }
  } catch {
    // Nothing to stop.
  }
}

/**
 * High accuracy (GPS) because telling inside from outside a building needs a fix within a few metres.
 * No distance filter: with one, a phone that is standing still stops reporting altogether.
 * `push` is false while sharing is paused, so the fix is only used on this phone.
 */
export function watchForeground(
  onFix?: (loc: Location.LocationObject) => void,
  push = true,
): Promise<Location.LocationSubscription> {
  return Location.watchPositionAsync(
    { accuracy: Location.Accuracy.High, timeInterval: 5_000, distanceInterval: 0 },
    (loc) => {
      if (__DEV__) {
        const c = loc.coords;
        console.log(
          '[fix]',
          JSON.stringify({
            lat: c.latitude,
            lng: c.longitude,
            acc: c.accuracy,
            alt: c.altitude,
            altAcc: c.altitudeAccuracy,
            speed: c.speed,
            provider: (loc as { mocked?: boolean }).mocked ? 'mocked' : 'real',
          }),
        );
      }
      onFix?.(loc);
      if (push) void pushLocation(loc);
    },
  );
}

export function toMemberLocation(userId: string, loc: Location.LocationObject): MemberLocation {
  return {
    user_id: userId,
    latitude: loc.coords.latitude,
    longitude: loc.coords.longitude,
    accuracy: loc.coords.accuracy,
    speed: loc.coords.speed,
    updated_at: new Date(loc.timestamp).toISOString(),
  };
}

/** The position the OS already has cached: available in milliseconds, but possibly old and imprecise. */
export async function getLastKnownFix(userId: string): Promise<MemberLocation | null> {
  try {
    const pos = await Location.getLastKnownPositionAsync();
    return pos ? toMemberLocation(userId, pos) : null;
  } catch {
    return null;
  }
}

/** One fresh GPS-quality fix, falling back to the last known position if none arrives in time. */
export async function getDeviceFix(userId: string): Promise<MemberLocation | null> {
  try {
    const fresh = await Promise.race([
      Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 15_000)),
    ]);
    const pos = fresh ?? (await Location.getLastKnownPositionAsync());
    return pos ? toMemberLocation(userId, pos) : null;
  } catch {
    return null;
  }
}

export async function clearMyLocation(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;
  await supabase.from('locations').delete().eq('user_id', userId);
}
