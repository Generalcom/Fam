import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { FlatList, Pressable, ScrollView, Text, View } from 'react-native';

import { AvatarImage } from '@/components/avatar-image';
import { AuthBody, AuthPage, AuthTitle, PillButton, useAuthTheme } from '@/components/auth-ui';
import {
  AVATAR_PARTS,
  BACKGROUND_COLORS,
  HAIR_COLORS,
  SKIN_COLORS,
  randomAvatar,
  type AvatarConfig,
} from '@/lib/avatar';

type Tab = 'hair' | 'hairColor' | 'face' | 'skin' | 'eyes' | 'brows' | 'nose' | 'mouth' | 'extras' | 'background';

const TABS: { key: Tab; label: string }[] = [
  { key: 'hair', label: 'Hair' },
  { key: 'hairColor', label: 'Hair colour' },
  { key: 'skin', label: 'Skin' },
  { key: 'face', label: 'Face' },
  { key: 'eyes', label: 'Eyes' },
  { key: 'brows', label: 'Brows' },
  { key: 'nose', label: 'Nose' },
  { key: 'mouth', label: 'Mouth' },
  { key: 'extras', label: 'Extras' },
  { key: 'background', label: 'Background' },
];

const TILE = 72;
const GAP = 10;

function Tile({
  selected,
  label,
  onPress,
  children,
}: {
  selected: boolean;
  label: string;
  onPress: () => void;
  children: React.ReactNode;
}) {
  const t = useAuthTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        width: TILE,
        height: TILE,
        borderRadius: TILE / 2,
        borderWidth: selected ? 3 : 1,
        borderColor: selected ? t.text : t.border,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
      {children}
    </Pressable>
  );
}

function NoneMark() {
  const t = useAuthTheme();
  return (
    <View style={{ width: 30, height: 30, borderRadius: 15, borderWidth: 2, borderColor: t.muted, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: 24, height: 2, backgroundColor: t.muted, transform: [{ rotate: '-45deg' }] }} />
    </View>
  );
}

/** `config` is the avatar as it would look with this choice; null draws the "none" tile. */
type Choice = { id: string; label: string; config: AvatarConfig | null };

/** One swipeable row of pictures, each showing the avatar as it would look with that choice. */
function PictureRow({ choices, selectedId, onPick, name }: { choices: Choice[]; selectedId: string; onPick: (id: string) => void; name: string }) {
  return (
    <FlatList
      horizontal
      accessibilityRole="radiogroup"
      accessibilityLabel={name}
      data={choices}
      keyExtractor={(c) => c.id}
      showsHorizontalScrollIndicator={false}
      initialNumToRender={8}
      windowSize={5}
      getItemLayout={(_, index) => ({ length: TILE + GAP, offset: (TILE + GAP) * index, index })}
      initialScrollIndex={Math.max(0, Math.min(choices.findIndex((c) => c.id === selectedId) - 1, choices.length - 1))}
      contentContainerStyle={{ gap: GAP, paddingHorizontal: 24 }}
      style={{ marginHorizontal: -24 }}
      renderItem={({ item }) => (
        <Tile selected={item.id === selectedId} label={item.label} onPress={() => onPick(item.id)}>
          {item.config ? <AvatarImage config={item.config} size={TILE} /> : <NoneMark />}
        </Tile>
      )}
    />
  );
}

function ColorRow({ colors, selected, onPick, name }: { colors: readonly string[]; selected: string; onPick: (c: string) => void; name: string }) {
  const t = useAuthTheme();
  return (
    <ScrollView horizontal showsHorizontalScrollIndicator={false} accessibilityRole="radiogroup" accessibilityLabel={name} contentContainerStyle={{ gap: GAP, paddingHorizontal: 24 }} style={{ marginHorizontal: -24 }}>
      {colors.map((c) => (
        <Pressable
          key={c}
          accessibilityRole="radio"
          accessibilityLabel={`${name} #${c}`}
          accessibilityState={{ selected: c === selected }}
          onPress={() => onPick(c)}
          style={{
            width: 52,
            height: 52,
            borderRadius: 26,
            backgroundColor: `#${c}`,
            borderWidth: c === selected ? 3 : 1,
            borderColor: c === selected ? t.text : t.border,
          }}
        />
      ))}
    </ScrollView>
  );
}

function SectionLabel({ children }: { children: string }) {
  const t = useAuthTheme();
  return <Text style={{ color: t.muted, fontSize: 13, fontWeight: '600', letterSpacing: 0.4, marginBottom: 8, marginTop: 4 }}>{children}</Text>;
}

/**
 * Builds the person's icon: a big live preview, a shuffle button, and a row of parts to change. Used when
 * enrolling and again from Settings.
 */
