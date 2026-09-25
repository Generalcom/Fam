import { Ionicons } from '@expo/vector-icons';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { FamilyMenu, type FamilyRow } from '@/components/family-menu';
import { OsmMap, type BuildingRef, type MapMarker, type OsmMapHandle, type ZoneShape } from '@/components/osm-map';
import { PlaceCard } from '@/components/place-card';
import { Text } from '@/components/ui';
import { ZoneBanner, type ZoneAlert } from '@/components/zone-banner';
import { ZoneSheet } from '@/components/zone-sheet';
import { radius, space } from '@/constants/theme';
import { useNow } from '@/hooks/use-now';
import { usePlaceInfo } from '@/hooks/use-place-info';
import { useRoute } from '@/hooks/use-route';
import { useTheme } from '@/hooks/use-theme';
import { avatarDataUri } from '@/lib/avatar';
import { isStale, memberStatus, placeLabel } from '@/lib/format';
import { loadInitialView, NEAR_ZOOM, rememberPosition, type InitialView } from '@/lib/initial-view';
import { getDeviceFix, getLastKnownFix } from '@/lib/location';
import { directionsUrl } from '@/lib/route';
import type { Member, MemberLocation, PresenceState, ZoneLevel } from '@/lib/types';
import { alertLevel, alertText, DEFAULT_RADIUS_M, describeHit, zonesAt, type ZoneHit } from '@/lib/zones';
import { useCircle } from '@/providers/circle';

const FOCUS_ZOOM = 16;
/** Closer in while a person's location card is open. */
const CARD_ZOOM = 17;
/** Until the card has been measured, how much of the bottom of the screen it covers. */
const CARD_ESTIMATE = 470;
/** The same guess for the new-zone sheet. */
const ZONE_SHEET_ESTIMATE = 480;
const NOT_LOADING = 'The map is not loading. Check your internet connection, then reopen the app.';
const TILES_FAILING = 'Map tiles are not loading. Check your internet connection.';

