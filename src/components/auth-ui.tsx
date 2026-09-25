import { useEffect, useState, type ReactNode } from 'react';
import {
  AccessibilityInfo,
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useColorScheme,
  type StyleProp,
  type TextInputProps,
  type ViewStyle,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { authPalette, type AuthTheme } from '@/constants/theme';

export function useAuthTheme(): AuthTheme {
  return useColorScheme() === 'dark' ? authPalette.dark : authPalette.light;
}

/** Android's back button steps back within a screen that has several steps, instead of leaving the app. */
export function useHardwareBack(active: boolean, onBack: () => void) {
  useEffect(() => {
    if (!active) return;
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [active, onBack]);
}

export function AuthPage({
  children,
  header,
  onBack,
}: {
  children: ReactNode;
  /** Shown top left when there is no back button. */
  header?: ReactNode;
  onBack?: () => void;
}) {
  const t = useAuthTheme();
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={{ backgroundColor: t.background }}
      contentContainerStyle={{
        flexGrow: 1,
        paddingTop: insets.top + 12,
        paddingBottom: insets.bottom + 24,
        paddingHorizontal: 24,
      }}
      keyboardShouldPersistTaps="handled"
      automaticallyAdjustKeyboardInsets>
      <View style={styles.column}>
        <View style={styles.topBar}>{onBack ? <BackButton onPress={onBack} /> : header}</View>
        {children}
      </View>
    </ScrollView>
  );
}

function BackButton({ onPress }: { onPress: () => void }) {
  const t = useAuthTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={onPress}
      hitSlop={8}
      style={({ pressed }) => [styles.back, { opacity: pressed ? 0.5 : 1 }]}>
      <View
        style={{
          width: 12,
          height: 12,
          marginLeft: 5,
          borderLeftWidth: 2,
          borderBottomWidth: 2,
          borderColor: t.text,
          transform: [{ rotate: '45deg' }],
        }}
      />
    </Pressable>
  );
}

/** Eight dots in a ring: the family, gathered. */
export function RingMark({ size = 96 }: { size?: number }) {
  const t = useAuthTheme();
  const count = 8;
  const dot = size * 0.15;
  const ring = (size - dot) / 2;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size }}>
      {Array.from({ length: count }, (_, i) => {
        const angle = (i / count) * Math.PI * 2 - Math.PI / 2;
        return (
          <View
            key={i}
            style={{
              position: 'absolute',
              width: dot,
              height: dot,
              borderRadius: dot / 2,
              backgroundColor: t.text,
              left: size / 2 + ring * Math.cos(angle) - dot / 2,
              top: size / 2 + ring * Math.sin(angle) - dot / 2,
            }}
          />
        );
      })}
    </View>
  );
}

export function Wordmark() {
  const t = useAuthTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
      <RingMark size={26} />
      <Text style={{ color: t.text, fontSize: 17, fontWeight: '600', letterSpacing: -0.2 }}>Family Circle</Text>
    </View>
  );
}

/** Fades and lifts its content into place once, unless the phone is set to reduce motion. */
export function Reveal({ delay = 0, children, style }: { delay?: number; children: ReactNode; style?: StyleProp<ViewStyle> }) {
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    let cancelled = false;
    void AccessibilityInfo.isReduceMotionEnabled().then((reduce) => {
      if (cancelled) return;
      if (reduce) progress.setValue(1);
      else
        Animated.timing(progress, {
          toValue: 1,
          duration: 520,
          delay,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }).start();
    });
    return () => {
      cancelled = true;
    };
  }, [progress, delay]);
  return (
    <Animated.View
      style={[
        { opacity: progress, transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) }] },
        style,
      ]}>
      {children}
    </Animated.View>
  );
}

export function AuthTitle({ children, hero = false }: { children: ReactNode; hero?: boolean }) {
  const t = useAuthTheme();
  return (
    <Text
      accessibilityRole="header"
      style={{
        color: t.text,
        textAlign: 'center',
        fontWeight: '600',
        fontSize: hero ? 40 : 32,
        lineHeight: hero ? 45 : 38,
        letterSpacing: hero ? -1.2 : -0.8,
      }}>
      {children}
    </Text>
  );
}

export function AuthBody({ children, small = false }: { children: ReactNode; small?: boolean }) {
  const t = useAuthTheme();
  return (
    <Text
      style={{
        color: t.muted,
        textAlign: 'center',
        fontSize: small ? 14 : 17,
        lineHeight: small ? 20 : 24,
      }}>
      {children}
    </Text>
  );
}

