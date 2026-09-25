import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, View } from 'react-native';

import { Text } from '@/components/ui';
import { radius, space } from '@/constants/theme';
import type { ZoneLevel } from '@/lib/types';

export type ZoneAlert = {
  key: string;
  level: ZoneLevel;
  text: string;
  /** Called when the banner is tapped, e.g. to show that person. */
  onPress?: () => void;
};

const STYLES: Record<ZoneLevel, { bg: string; fg: string; border: string; icon: 'warning' | 'alert-circle' }> = {
  red: { bg: '#B91C1C', fg: '#FFFFFF', border: '#7F1D1D', icon: 'warning' },
  aware: { bg: '#FEF3C7', fg: '#78350F', border: '#F59E0B', icon: 'alert-circle' },
};

const MAX_SHOWN = 3;

/** Safety alerts along the top of the map, most serious first. They stay until the person leaves the zone. */
export function ZoneBanner({ alerts }: { alerts: ZoneAlert[] }) {
  if (alerts.length === 0) return null;
  const shown = alerts.slice(0, MAX_SHOWN);
  const more = alerts.length - shown.length;

  return (
    <View style={styles.stack} accessibilityLiveRegion="polite">
      {shown.map((alert) => {
        const look = STYLES[alert.level];
        return (
          <Pressable
            key={alert.key}
            accessibilityRole={alert.onPress ? 'button' : 'alert'}
            accessibilityLabel={`${alert.level === 'red' ? 'Danger. ' : 'Take care. '}${alert.text}`}
            disabled={!alert.onPress}
            onPress={alert.onPress}
            style={[styles.banner, { backgroundColor: look.bg, borderColor: look.border }]}>
            <Ionicons name={look.icon} size={20} color={look.fg} />
            <Text variant="label" style={{ color: look.fg, flex: 1 }}>
              {alert.text}
            </Text>
          </Pressable>
        );
      })}
      {more > 0 && (
        <Text variant="caption" style={styles.more}>
          +{more} more
        </Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  stack: { alignSelf: 'stretch', gap: space.xs + 2 },
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    minHeight: 44,
    paddingHorizontal: space.md - 2,
    paddingVertical: space.sm,
    borderRadius: radius.md,
    borderWidth: 1,
  },
  more: { alignSelf: 'flex-end', color: '#4B5563', fontWeight: '700', backgroundColor: 'rgba(255,255,255,0.85)', paddingHorizontal: 8, borderRadius: radius.pill },
});