export default function MapScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const now = useNow();
  const { me, members, locations, myFix, permission, requestPermission, zones, zonesStatus, addZone } = useCircle();

  const mapRef = useRef<OsmMapHandle>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapProblem, setMapProblem] = useState<string | null>(null);
  const [presence, setPresence] = useState<Record<string, PresenceState>>({});
  const [deviceFix, setDeviceFix] = useState<MemberLocation | null>(null);
  const [startView, setStartView] = useState<InitialView | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [buildings, setBuildings] = useState<Record<string, BuildingRef>>({});
  const [draft, setDraft] = useState<{ lat: number; lng: number; level: ZoneLevel; radius: number } | null>(null);
  const [savingZone, setSavingZone] = useState(false);
  const [zoneError, setZoneError] = useState<string | null>(null);
  const cardHeight = useRef(CARD_ESTIMATE);
  const centeredOnSelf = useRef(false);

  const canShowSelf = permission === 'foreground' || permission === 'background';
  const sharingOn = me?.sharing_enabled ?? false;

  // Your own position comes straight from this phone (fresher than the server copy, and it still works
  // while sharing is paused). Everyone else's comes from the server.
  const localFix = myFix ?? deviceFix;
  const live: Record<string, MemberLocation> = me && localFix ? { ...locations, [me.id]: localFix } : locations;
  const myLoc = me ? live[me.id] : undefined;

  // Only you are on the map. Choosing someone from the family orb shows just that person, until their card is closed.
  const shown = members.filter((m) => m.user_id === me?.id || m.user_id === selectedId);

  const people = shown.flatMap((m) => {
    const loc = live[m.user_id];
    return loc
      ? [{ id: m.user_id, lat: loc.latitude, lng: loc.longitude, accuracy: loc.accuracy, speed: loc.speed }]
      : [];
  });

  const avatars: Record<string, string> = {};
  for (const m of shown) if (m.profile.avatar) avatars[m.user_id] = avatarDataUri(m.profile.avatar);

  const markers: MapMarker[] = shown.flatMap((m) => {
    const loc = live[m.user_id];
    if (!loc) return [];
    const place = placeLabel(presence[m.user_id], loc.accuracy);
    const status = memberStatus(m.profile, loc, now);
    return [
      {
        id: m.user_id,
        lat: loc.latitude,
        lng: loc.longitude,
        name: m.profile.display_name,
        color: m.profile.color,
        stale: isStale(loc.updated_at, now),
        status: place ? `${place} · ${status}` : status,
      },
    ];
  });

  const self = myLoc ? { lat: myLoc.latitude, lng: myLoc.longitude } : null;

  // Which red or be-aware zones each person is in or close to.
  const zoneHits: Record<string, ZoneHit[]> = {};
  for (const m of members) {
    const loc = live[m.user_id];
    if (!loc) continue;
    const hits = zonesAt(zones, loc.latitude, loc.longitude, loc.accuracy);
    if (hits.length > 0) zoneHits[m.user_id] = hits;
  }

  // You first, then everyone else by name.
  const rows: FamilyRow[] = [...members]
    .sort((a, b) =>
      a.user_id === me?.id ? -1 : b.user_id === me?.id ? 1 : a.profile.display_name.localeCompare(b.profile.display_name),
    )
    .map((m) => {
      const loc = live[m.user_id];
      const isMe = m.user_id === me?.id;
      const status = memberStatus(m.profile, loc, now);
      const name = isMe ? 'You' : m.profile.display_name;
      const place = loc ? placeLabel(presence[m.user_id], loc.accuracy) : null;
      const hit = zoneHits[m.user_id]?.[0];
      const zone = hit ? { level: hit.zone.level, text: describeHit(hit) } : null;
      return {
        member: m,
        name,
        status,
        spoken: [name, place, status, zone?.text].filter(Boolean).join('. '),
        hasLocation: !!loc,
        zone,
      };
    });

  const alerts: ZoneAlert[] = members
    .flatMap((m) => {
      const hit = zoneHits[m.user_id]?.[0];
      return hit
        ? [{ key: m.user_id, level: hit.zone.level, text: alertText(m.profile.display_name, m.user_id === me?.id, hit), onPress: () => selectMember(m) }]
        : [];
    })
    .sort((a, b) => (a.level === 'red' ? 0 : 1) - (b.level === 'red' ? 0 : 1));
  const overallAlert = alertLevel(Object.values(zoneHits).flat());

  const zoneShapes: ZoneShape[] = [
    ...zones.map((z) => ({ id: z.id, name: z.name, level: z.level, lat: z.latitude, lng: z.longitude, radius: z.radius_m, note: z.note })),
    ...(draft
      ? [{ id: 'draft', name: 'New zone', level: draft.level, lat: draft.lat, lng: draft.lng, radius: draft.radius, note: null, draft: true }]
      : []),
  ];

  // Where to open the map, found without waiting for GPS: saved or cached position, else the city of the
  // phone's time zone. If none is known the map waits for the first fix rather than showing the world.
  useEffect(() => {
    let cancelled = false;
    void loadInitialView().then((view) => {
      if (!cancelled && view) setStartView((current) => current ?? view);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // A quick cached position first (milliseconds), then a fresh GPS fix, so "You" appears straight away
  // even before the live updates begin or while sharing is paused.
  useEffect(() => {
    if (!canShowSelf || !me) return;
    let cancelled = false;
    void getLastKnownFix(me.id).then((fix) => {
      if (!cancelled && fix) setDeviceFix((current) => current ?? fix);
    });
    void getDeviceFix(me.id).then((fix) => {
      if (!cancelled && fix) setDeviceFix(fix);
    });
    return () => {
      cancelled = true;
    };
  }, [canShowSelf, me?.id]);

  useEffect(() => {
    if (!startView && localFix) {
      setStartView({ lat: localFix.latitude, lng: localFix.longitude, zoom: NEAR_ZOOM, source: 'fix' });
    }
  }, [startView, localFix]);

  useEffect(() => {
    if (myLoc) rememberPosition(myLoc.latitude, myLoc.longitude);
  }, [myLoc?.latitude, myLoc?.longitude]);

  useEffect(() => {
    if (!mapReady || !self || centeredOnSelf.current) return;
    centeredOnSelf.current = true;
    mapRef.current?.flyTo(self.lat, self.lng, FOCUS_ZOOM, false);
  }, [mapReady, self?.lat, self?.lng]);

  useEffect(() => {
    if (mapReady) return;
    const id = setTimeout(() => setMapProblem(NOT_LOADING), 8000);
    return () => clearTimeout(id);
  }, [mapReady]);

  const selectedRow = selectedId ? rows.find((r) => r.member.user_id === selectedId) : undefined;
  const selectedLoc = selectedId ? live[selectedId] : undefined;
  const selectedBuilding = selectedId ? buildings[selectedId] : undefined;
  const other = !!selectedId && selectedId !== me?.id;
  const target = other && selectedLoc ? { lat: selectedLoc.latitude, lng: selectedLoc.longitude } : null;
  const { route, loading: routing } = useRoute(other ? self : null, target, other ? selectedId : null);
  const fittedRoute = useRef<string | null>(null);

  // When the route first arrives the view is fitted to all of it, once; after that the person is left to pan and zoom.
  useEffect(() => {
    if (!route || !selectedId || fittedRoute.current === selectedId) return;
    fittedRoute.current = selectedId;
    const step = Math.max(1, Math.floor(route.coordinates.length / 40));
    const points = route.coordinates.filter((_, i) => i % step === 0 || i === route.coordinates.length - 1).map(([lng, lat]) => ({ lat, lng }));
    fitTo(points);
  }, [route, selectedId]);
  const cardStatus =
    selectedRow && selectedId
      ? memberStatus(selectedRow.member.profile, selectedLoc, now, selectedId !== me?.id && myLoc ? { latitude: myLoc.latitude, longitude: myLoc.longitude } : undefined)
      : '';
  const { info, loading: loadingInfo } = usePlaceInfo(
    selectedLoc && selectedId
      ? { lat: selectedLoc.latitude, lng: selectedLoc.longitude, tileId: selectedBuilding?.tileId ?? null }
      : null,
    selectedId,
  );

  // The card goes if the person stops sharing, and the map takes back the space it covered.
  useEffect(() => {
    if (selectedId && !selectedLoc) setSelectedId(null);
  }, [selectedId, selectedLoc]);

  useEffect(() => {
    if (!selectedId && !draft) mapRef.current?.setPadding(0);
  }, [selectedId, draft]);

  // Pressing and holding the map starts a new safety zone at that spot.
  function startZone(lat: number, lng: number) {
    if (zonesStatus === 'missing') {
      Alert.alert(
        'Safety zones need one more setup step',
        'Run supabase/safety-zones.sql in your Supabase SQL editor, then reopen the app.',
      );
      return;
    }
    if (zonesStatus !== 'ready') {
      Alert.alert('Safety zones are not available', 'Check your connection and try again.');
      return;
    }
    setSelectedId(null);
    setZoneError(null);
    setDraft({ lat, lng, level: 'red', radius: DEFAULT_RADIUS_M });
    mapRef.current?.flyTo(lat, lng, null, true, ZONE_SHEET_ESTIMATE + space.md * 2);
  }

  async function saveZone(input: { name: string; level: ZoneLevel; radius_m: number; note: string | null }) {
    if (!draft) return;
    setSavingZone(true);
    setZoneError(null);
    try {
      await addZone({ ...input, latitude: draft.lat, longitude: draft.lng });
      setDraft(null);
    } catch (e) {
      setZoneError((e as Error).message);
    } finally {
      setSavingZone(false);
    }
  }

  // Tapping someone in the family list shows where they are, opens their location card, and the map keeps
  // following them until the user moves the map.
  // Both people (or the whole route) in view, clear of the card that covers the bottom of the map.
  function fitTo(points: { lat: number; lng: number }[]) {
    mapRef.current?.fit(points, { top: insets.top + 110, right: 48, bottom: cardHeight.current + space.md * 2 + 24, left: 48 }, true);
  }

  function selectMember(member: Member) {
    const loc = live[member.user_id];
    if (!loc) return;
    setDraft(null);
    setSelectedId(member.user_id);
    fittedRoute.current = null;
    if (member.user_id === me?.id || !self) {
      mapRef.current?.flyTo(loc.latitude, loc.longitude, CARD_ZOOM, true, cardHeight.current + space.md * 2);
    } else {
      // routed to them: you and them in view now, the whole route as soon as it is known
      fitTo([self, { lat: loc.latitude, lng: loc.longitude }]);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {startView && (
        <OsmMap
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          start={startView}
          markers={markers}
          avatars={avatars}
          route={route?.coordinates ?? null}
          zones={zoneShapes}
          people={people}
          onReady={() => {
            setMapReady(true);
            setMapProblem(null);
          }}
          onLongPress={startZone}
          onPresence={setPresence}
          onBuildings={setBuildings}
          onTilesChange={(ok) => setMapProblem(ok ? null : TILES_FAILING)}
          onLoadError={() => setMapProblem(NOT_LOADING)}
        />
      )}
      {!mapReady && (
        <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.loading]}>
          <ActivityIndicator color={theme.primary} />
          <Text variant="caption" color="textSecondary">
            {startView ? 'Loading map…' : 'Finding your location…'}
          </Text>
        </View>
      )}

      <View style={[styles.top, { top: insets.top + space.sm }]} pointerEvents="box-none">
        <ZoneBanner alerts={alerts} />
        {mapProblem && (
          <View style={[styles.banner, { backgroundColor: theme.warningBg }]}>
            <Text variant="caption" style={{ color: theme.warningText }}>
              {mapProblem}
            </Text>
          </View>
        )}

        {sharingOn && permission === 'denied' && (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              // Asks again if the system still allows it, otherwise sends the user to Settings.
              void requestPermission().then((status) => {
                if (status === 'denied') void Linking.openSettings();
              });
            }}
            style={[styles.banner, { backgroundColor: theme.warningBg }]}>
            <Text variant="caption" style={{ color: theme.warningText }}>
              Location permission is off, so your family can't see you. Tap to allow it.
            </Text>
          </Pressable>
        )}
      </View>

      {draft ? (
        <ZoneSheet
          lat={draft.lat}
          lng={draft.lng}
          saving={savingZone}
          error={zoneError}
          onChange={(level, radiusM) =>
            setDraft((current) => (current && (current.level !== level || current.radius !== radiusM) ? { ...current, level, radius: radiusM } : current))
          }
          onSave={(input) => void saveZone(input)}
          onCancel={() => setDraft(null)}
        />
      ) : selectedRow && selectedLoc ? (
        <PlaceCard
          key={selectedRow.member.user_id}
          zoneHits={zoneHits[selectedRow.member.user_id]}
          name={selectedRow.name}
          color={selectedRow.member.profile.color}
          avatar={selectedRow.member.profile.avatar}
          status={cardStatus}
          presence={presence[selectedRow.member.user_id]}
          coords={{ lat: selectedLoc.latitude, lng: selectedLoc.longitude, accuracy: selectedLoc.accuracy }}
          tileHeightM={selectedBuilding?.heightM ?? null}
          info={info}
          loadingInfo={loadingInfo}
          route={route}
          routing={routing}
          directions={other && self && target ? directionsUrl(self, target) : null}
          onClose={() => setSelectedId(null)}
          onLayout={(event) => {
            const height = event.nativeEvent.layout.height;
            // The card is measured after it appears; nudge the map if the guess was well off.
            if (Math.abs(height - cardHeight.current) > 30) {
              cardHeight.current = height;
              mapRef.current?.setPadding(height + space.md * 2);
            }
          }}
        />
      ) : (
        <>
          {self && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Show my location"
              onPress={() => mapRef.current?.flyTo(self.lat, self.lng, FOCUS_ZOOM, true)}
              style={[styles.fab, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Ionicons name="locate-outline" size={22} color={theme.text} />
            </Pressable>
          )}
          <FamilyMenu rows={rows} alert={overallAlert} followId={null} onSelect={selectMember} />
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  top: { position: 'absolute', left: space.md, right: space.md, gap: space.sm, alignItems: 'flex-start' },
  banner: { borderRadius: radius.md, padding: space.sm + 2, alignSelf: 'stretch' },
  fab: {
    position: 'absolute',
    right: space.md,
    bottom: space.md,
    width: 48,
    height: 48,
    borderRadius: 24,
    borderWidth: StyleSheet.hairlineWidth,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loading: { alignItems: 'center', justifyContent: 'center', gap: space.sm, backgroundColor: '#e5e3df' },
});
