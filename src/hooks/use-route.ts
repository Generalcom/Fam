import { useEffect, useRef, useState } from 'react';

import { fetchRoute, type LatLng, type Route } from '@/lib/route';

/** Asked for again once either end has moved this far, and never more often than the interval. */
const REROUTE_M = 150;
const MIN_INTERVAL_MS = 20_000;

const metresBetween = (a: LatLng, b: LatLng) => {
  const dy = (a.lat - b.lat) * 110_540;
  const dx = (a.lng - b.lng) * 111_320 * Math.cos(((a.lat + b.lat) / 2) * (Math.PI / 180));
  return Math.hypot(dx, dy);
};

/**
 * The road route from one place to another. `key` names who it is for: a new key starts fresh; the same key keeps
 * the line on screen and only asks again after someone has moved a fair way.
 */
export function useRoute(from: LatLng | null, to: LatLng | null, key: string | null): { route: Route | null; loading: boolean } {
  const [state, setState] = useState<{ key: string | null; route: Route | null; loading: boolean }>({ key: null, route: null, loading: false });
  const last = useRef<{ key: string; from: LatLng; to: LatLng; at: number } | null>(null);
  const request = useRef(0);

  const fromLat = from?.lat;
  const fromLng = from?.lng;
  const toLat = to?.lat;
  const toLng = to?.lng;

  useEffect(() => {
    if (!key || fromLat == null || fromLng == null || toLat == null || toLng == null) {
      request.current++;
      last.current = null;
      setState((s) => (s.key === null && !s.route && !s.loading ? s : { key: null, route: null, loading: false }));
      return;
    }
    const a = { lat: fromLat, lng: fromLng };
    const b = { lat: toLat, lng: toLng };
    const prev = last.current;
    if (prev && prev.key === key) {
      const moved = Math.max(metresBetween(prev.from, a), metresBetween(prev.to, b));
      if (moved < REROUTE_M || Date.now() - prev.at < MIN_INTERVAL_MS) return;
    }
    last.current = { key, from: a, to: b, at: Date.now() };

    const mine = ++request.current;
    setState((s) => ({ key, route: s.key === key ? s.route : null, loading: true }));
    void fetchRoute(a, b).then((route) => {
      if (mine !== request.current) return; // someone else was chosen meanwhile
      setState((s) => ({ key, route: route ?? (s.key === key ? s.route : null), loading: false }));
    });
  }, [key, fromLat, fromLng, toLat, toLng]);

  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );

  return state.key === key ? { route: state.route, loading: state.loading } : { route: null, loading: !!key };
}