export function AvatarBuilder({
  initial,
  title,
  body,
  saveLabel,
  onSave,
  onBack,
}: {
  initial: AvatarConfig;
  title: string;
  body: string;
  saveLabel: string;
  onSave: (config: AvatarConfig) => Promise<void>;
  onBack?: () => void;
}) {
  const t = useAuthTheme();
  const [config, setConfig] = useState<AvatarConfig>(initial);
  const [tab, setTab] = useState<Tab>('hair');
  const [busy, setBusy] = useState(false);

  const set = (patch: Partial<AvatarConfig>) => setConfig((c) => ({ ...c, ...patch }));
  const choices = (key: 'hair' | 'head' | 'eyes' | 'eyebrows' | 'nose' | 'mouth', name: string): Choice[] =>
    AVATAR_PARTS[key].map((id, i) => ({ id, label: `${name} ${i + 1}`, config: { ...config, [key]: id } }));
  const optional = (key: 'glasses' | 'beard' | 'earrings', name: string): Choice[] => [
    { id: 'none', label: `No ${name.toLowerCase()}`, config: null },
    ...AVATAR_PARTS[key].map((id, i) => ({ id, label: `${name} ${i + 1}`, config: { ...config, [key]: id } })),
  ];

  async function save() {
    setBusy(true);
    try {
      await onSave(config);
    } finally {
      setBusy(false);
    }
  }

  return (
    <AuthPage onBack={onBack}>
      <View style={{ gap: 10, marginTop: onBack ? 8 : 24 }}>
        <AuthTitle>{title}</AuthTitle>
        <AuthBody small>{body}</AuthBody>
      </View>

      <View style={{ alignItems: 'center', marginTop: 20, marginBottom: 20 }}>
        <View style={{ width: 176, height: 176 }}>
          <AvatarImage config={config} size={176} />
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Surprise me with a random icon"
            onPress={() => setConfig(randomAvatar())}
            style={({ pressed }) => ({
              position: 'absolute',
              right: -6,
              bottom: -6,
              width: 48,
              height: 48,
              borderRadius: 24,
              backgroundColor: t.solidBg,
              alignItems: 'center',
              justifyContent: 'center',
              opacity: pressed ? 0.75 : 1,
            })}>
            <Ionicons name="shuffle" size={24} color={t.solidText} />
          </Pressable>
        </View>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        accessibilityRole="tablist"
        contentContainerStyle={{ gap: 8, paddingHorizontal: 24 }}
        style={{ marginHorizontal: -24, flexGrow: 0 }}>
        {TABS.map((item) => {
          const active = item.key === tab;
          return (
            <Pressable
              key={item.key}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
              onPress={() => setTab(item.key)}
              style={{
                paddingHorizontal: 16,
                height: 40,
                borderRadius: 20,
                justifyContent: 'center',
                backgroundColor: active ? t.solidBg : 'transparent',
                borderWidth: 1,
                borderColor: active ? t.solidBg : t.border,
              }}>
              <Text style={{ color: active ? t.solidText : t.text, fontSize: 15, fontWeight: '600' }}>{item.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={{ marginTop: 18, minHeight: 100, justifyContent: 'center' }}>
        {tab === 'hair' && <PictureRow key="hair" name="Hairstyle" choices={choices('hair', 'Hairstyle')} selectedId={config.hair} onPick={(id) => set({ hair: id })} />}
        {tab === 'hairColor' && <ColorRow name="Hair colour" colors={HAIR_COLORS} selected={config.hairColor} onPick={(c) => set({ hairColor: c })} />}
        {tab === 'skin' && <ColorRow name="Skin tone" colors={SKIN_COLORS} selected={config.skinColor} onPick={(c) => set({ skinColor: c })} />}
        {tab === 'face' && <PictureRow key="face" name="Face shape" choices={choices('head', 'Face shape')} selectedId={config.head} onPick={(id) => set({ head: id })} />}
        {tab === 'eyes' && <PictureRow key="eyes" name="Eyes" choices={choices('eyes', 'Eyes')} selectedId={config.eyes} onPick={(id) => set({ eyes: id })} />}
        {tab === 'brows' && <PictureRow key="brows" name="Eyebrows" choices={choices('eyebrows', 'Eyebrows')} selectedId={config.eyebrows} onPick={(id) => set({ eyebrows: id })} />}
        {tab === 'nose' && <PictureRow key="nose" name="Nose" choices={choices('nose', 'Nose')} selectedId={config.nose} onPick={(id) => set({ nose: id })} />}
        {tab === 'mouth' && <PictureRow key="mouth" name="Mouth" choices={choices('mouth', 'Mouth')} selectedId={config.mouth} onPick={(id) => set({ mouth: id })} />}
        {tab === 'background' && <ColorRow name="Background" colors={BACKGROUND_COLORS} selected={config.backgroundColor} onPick={(c) => set({ backgroundColor: c })} />}
        {tab === 'extras' && (
          <View style={{ gap: 10 }}>
            <View>
              <SectionLabel>GLASSES</SectionLabel>
              <PictureRow key="glasses" name="Glasses" choices={optional('glasses', 'Glasses')} selectedId={config.glasses ?? 'none'} onPick={(id) => set({ glasses: id === 'none' ? null : id })} />
            </View>
            <View>
              <SectionLabel>BEARD</SectionLabel>
              <PictureRow key="beard" name="Beard" choices={optional('beard', 'Beard')} selectedId={config.beard ?? 'none'} onPick={(id) => set({ beard: id === 'none' ? null : id })} />
            </View>
            <View>
              <SectionLabel>EARRINGS</SectionLabel>
              <PictureRow key="earrings" name="Earrings" choices={optional('earrings', 'Earrings')} selectedId={config.earrings ?? 'none'} onPick={(id) => set({ earrings: id === 'none' ? null : id })} />
            </View>
            <Pressable
              accessibilityRole="switch"
              accessibilityLabel="Freckles"
              accessibilityState={{ checked: config.freckles }}
              onPress={() => set({ freckles: !config.freckles })}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 48 }}>
              <Text style={{ color: t.text, fontSize: 16 }}>Freckles</Text>
              <View style={{ width: 52, height: 30, borderRadius: 15, padding: 3, backgroundColor: config.freckles ? t.solidBg : t.border, alignItems: config.freckles ? 'flex-end' : 'flex-start' }}>
                <View style={{ width: 24, height: 24, borderRadius: 12, backgroundColor: config.freckles ? t.solidText : t.background }} />
              </View>
            </Pressable>
          </View>
        )}
      </View>

      <View style={{ flex: 1, minHeight: 24 }} />
      <PillButton title={saveLabel} onPress={() => void save()} loading={busy} />
    </AuthPage>
  );
}
