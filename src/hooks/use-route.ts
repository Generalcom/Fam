import { useEffect, useRef, useState } from 'react';

import { fetchRoute, metresBetween, type LatLng, type Route, type TravelMode } from '@/lib/route';

/** Asked for again once either end has moved this far, and never more often than the interval. */
const REROUTE_M = 150;
const MIN_INTERVAL_MS = 20_000;
/** After leaving the route (see `offRoute`), a new one is asked for this soon. */
const OFF_ROUTE_INTERVAL_MS = 8_000;

/**
 * The route from one place to another, by road or on foot. `key` names who it is for: a new key or mode starts
 * fresh; the same key keeps the line on screen and only asks again after someone has moved a fair way, or straight
 * away (within a few seconds) while `offRoute` says you have left the line.
 */
export function useRoute(
  from: LatLng | null,
  to: LatLng | null,
  key: string | null,
  mode: TravelMode,
  offRoute = false,
): { route: Route | null; loading: boolean } {
  const [state, setState] = useState<{ key: string | null; route: Route | null; loading: boolean }>({ key: null, route: null, loading: false });
  const last = useRef<{ key: string; from: LatLng; to: LatLng; at: number } | null>(null);
  const request = useRef(0);
  const fullKey = key ? `${key}:${mode}` : null;

  const fromLat = from?.lat;
  const fromLng = from?.lng;
  const toLat = to?.lat;
  const toLng = to?.lng;

  useEffect(() => {
    if (!fullKey || fromLat == null || fromLng == null || toLat == null || toLng == null) {
      request.current++;
      last.current = null;
      setState((s) => (s.key === null && !s.route && !s.loading ? s : { key: null, route: null, loading: false }));
      return;
    }
    const a = { lat: fromLat, lng: fromLng };
    const b = { lat: toLat, lng: toLng };
    const prev = last.current;
    if (prev && prev.key === fullKey) {
      const since = Date.now() - prev.at;
      const moved = Math.max(metresBetween(prev.from, a), metresBetween(prev.to, b));
      const due = offRoute ? since >= OFF_ROUTE_INTERVAL_MS : moved >= REROUTE_M && since >= MIN_INTERVAL_MS;
      if (!due) return;
    }
    last.current = { key: fullKey, from: a, to: b, at: Date.now() };

    const mine = ++request.current;
    setState((s) => ({ key: fullKey, route: s.key === fullKey ? s.route : null, loading: true }));
    void fetchRoute(a, b, mode).then((route) => {
      if (mine !== request.current) return; // someone else was chosen meanwhile
      setState((s) => ({ key: fullKey, route: route ?? (s.key === fullKey ? s.route : null), loading: false }));
    });
  }, [fullKey, mode, fromLat, fromLng, toLat, toLng, offRoute]);

  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );

  return state.key === fullKey ? { route: state.route, loading: state.loading } : { route: null, loading: !!fullKey };
}
