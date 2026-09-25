import { useEffect, useRef, useState } from 'react';

import { fetchPlaceInfo, type PlaceInfo, type PlaceQuery } from '@/lib/place-info';

const REFETCH_AFTER_M = 60;

function metres(a: PlaceQuery, b: PlaceQuery): number {
  const kx = 111320 * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot((a.lng - b.lng) * kx, (a.lat - b.lat) * 110540);
}

/**
 * Details about the place for the person whose card is open: name, address, photo. It looks again only
 * when they are in a different building or have moved a fair way, since the lookup services are rate limited.
 */
export function usePlaceInfo(
  target: PlaceQuery | null,
  personId: string | null,
): { info: PlaceInfo | null; loading: boolean } {
  const [state, setState] = useState<{ info: PlaceInfo | null; loading: boolean }>({ info: null, loading: false });
  const last = useRef<{ personId: string; query: PlaceQuery } | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!target || !personId) {
      controller.current?.abort();
      last.current = null;
      setState({ info: null, loading: false });
      return;
    }
    const previous = last.current;
    const samePerson = previous?.personId === personId;
    if (samePerson && previous && previous.query.tileId === target.tileId && metres(previous.query, target) <= REFETCH_AFTER_M) {
      return;
    }

    last.current = { personId, query: target };
    controller.current?.abort();
    const mine = new AbortController();
    controller.current = mine;
    setState((current) => ({ info: samePerson ? current.info : null, loading: true }));
    void fetchPlaceInfo(target, mine.signal).then((info) => {
      if (!mine.signal.aborted) setState({ info, loading: false });
    });
  }, [personId, target?.lat, target?.lng, target?.tileId]);

  useEffect(() => () => controller.current?.abort(), []);

  return state;
}
