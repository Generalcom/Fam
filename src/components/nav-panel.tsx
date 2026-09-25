import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View, type LayoutChangeEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar, Text } from '@/components/ui';
import { radius, space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { AvatarConfig } from '@/lib/avatar';
import { formatIn, type NavProgress } from '@/lib/navigation';
import { formatDuration, formatRouteDistance, type TravelMode } from '@/lib/route';

const NAV_GREEN = '#0F5132';

type Props = {
  name: string;
  color: string;
  avatar: AvatarConfig | null;
  progress: NavProgress | null;
  loading: boolean;
  mode: TravelMode;
  /** Shown when you are not being followed on the map (you moved it yourself). */
  following: boolean;
  onMode: (mode: TravelMode) => void;
  onRecenter: () => void;
  onDetails: () => void;
  onOpenMaps: () => void;
  onEnd: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
};

function arriveAt(seconds: number): string {
  const at = new Date(Date.now() + seconds * 1000);
  return `${String(at.getHours()).padStart(2, '0')}:${String(at.getMinutes()).padStart(2, '0')}`;
}

/** The next turn at the top of the map; time, distance, how you're travelling and the controls at the bottom. */
export function NavPanel({ name, color, avatar, progress, loading, mode, following, onMode, onRecenter, onDetails, onOpenMaps, onEnd, onLayout }: Props) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const next = progress?.next ?? null;
  const [sheetHeight, setSheetHeight] = useState(170);

  let icon: React.ComponentProps<typeof Ionicons>['name'] = 'arrow-up';
  let headline: string;
  let detail: string | null = null;
  let angle = 0;
  if (progress?.arrived) {
    icon = 'flag';
    headline = `You've arrived`;
    detail = `${name} is here`;
  } else if (next) {
    headline = formatIn(next.inM);
    detail = next.text;
    if (next.step.type === 'arrive') icon = 'flag';
    else if (next.step.type === 'roundabout' || next.step.type === 'rotary') icon = 'sync';
    else if (next.angle !== null && Math.abs(next.angle) >= 180) icon = 'return-up-back';
    else angle = next.angle ?? 0;
  } else if (loading) {
    headline = 'Finding the way…';
  } else if (progress) {
    headline = `Head to ${name}`;
  } else {
    icon = 'alert-circle';
    headline = 'No route found';
    detail = mode === 'walk' ? 'Try driving, or open Google Maps' : 'Try walking, or open Google Maps';
  }

  return (
    <>
      <View style={[styles.banner, { top: insets.top + space.sm }]} accessibilityRole="header" accessibilityLiveRegion="polite">
        <View style={styles.bannerIcon}>
          {loading && !progress ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Ionicons name={icon} size={34} color="#FFFFFF" style={angle ? { transform: [{ rotate: `${angle}deg` }] } : undefined} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          <Text variant="title" style={{ color: '#FFFFFF', fontSize: 24, lineHeight: 30 }} numberOfLines={1}>
            {headline}
          </Text>
          {detail ? (
            <Text variant="body" style={{ color: '#E5F3EC' }} numberOfLines={2}>
              {detail}
            </Text>
          ) : null}
        </View>
      </View>

      {!following && (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Re-centre on me"
          onPress={onRecenter}
          style={[styles.recenter, { bottom: sheetHeight + space.md * 2, backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Ionicons name="navigate" size={18} color={theme.primary} />
          <Text variant="label">Re-centre</Text>
        </Pressable>
      )}

      <View
        onLayout={(event) => {
          setSheetHeight(event.nativeEvent.layout.height);
          onLayout?.(event);
        }}
        style={[styles.sheet, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.row}>
          <Avatar name={name} color={color} size={40} avatar={avatar} />
          <View style={{ flex: 1 }}>
            {progress ? (
              <>
                <Text variant="heading" accessibilityLabel={`${formatDuration(progress.remainingS)} to ${name}`}>
                  {formatDuration(progress.remainingS)}
                </Text>
                <Text variant="caption" color="textSecondary">
                  {formatRouteDistance(progress.remainingM)} · arrive {arriveAt(progress.remainingS)}
                </Text>
              </>
            ) : (
              <>
                <Text variant="heading" numberOfLines={1}>
                  To {name}
                </Text>
                <Text variant="caption" color="textSecondary">
                  {loading ? 'Finding the way…' : 'Route not available'}
                </Text>
              </>
            )}
          </View>
          <View style={[styles.modes, { borderColor: theme.border }]} accessibilityRole="radiogroup">
            {(['drive', 'walk'] as const).map((m) => (
              <Pressable
                key={m}
                accessibilityRole="radio"
                accessibilityLabel={m === 'drive' ? 'Drive' : 'Walk'}
                accessibilityState={{ selected: mode === m }}
                onPress={() => onMode(m)}
                style={[styles.mode, mode === m && { backgroundColor: theme.primary }]}>
                <Ionicons name={m === 'drive' ? 'car' : 'walk'} size={20} color={mode === m ? theme.primaryText : theme.textSecondary} />
              </Pressable>
            ))}
          </View>
        </View>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={onDetails} style={[styles.action, { borderColor: theme.border }]}>
            <Ionicons name="information-circle-outline" size={18} color={theme.text} />
            <Text variant="label">Details</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="Open in Google Maps" onPress={onOpenMaps} style={[styles.action, { borderColor: theme.border }]}>
            <Ionicons name="map-outline" size={18} color={theme.text} />
            <Text variant="label">Google Maps</Text>
          </Pressable>
          <Pressable accessibilityRole="button" accessibilityLabel="End navigation" onPress={onEnd} style={[styles.action, { borderColor: theme.danger, backgroundColor: theme.danger }]}>
            <Ionicons name="close" size={18} color="#FFFFFF" />
            <Text variant="label" style={{ color: '#FFFFFF' }}>
              End
            </Text>
          </Pressable>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
    padding: space.md,
    borderRadius: radius.lg,
    backgroundColor: NAV_GREEN,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  bannerIcon: { width: 44, alignItems: 'center' },
  recenter: {
    position: 'absolute',
    left: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 40,
    borderRadius: radius.pill,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 4,
  },
  sheet: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.md,
    padding: space.md,
    gap: space.md,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  modes: { flexDirection: 'row', borderWidth: 1, borderRadius: radius.pill, padding: 2 },
  mode: { width: 42, height: 34, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  actions: { flexDirection: 'row', gap: space.sm },
  action: {
    flex: 1,
    flexDirection: 'row',
    gap: 6,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
  },
});
