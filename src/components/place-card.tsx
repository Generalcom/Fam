import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Image, Linking, Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { Avatar, Button, Text } from '@/components/ui';
import { radius, space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { AvatarConfig } from '@/lib/avatar';
import { googleMapsConfigured, staticMapUrl, streetViewAvailable, streetViewUrl } from '@/lib/google-maps';
import { googleMapsUrl, type PlaceInfo } from '@/lib/place-info';
import { formatDuration, formatRouteDistance } from '@/lib/route';
import type { PresenceState } from '@/lib/types';
import { describeHit, distanceM, ZONE_COLORS, type ZoneHit } from '@/lib/zones';

type Props = {
  name: string;
  color: string;
  avatar?: AvatarConfig | null;
  /** Updated just now · 370 m away */
  status: string;
  presence: PresenceState | undefined;
  coords: { lat: number; lng: number; accuracy: number | null };
  /** Height from the map data, used when OpenStreetMap has no height tag. */
  tileHeightM: number | null;
  info: PlaceInfo | null;
  loadingInfo: boolean;
  /** The road route to this person, when you are looking at someone else. */
  route?: { distanceM: number; durationS: number; mode?: 'drive' | 'walk' } | null;
  routing?: boolean;
  /** Where turn-by-turn directions to them open. Absent for yourself. */
  directions?: string | null;
  /** Red and be-aware zones the person is in or near, most serious first. */
  zoneHits?: ZoneHit[];
  onClose: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
};

const GREEN = '#16A34A';

function describePlace(
  presence: PresenceState | undefined,
  buildingName: string | null,
  accuracy: number | null,
): { text: string; icon: 'business' | 'walk' | 'help-circle'; color: string | null } {
  const building = buildingName ?? 'a building';
  switch (presence) {
    case 'inside':
      return { text: `Inside ${building}`, icon: 'business', color: GREEN };
    case 'indoors':
      return { text: `Probably inside ${building}`, icon: 'business', color: GREEN };
    case 'around':
      return { text: `Outside, next to ${building}`, icon: 'business', color: GREEN };
    case 'outside':
      return { text: 'Outside', icon: 'walk', color: null };
    case 'imprecise':
      return { text: `Location too imprecise to tell${accuracy == null ? '' : ` (±${Math.round(accuracy)} m)`}`, icon: 'help-circle', color: null };
    case 'unknown':
      return { text: "Couldn't check the buildings here", icon: 'help-circle', color: null };
    default:
      return { text: 'Checking the buildings here…', icon: 'help-circle', color: null };
  }
}

type PictureMode = 'map' | 'street' | 'photo';

const MODE_LABELS: Record<PictureMode, string> = { map: 'Google Maps', street: 'Street View', photo: 'Photo' };

export function PlaceCard({
  name, color, avatar, status, presence, coords, tileHeightM, info, loadingInfo, route = null, routing = false, directions = null, zoneHits = [], onClose, onLayout,
}: Props) {
  const theme = useTheme();
  const [copied, setCopied] = useState(false);
  const [photoFailed, setPhotoFailed] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const [streetAvailable, setStreetAvailable] = useState(false);
  const [chosen, setChosen] = useState<PictureMode | null>(null);
  const [imageLoaded, setImageLoaded] = useState(false);

  // Google pictures are requested for where the person was when the card opened, and again only if they
  // move a fair way, so watching someone walk does not request a new picture every few seconds.
  const [anchor, setAnchor] = useState({ lat: coords.lat, lng: coords.lng });
  useEffect(() => {
    if (distanceM(anchor.lat, anchor.lng, coords.lat, coords.lng) > 50) setAnchor({ lat: coords.lat, lng: coords.lng });
  }, [coords.lat, coords.lng]);

  useEffect(() => {
    setMapFailed(false);
    setStreetAvailable(false);
    if (!googleMapsConfigured) return;
    const controller = new AbortController();
    void streetViewAvailable(anchor.lat, anchor.lng, controller.signal).then(setStreetAvailable);
    return () => controller.abort();
  }, [anchor.lat, anchor.lng]);

  const photo = info?.photo && !photoFailed ? info.photo : null;
  useEffect(() => setPhotoFailed(false), [info?.photo?.url]);
  useEffect(() => {
    if (!copied) return;
    const id = setTimeout(() => setCopied(false), 1500);
    return () => clearTimeout(id);
  }, [copied]);

  // What can be shown, Google's own pictures first. Google serves nothing without an API key.
  const modes: PictureMode[] = [
    ...(googleMapsConfigured && !mapFailed ? (['map'] as const) : []),
    ...(googleMapsConfigured && streetAvailable ? (['street'] as const) : []),
    ...(photo ? (['photo'] as const) : []),
  ];
  const mode: PictureMode | null = chosen && modes.includes(chosen) ? chosen : (modes[0] ?? null);
  const imageUri =
    mode === 'map'
      ? staticMapUrl(anchor.lat, anchor.lng)
      : mode === 'street'
        ? streetViewUrl(anchor.lat, anchor.lng)
        : mode === 'photo'
          ? (photo?.url ?? null)
          : null;
  useEffect(() => setImageLoaded(false), [imageUri]);

  function imageFailed() {
    if (mode === 'map') setMapFailed(true);
    else if (mode === 'street') setStreetAvailable(false);
    else if (mode === 'photo') setPhotoFailed(true);
  }

  const inBuilding = presence === 'inside' || presence === 'indoors' || presence === 'around';
  const place = describePlace(presence, info?.name ?? null, coords.accuracy);
  const height = info?.heightM ?? tileHeightM;
  const facts = inBuilding
    ? [height ? `${Math.round(height)} m tall` : null, info?.levels ? `${info.levels} floors` : null].filter(Boolean).join(' · ')
    : '';
  const coordinates = `${coords.lat.toFixed(5)}, ${coords.lng.toFixed(5)}`;
  const waitingForImage = !imageUri && loadingInfo && !googleMapsConfigured;

  return (
    <View
      onLayout={onLayout}
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, maxHeight: '78%' }]}>
      <ScrollView bounces={false} showsVerticalScrollIndicator={false}>
        <View style={[styles.imageBox, { backgroundColor: theme.border }]}>
          {imageUri ? (
            <>
              <Image
                source={{ uri: imageUri }}
                style={StyleSheet.absoluteFill}
                resizeMode="cover"
                accessibilityLabel={
                  mode === 'photo'
                    ? `Photo of ${info?.name ?? 'the building'}`
                    : mode === 'street'
                      ? 'Google Street View of the place'
                      : 'Google Maps view of the place'
                }
                onLoad={() => setImageLoaded(true)}
                onError={imageFailed}
              />
              {!imageLoaded && (
                <View pointerEvents="none" style={[StyleSheet.absoluteFill, styles.imageEmpty]}>
                  <ActivityIndicator color={theme.textSecondary} />
                </View>
              )}
            </>
          ) : (
            <View style={styles.imageEmpty}>
              {waitingForImage ? (
                <ActivityIndicator color={theme.textSecondary} />
              ) : (
                <>
                  <Ionicons name="image-outline" size={32} color={theme.textSecondary} />
                  {__DEV__ && !googleMapsConfigured && (
                    <Text variant="caption" color="textSecondary" style={{ textAlign: 'center', paddingHorizontal: space.md }}>
                      Add a Google Maps API key (see README) to show the Google Maps preview here.
                    </Text>
                  )}
                </>
              )}
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close location details"
            onPress={onClose}
            hitSlop={8}
            style={styles.close}>
            <Ionicons name="close" size={20} color="#FFFFFF" />
          </Pressable>
          {mode === 'photo' && photo && (
            <Pressable
              disabled={!photo.pageUrl}
              onPress={() => photo.pageUrl && void Linking.openURL(photo.pageUrl)}
              style={styles.credit}>
              <Text variant="caption" style={{ color: '#FFFFFF', fontSize: 10, lineHeight: 14 }} numberOfLines={1}>
                {`Photo: ${photo.credit}`}
              </Text>
            </Pressable>
          )}
          {modes.length > 1 && (
            <View style={styles.modes} accessibilityRole="radiogroup">
              {modes.map((option) => (
                <Pressable
                  key={option}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: option === mode }}
                  onPress={() => setChosen(option)}
                  style={[styles.mode, { backgroundColor: option === mode ? '#FFFFFF' : 'rgba(0,0,0,0.55)' }]}>
                  <Text variant="caption" style={{ fontSize: 11, lineHeight: 15, fontWeight: '700', color: option === mode ? '#111827' : '#FFFFFF' }}>
                    {MODE_LABELS[option]}
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
        </View>

        <View style={styles.body}>
          <View style={styles.person}>
            <Avatar name={name} color={color} size={36} avatar={avatar} />
            <View style={{ flex: 1 }}>
              <Text variant="heading" numberOfLines={1}>
                {name}
              </Text>
              <Text variant="caption" color="textSecondary" numberOfLines={1}>
                {status}
              </Text>
            </View>
          </View>

          {directions && (
            <View style={styles.row} accessibilityLiveRegion="polite">
              <Ionicons name={route?.mode === 'walk' ? 'walk-outline' : 'car-outline'} size={20} color={theme.primary} style={styles.icon} />
              <Text variant="label" style={{ flex: 1 }}>
                {route ? `${formatDuration(route.durationS)} · ${formatRouteDistance(route.distanceM)} ${route.mode === 'walk' ? 'on foot' : 'by road'}` : routing ? 'Finding the route…' : 'Route not available'}
              </Text>
            </View>
          )}

          {zoneHits.slice(0, 2).map((hit) => (
            <View
              key={hit.zone.id}
              accessibilityRole="alert"
              style={[styles.zone, { borderColor: ZONE_COLORS[hit.zone.level], backgroundColor: `${ZONE_COLORS[hit.zone.level]}1A` }]}>
              <Ionicons name={hit.zone.level === 'red' ? 'warning' : 'alert-circle'} size={20} color={ZONE_COLORS[hit.zone.level]} />
              <View style={{ flex: 1 }}>
                <Text variant="label" style={{ color: hit.zone.level === 'red' ? theme.danger : '#B45309' }}>
                  {describeHit(hit)}
                </Text>
                {hit.zone.note ? (
                  <Text variant="caption" color="textSecondary">
                    {hit.zone.note}
                  </Text>
                ) : null}
              </View>
            </View>
          ))}

          <View style={[styles.divider, { backgroundColor: theme.border }]} />

          <View style={styles.row}>
            <Ionicons name={place.icon} size={20} color={place.color ?? theme.textSecondary} style={styles.icon} />
            <View style={{ flex: 1 }}>
              <Text variant="label">{place.text}</Text>
              {facts ? (
                <Text variant="caption" color="textSecondary">
                  {facts}
                </Text>
              ) : null}
            </View>
          </View>

          <View style={styles.row}>
            <Ionicons name="location-outline" size={20} color={theme.textSecondary} style={styles.icon} />
            <Text variant="body" style={{ flex: 1 }} color={info?.address || loadingInfo ? 'text' : 'textSecondary'}>
              {info?.address ?? (loadingInfo ? 'Looking up the address…' : 'Address not available')}
            </Text>
          </View>

          <View style={styles.row}>
            <Ionicons name="navigate-circle-outline" size={20} color={theme.textSecondary} style={styles.icon} />
            <View style={{ flex: 1 }}>
              <Text variant="body" selectable>
                {coordinates}
              </Text>
              {coords.accuracy != null && (
                <Text variant="caption" color="textSecondary">
                  Accurate to about {Math.round(coords.accuracy)} m
                </Text>
              )}
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={copied ? 'Coordinates copied' : 'Copy coordinates'}
              hitSlop={10}
              onPress={() => {
                void Clipboard.setStringAsync(`${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)}`).then(() => setCopied(true));
              }}>
              <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={20} color={copied ? GREEN : theme.textSecondary} />
            </Pressable>
          </View>

          {directions && <Button title="Get directions" onPress={() => void Linking.openURL(directions)} style={{ marginTop: space.sm }} />}
          <Button
            title="Open in Google Maps"
            variant={directions ? 'secondary' : 'primary'}
            onPress={() => void Linking.openURL(googleMapsUrl(coords.lat, coords.lng))}
            style={{ marginTop: space.sm }}
          />
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    overflow: 'hidden',
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  imageBox: { height: 150, width: '100%' },
  imageEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  close: {
    position: 'absolute',
    top: space.sm,
    right: space.sm,
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modes: { position: 'absolute', right: space.sm, bottom: space.sm, flexDirection: 'row', gap: 6 },
  mode: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: radius.pill },
  credit: {
    position: 'absolute',
    left: space.sm,
    top: space.sm,
    maxWidth: '70%',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(0,0,0,0.55)',
  },
  body: { padding: space.md, gap: space.sm },
  person: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  divider: { height: StyleSheet.hairlineWidth, marginVertical: 2 },
  zone: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, padding: space.sm + 2, borderRadius: radius.md, borderWidth: 1.5 },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  icon: { marginTop: 1, width: 22 },
});
