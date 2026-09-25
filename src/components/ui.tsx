import type { ReactNode } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text as RNText,
  TextInput,
  View,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { AvatarImage } from '@/components/avatar-image';
import { radius, space, type Theme } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import type { AvatarConfig } from '@/lib/avatar';
import { initial } from '@/lib/format';

type Variant = 'title' | 'heading' | 'body' | 'caption' | 'label';

const textStyles: Record<Variant, TextStyle> = {
  title: { fontSize: 28, lineHeight: 34, fontWeight: '700' },
  heading: { fontSize: 18, lineHeight: 24, fontWeight: '600' },
  body: { fontSize: 16, lineHeight: 22 },
  caption: { fontSize: 13, lineHeight: 18 },
  label: { fontSize: 14, lineHeight: 20, fontWeight: '600' },
};

export function Text({
  variant = 'body',
  color = 'text',
  style,
  ...rest
}: TextProps & { variant?: Variant; color?: keyof Theme }) {
  const theme = useTheme();
  return <RNText style={[textStyles[variant], { color: theme[color] }, style]} {...rest} />;
}

export function Screen({
  children,
  scroll = false,
  style,
}: {
  children: ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const padding = { paddingTop: insets.top + space.md, paddingHorizontal: space.md };

  if (scroll) {
    return (
      <ScrollView
        style={{ backgroundColor: theme.background }}
        contentContainerStyle={[padding, { paddingBottom: space.xl, gap: space.md }, style]}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets>
        {children}
      </ScrollView>
    );
  }
  return (
    <View style={[{ flex: 1, backgroundColor: theme.background }, padding, style]}>{children}</View>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const theme = useTheme();
  return (
    <View
      style={[
        styles.card,
        { backgroundColor: theme.surface, borderColor: theme.border },
        style,
      ]}>
      {children}
    </View>
  );
}

type ButtonVariant = 'primary' | 'secondary' | 'danger';

export function Button({
  title,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  const theme = useTheme();
  const inactive = disabled || loading;
  const bg = variant === 'primary' ? theme.primary : theme.surface;
  const fg = variant === 'primary' ? theme.primaryText : variant === 'danger' ? theme.danger : theme.text;
  const borderColor = variant === 'primary' ? theme.primary : variant === 'danger' ? theme.danger : theme.border;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        { backgroundColor: bg, borderColor, opacity: inactive ? 0.5 : pressed ? 0.85 : 1 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <RNText style={[textStyles.label, { color: fg, fontSize: 16 }]}>{title}</RNText>
      )}
    </Pressable>
  );
}

export function TextField({ label, style, ...rest }: TextInputProps & { label: string }) {
  const theme = useTheme();
  return (
    <View style={{ gap: space.xs }}>
      <Text variant="label">{label}</Text>
      <TextInput
        accessibilityLabel={label}
        placeholderTextColor={theme.textSecondary}
        style={[
          styles.input,
          { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text },
          style,
        ]}
        {...rest}
      />
    </View>
  );
}

export function Avatar({
  name,
  color,
  size = 40,
  dimmed = false,
  avatar = null,
}: {
  name: string;
  color: string;
  size?: number;
  dimmed?: boolean;
  /** The person's chosen icon. Without one, their initial on their colour is drawn. */
  avatar?: AvatarConfig | null;
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        opacity: dimmed ? 0.55 : 1,
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'hidden',
      }}>
      {avatar ? (
        <AvatarImage config={avatar} size={size} />
      ) : (
        <RNText style={{ color: '#FFFFFF', fontWeight: '700', fontSize: size * 0.42 }}>{initial(name)}</RNText>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderWidth: StyleSheet.hairlineWidth,
    borderRadius: radius.lg,
    padding: space.md,
    gap: space.sm,
  },
  button: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  input: {
    minHeight: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingHorizontal: space.md,
    fontSize: 16,
  },
});
