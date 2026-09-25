import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';

import { AvatarImage } from '@/components/avatar-image';
import { Avatar, Text } from '@/components/ui';
import type { AvatarConfig } from '@/lib/avatar';
import { radius, space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { Member, ZoneLevel } from '@/lib/types';
import { ZONE_COLORS } from '@/lib/zones';

export type FamilyRow = {
  member: Member;
  /** "You" for the signed-in person, otherwise their name. */
  name: string;
  status: string;
  /** Everything a screen reader should say about the row. */
  spoken: string;
  hasLocation: boolean;
  /** Set when the person is in or near a red or be-aware zone. */
  zone?: { level: ZoneLevel; text: string } | null;
};

type Props = {
  rows: FamilyRow[];
  /** The most serious zone anyone is in or near, shown as a badge on the collapsed icon. */
  alert?: ZoneLevel | null;
  followId: string | null;
  /** Called when someone with a known location is tapped. */
  onSelect: (member: Member) => void;
};

// The collapsed icon: a round button with the family as small glowing orbs spaced evenly around a ring.
const BUTTON = 76;
const RING_RADIUS = 23;
/** Up to this many people get their own orb; beyond it the last orb reads "+N". */
const MAX_ORBS = 6;

/** Orb sizes shrink as more of them share the ring, so they never touch. */
function orbSize(count: number): number {
  if (count <= 1) return 32;
  if (count <= 4) return 22;
  if (count === 5) return 20;
  return 18;
}

function Orb({
  size,
  color,
  avatar,
  ringColor,
  backing,
  dimmed,
  label,
}: {
  size: number;
  color: string;
  avatar?: AvatarConfig | null;
  ringColor: string;
  /** Opaque colour behind the orb, so a faded orb doesn't show the ring line through it. */
  backing: string;
  dimmed?: boolean;
  label?: string;
}) {
  const outer = size + 4;
  return (
    <View
      style={{
        width: outer,
        height: outer,
        borderRadius: outer / 2,
        borderWidth: 2,
        borderColor: ringColor,
        backgroundColor: backing,
      }}>
      <View
        style={{
          flex: 1,
          borderRadius: size / 2,
          backgroundColor: color,
          opacity: dimmed ? 0.4 : 1,
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}>
        {avatar ? (
          <AvatarImage config={avatar} size={size} />
        ) : (
          <View
            style={{
              position: 'absolute',
              top: size * 0.14,
              left: size * 0.2,
              width: size * 0.32,
              height: size * 0.32,
              borderRadius: size * 0.16,
              backgroundColor: 'rgba(255,255,255,0.4)',
            }}
          />
        )}
        {label ? <Text style={{ color: '#FFFFFF', fontSize: 9, lineHeight: 11, fontWeight: '800' }}>{label}</Text> : null}
      </View>
    </View>
  );
}

/**
 * A round icon showing the family as orbs in a ring. Tapping it opens the list of members, and tapping a
 * member shows where they are on the map.
 */
export function FamilyMenu({ rows, alert = null, followId, onSelect }: Props) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);

  if (rows.length === 0) return null;

  const shadow = { shadowColor: '#000', shadowOpacity: 0.2, shadowRadius: 4, shadowOffset: { width: 0, height: 1 }, elevation: 4 };

  if (!open) {
    const overflow = rows.length > MAX_ORBS;
    const people = overflow ? rows.slice(0, MAX_ORBS - 1) : rows;
    const count = people.length + (overflow ? 1 : 0);
    const size = orbSize(count);
    const outer = size + 4;
    const place = (index: number) => {
      if (count === 1) return { left: BUTTON / 2 - outer / 2, top: BUTTON / 2 - outer / 2 };
      const angle = -Math.PI / 2 + (2 * Math.PI * index) / count;
      return {
        left: BUTTON / 2 + RING_RADIUS * Math.cos(angle) - outer / 2,
        top: BUTTON / 2 + RING_RADIUS * Math.sin(angle) - outer / 2,
      };
    };

    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Family, ${rows.length} ${rows.length === 1 ? 'person' : 'people'}${
          alert ? (alert === 'red' ? '. Someone is in or near a red zone' : '. Someone is in or near a be-aware zone') : ''
        }`}
        accessibilityHint="Opens the list of family members"
        onPress={() => setOpen(true)}
        style={[styles.button, shadow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        {alert && (
          <View
            pointerEvents="none"
            style={[styles.alertDot, { backgroundColor: ZONE_COLORS[alert], borderColor: theme.surface }]}
          />
        )}
        {count > 1 && (
          <>
            <View pointerEvents="none" style={[styles.track, { borderColor: theme.primary }]} />
            <View pointerEvents="none" style={styles.hub}>
              <Ionicons name="people" size={14} color={theme.textSecondary} />
            </View>
          </>
        )}
        {people.map((row, i) => (
          <View key={row.member.user_id} pointerEvents="none" style={[styles.orb, place(i)]}>
            <Orb
              size={size}
              color={row.member.profile.color}
              avatar={row.member.profile.avatar}
              ringColor={followId === row.member.user_id ? theme.primary : theme.surface}
              backing={theme.surface}
              dimmed={!row.hasLocation}
            />
          </View>
        ))}
        {overflow && (
          <View pointerEvents="none" style={[styles.orb, place(people.length)]}>
            <Orb
              size={size}
              color={theme.textSecondary}
              ringColor={theme.surface}
              backing={theme.surface}
              label={`+${rows.length - people.length}`}
            />
          </View>
        )}
      </Pressable>
    );
  }

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close family list"
        style={StyleSheet.absoluteFill}
        onPress={() => setOpen(false)}
      />
      <View style={[styles.sheet, shadow, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close family list"
          onPress={() => setOpen(false)}
          style={styles.header}>
          <Text variant="heading">Family ({rows.length})</Text>
          <Ionicons name="chevron-down" size={22} color={theme.textSecondary} />
        </Pressable>
        <FlatList
          data={rows}
          keyExtractor={(row) => row.member.user_id}
          style={{ flexGrow: 0 }}
          ItemSeparatorComponent={() => <View style={{ height: StyleSheet.hairlineWidth, backgroundColor: theme.border }} />}
          renderItem={({ item }) => {
            const following = followId === item.member.user_id;
            return (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={item.spoken}
                accessibilityState={{ selected: following, disabled: !item.hasLocation }}
                accessibilityHint={item.hasLocation ? 'Shows their location on the map' : undefined}
                disabled={!item.hasLocation}
                onPress={() => {
                  setOpen(false);
                  onSelect(item.member);
                }}
                style={({ pressed }) => [styles.row, { opacity: pressed ? 0.7 : 1 }]}>
                <Avatar name={item.member.profile.display_name} color={item.member.profile.color} size={40} dimmed={!item.hasLocation} avatar={item.member.profile.avatar} />
                <View style={{ flex: 1 }}>
                  <Text variant="label" numberOfLines={1}>
                    {item.name}
                  </Text>
                  <Text variant="caption" color="textSecondary" numberOfLines={1}>
                    {item.status}
                  </Text>
                  {item.zone && (
                    <Text variant="caption" numberOfLines={2} style={{ color: item.zone.level === 'red' ? theme.danger : '#B45309', fontWeight: '700' }}>
                      {item.zone.text}
                    </Text>
                  )}
                </View>
                {following ? (
                  <Ionicons name="navigate" size={18} color={theme.primary} />
                ) : item.hasLocation ? (
                  <Ionicons name="chevron-forward" size={18} color={theme.textSecondary} />
                ) : null}
              </Pressable>
            );
          }}
        />
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  button: {
    position: 'absolute',
    left: space.md,
    bottom: space.md,
    width: BUTTON,
    height: BUTTON,
    borderRadius: BUTTON / 2,
    borderWidth: StyleSheet.hairlineWidth,
  },
  alertDot: {
    position: 'absolute',
    top: 0,
    right: 0,
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 3,
    zIndex: 2,
  },
  track: {
    position: 'absolute',
    left: BUTTON / 2 - RING_RADIUS,
    top: BUTTON / 2 - RING_RADIUS,
    width: RING_RADIUS * 2,
    height: RING_RADIUS * 2,
    borderRadius: RING_RADIUS,
    borderWidth: 1.5,
    opacity: 0.3,
  },
  hub: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  orb: { position: 'absolute' },
  sheet: {
    position: 'absolute',
    left: space.md,
    right: space.md,
    bottom: space.md,
    maxHeight: '60%',
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
  },
  header: {
    minHeight: 52,
    paddingHorizontal: space.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  row: {
    minHeight: 64,
    paddingHorizontal: space.md,
    paddingVertical: space.sm,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.md,
  },
});