export function PillButton({
  title,
  onPress,
  variant = 'solid',
  loading = false,
  disabled = false,
}: {
  title: string;
  onPress: () => void;
  variant?: 'solid' | 'outline';
  loading?: boolean;
  disabled?: boolean;
}) {
  const t = useAuthTheme();
  const solid = variant === 'solid';
  const inactive = disabled || loading;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled: inactive, busy: loading }}
      disabled={inactive}
      onPress={onPress}
      style={({ pressed }) => [
        styles.pill,
        {
          backgroundColor: solid ? t.solidBg : 'transparent',
          borderColor: solid ? t.solidBg : t.border,
          opacity: inactive ? 0.4 : pressed ? 0.75 : 1,
        },
      ]}>
      {loading ? (
        <ActivityIndicator color={solid ? t.solidText : t.text} />
      ) : (
        <Text style={[styles.pillText, { color: solid ? t.solidText : t.text }]}>{title}</Text>
      )}
    </Pressable>
  );
}

/** A rounded field whose label sits inside it and floats up once there is something to label. */
export function PillField({
  label,
  value,
  onFocus,
  onBlur,
  style,
  ...rest
}: TextInputProps & { label: string; value: string }) {
  const t = useAuthTheme();
  const [focused, setFocused] = useState(false);
  const raised = focused || value.length > 0;
  const [lift] = useState(() => new Animated.Value(raised ? 1 : 0));
  useEffect(() => {
    Animated.timing(lift, { toValue: raised ? 1 : 0, duration: 140, useNativeDriver: true }).start();
  }, [raised, lift]);

  return (
    <View style={[styles.field, { borderColor: focused ? t.text : t.border }]}>
      <Animated.Text
        numberOfLines={1}
        style={[
          styles.fieldLabel,
          {
            color: t.muted,
            transform: [
              { translateY: lift.interpolate({ inputRange: [0, 1], outputRange: [0, -11] }) },
              { scale: lift.interpolate({ inputRange: [0, 1], outputRange: [1, 0.78] }) },
            ],
            transformOrigin: 'left center',
          },
        ]}>
        {label}
      </Animated.Text>
      <TextInput
        accessibilityLabel={label}
        value={value}
        onFocus={(e) => {
          setFocused(true);
          onFocus?.(e);
        }}
        onBlur={(e) => {
          setFocused(false);
          onBlur?.(e);
        }}
        selectionColor={t.text}
        cursorColor={t.text}
        underlineColorAndroid="transparent"
        style={[styles.input, { color: t.text }, style]}
        {...rest}
      />
    </View>
  );
}

export function OrDivider() {
  const t = useAuthTheme();
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 16 }} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />
      <Text style={{ color: t.muted, fontSize: 13, fontWeight: '500', letterSpacing: 0.6 }}>OR</Text>
      <View style={{ flex: 1, height: StyleSheet.hairlineWidth, backgroundColor: t.border }} />
    </View>
  );
}

/** "Don't have an account? Sign up" */
export function SwitchLine({ prompt, action, onPress }: { prompt: string; action: string; onPress: () => void }) {
  const t = useAuthTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${prompt} ${action}`}
      onPress={onPress}
      style={({ pressed }) => [styles.switchLine, { opacity: pressed ? 0.6 : 1 }]}>
      <Text style={{ color: t.muted, fontSize: 15, textAlign: 'center' }}>
        {prompt}{' '}
        <Text style={{ color: t.text, fontWeight: '600', textDecorationLine: 'underline' }}>{action}</Text>
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  column: { flexGrow: 1, width: '100%', maxWidth: 440, alignSelf: 'center' },
  topBar: { height: 44, justifyContent: 'center' },
  back: { width: 44, height: 44, marginLeft: -12, alignItems: 'center', justifyContent: 'center' },
  pill: {
    minHeight: 56,
    borderRadius: 28,
    borderWidth: 1,
    paddingHorizontal: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pillText: { fontSize: 17, fontWeight: '600', letterSpacing: -0.1 },
  field: { height: 60, borderRadius: 30, borderWidth: 1.5, justifyContent: 'center' },
  fieldLabel: { position: 'absolute', left: 22, right: 22, fontSize: 16 },
  input: {
    height: '100%',
    paddingTop: 22,
    paddingBottom: 6,
    paddingHorizontal: 22,
    fontSize: 16,
    includeFontPadding: false,
    outlineWidth: 0,
  },
  switchLine: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
});
