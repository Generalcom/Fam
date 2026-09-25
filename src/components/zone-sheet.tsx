import { Ionicons } from '@expo/vector-icons';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { Button, Text, TextField } from '@/components/ui';
import { radius, space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { ZoneLevel } from '@/lib/types';
import { DEFAULT_RADIUS_M, RADIUS_CHOICES_M, ZONE_COLORS } from '@/lib/zones';

type Props = {
  lat: number;
  lng: number;
  saving: boolean;
  error: string | null;
  /** The level and radius being chosen, so the map can draw the zone as it will look. */
  onChange: (level: ZoneLevel, radiusM: number) => void;
  onSave: (input: { name: string; level: ZoneLevel; radius_m: number; note: string | null }) => void;
  onCancel: () => void;
  onLayout?: (event: LayoutChangeEvent) => void;
};

const LEVELS: { level: ZoneLevel; title: string; hint: string }[] = [
  { level: 'red', title: 'Red zone', hint: 'Avoid this area' },
  { level: 'aware', title: 'Be aware', hint: 'Take extra care here' },
];

const radiusLabel = (m: number) => (m >= 1000 ? `${m / 1000} km` : `${m} m`);

/** The card that opens when the map is pressed and held: choose what kind of zone, how big, and name it. */
export function ZoneSheet({ lat, lng, saving, error, onChange, onSave, onCancel, onLayout }: Props) {
  const theme = useTheme();
  const [level, setLevel] = useState<ZoneLevel>('red');
  const [radiusM, setRadiusM] = useState<number>(DEFAULT_RADIUS_M);
  const [name, setName] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => onChange(level, radiusM), [level, radiusM]);

  return (
    <View
      onLayout={onLayout}
      style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border, maxHeight: '85%' }]}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.body} bounces={false}>
        <View style={styles.header}>
          <View style={{ flex: 1 }}>
            <Text variant="heading">New safety zone</Text>
            <Text variant="caption" color="textSecondary">
              {lat.toFixed(5)}, {lng.toFixed(5)}
            </Text>
          </View>
          <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel} hitSlop={10}>
            <Ionicons name="close" size={24} color={theme.textSecondary} />
          </Pressable>
        </View>

        <View style={styles.levels}>
          {LEVELS.map((option) => {
            const selected = option.level === level;
            return (
              <Pressable
                key={option.level}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${option.title}. ${option.hint}`}
                onPress={() => setLevel(option.level)}
                style={[
                  styles.level,
                  {
                    borderColor: selected ? ZONE_COLORS[option.level] : theme.border,
                    backgroundColor: selected ? `${ZONE_COLORS[option.level]}22` : theme.surface,
                  },
                ]}>
                <View style={[styles.dot, { backgroundColor: ZONE_COLORS[option.level] }]} />
                <View style={{ flex: 1 }}>
                  <Text variant="label">{option.title}</Text>
                  <Text variant="caption" color="textSecondary">
                    {option.hint}
                  </Text>
                </View>
              </Pressable>
            );
          })}
        </View>

        <View style={{ gap: space.xs }}>
          <Text variant="label">Size (radius)</Text>
          <View style={styles.chips}>
            {RADIUS_CHOICES_M.map((m) => {
              const selected = m === radiusM;
              return (
                <Pressable
                  key={m}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  onPress={() => setRadiusM(m)}
                  style={[
                    styles.chip,
                    { borderColor: selected ? theme.primary : theme.border, backgroundColor: selected ? theme.primary : theme.surface },
                  ]}>
                  <Text variant="label" style={{ color: selected ? theme.primaryText : theme.text }}>
                    {radiusLabel(m)}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        <TextField label="Name" value={name} onChangeText={setName} placeholder="e.g. Hillbrow at night" maxLength={80} />
        <TextField
          label="Note (optional)"
          value={note}
          onChangeText={setNote}
          placeholder="Why it is unsafe, or when to avoid it"
          maxLength={300}
        />

        {error ? (
          <Text variant="caption" style={{ color: theme.danger }}>
            {error}
          </Text>
        ) : null}

        <Button
          title="Save zone"
          loading={saving}
          disabled={name.trim().length === 0}
          onPress={() => onSave({ name: name.trim(), level, radius_m: radiusM, note: note.trim() || null })}
        />
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
    elevation: 6,
    shadowColor: '#000',
    shadowOpacity: 0.25,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 2 },
  },
  body: { padding: space.md, gap: space.md },
  header: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm },
  levels: { flexDirection: 'row', gap: space.sm },
  level: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space.sm,
    padding: space.sm + 2,
    borderRadius: radius.md,
    borderWidth: 1.5,
  },
  dot: { width: 14, height: 14, borderRadius: 7 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs + 2 },
  chip: { minHeight: 40, paddingHorizontal: space.sm + 3, borderRadius: radius.pill, borderWidth: 1.5, alignItems: 'center', justifyContent: 'center' },
});
