import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Ellipse, Mask, Rect } from 'react-native-svg';

import type { SelfieResult } from '@/lib/kyc';

type Pose = 'center' | 'left' | 'right';

const PROMPTS: Record<Pose, { title: string; hint: string }> = {
  center: { title: 'Look straight at the camera', hint: 'Keep your whole face inside the oval' },
  left: { title: 'Turn your head to your left', hint: 'About halfway, keep your eyes open' },
  right: { title: 'Turn your head to your right', hint: 'About halfway, keep your eyes open' },
};

/** Seconds counted down before each photo, so the person has time to move. */
const COUNTDOWN = 3;
const MAX_WIDTH = 720;

/**
 * The selfie: three photos with the front camera (straight ahead, then the head turned left and right in a random
 * order), taken on a countdown. Nothing is checked on the phone and nothing is downloaded: the photos are uploaded and
 * the identity-check server (server/kyc-worker) looks at the head turns, checks for a printed photo or a screen, and
 * compares the face with the ID photo.
 */
export function SelfieCamera({ onResult, onCancel }: { onResult: (result: SelfieResult) => void; onCancel: () => void }) {
  const { width, height } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [order] = useState<Pose[]>(() => ['center', ...(Math.random() < 0.5 ? (['left', 'right'] as const) : (['right', 'left'] as const))]);
  const [index, setIndex] = useState(-1); // -1 until the person presses Start
  const [count, setCount] = useState(COUNTDOWN);
  const [error, setError] = useState<string | null>(null);
  const shots = useRef<Partial<Record<Pose, string>>>({});
  const startedAt = useRef(0);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      onCancel();
      return true;
    });
    return () => sub.remove();
  }, [onCancel]);

  // Count down, then take the photo for this pose and move to the next.
  useEffect(() => {
    if (index < 0 || index >= order.length || error) return;
    if (count > 0) {
      const timer = setTimeout(() => setCount((c) => c - 1), 1000);
      return () => clearTimeout(timer);
    }
    let cancelled = false;
    void take(order[index]).then((ok) => {
      if (cancelled || !ok) return;
      if (index + 1 < order.length) {
        setIndex(index + 1);
        setCount(COUNTDOWN);
      } else {
        const s = shots.current;
        onResult({
          center: s.center!,
          left: s.left!,
          right: s.right!,
          order: order.slice(1) as ('left' | 'right')[],
          durationMs: Date.now() - startedAt.current,
        });
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, count, error]);

  async function take(pose: Pose): Promise<boolean> {
    try {
      const photo = await camera.current!.takePictureAsync({ quality: 0.85, shutterSound: false });
      let context = ImageManipulator.manipulate(photo.uri);
      if (photo.width > MAX_WIDTH) context = context.resize({ width: MAX_WIDTH });
      const saved = await (await context.renderAsync()).saveAsync({ format: SaveFormat.JPEG, compress: 0.85, base64: true });
      for (const uri of [photo.uri, saved.uri]) {
        try {
          new File(uri).delete();
        } catch {
          // the cache is cleared by the system anyway
        }
      }
      if (!saved.base64) throw new Error('no image data');
      shots.current[pose] = saved.base64;
      return true;
    } catch {
      setError('The photo could not be taken. Try again.');
      return false;
    }
  }

  function start() {
    shots.current = {};
    startedAt.current = Date.now();
    setError(null);
    setCount(COUNTDOWN);
    setIndex(0);
  }

  if (!permission) return <View style={styles.root} />;

  if (!permission.granted) {
    return (
      <View style={[styles.root, styles.center, { padding: 32, gap: 16 }]}>
        <Ionicons name="camera-outline" size={48} color="#fff" />
        <Text style={styles.title}>Camera access is needed</Text>
        <Text style={styles.body}>We use the front camera for three quick selfie photos.</Text>
        <Pressable accessibilityRole="button" onPress={() => (permission.canAskAgain ? void requestPermission() : void Linking.openSettings())} style={styles.pill}>
          <Text style={styles.pillText}>{permission.canAskAgain ? 'Allow camera' : 'Open Settings'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onCancel} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  const ovalW = Math.min(width * 0.72, 320);
  const ovalH = ovalW * 1.3;
  const cx = width / 2;
  const cy = height * 0.42;
  const pose = index >= 0 && index < order.length ? order[index] : null;
  const prompt = pose ? PROMPTS[pose] : null;
  const busy = pose !== null && count === 0 && !error;
  // The preview is mirrored, so the person's left is on the left of the screen.
  const arrow = pose === 'left' ? 'arrow-back' : pose === 'right' ? 'arrow-forward' : null;

  return (
    <View style={styles.root}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="front" onCameraReady={() => setReady(true)} />

      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <Mask id="hole">
            <Rect x={0} y={0} width={width} height={height} fill="white" />
            <Ellipse cx={cx} cy={cy} rx={ovalW / 2} ry={ovalH / 2} fill="black" />
          </Mask>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="rgba(0,0,0,0.66)" mask="url(#hole)" />
        <Ellipse cx={cx} cy={cy} rx={ovalW / 2} ry={ovalH / 2} fill="none" stroke={busy ? '#22C55E' : '#FFFFFF'} strokeWidth={4} />
      </Svg>

      {arrow && !error && (
        <View pointerEvents="none" style={[styles.arrow, { top: cy - 28, [pose === 'left' ? 'left' : 'right']: Math.max(8, (width - ovalW) / 2 - 64) }]}>
          <Ionicons name={arrow} size={32} color="#0D0D0D" />
        </View>
      )}

      {pose && count > 0 && !error && (
        <View pointerEvents="none" style={[styles.count, { top: cy - 40, left: cx - 40 }]}>
          <Text style={styles.countText}>{count}</Text>
        </View>
      )}

      <View style={styles.top} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel} hitSlop={8} style={styles.close}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.prompt}>
          {error ? 'Let’s try that again' : (prompt?.title ?? 'Three quick photos')}
        </Text>
      </View>

      <View style={[styles.bottom, { top: cy + ovalH / 2 + 20 }]} pointerEvents="box-none">
        {error ? (
          <>
            <Text style={styles.hint}>{error}</Text>
            <Pressable accessibilityRole="button" onPress={start} style={styles.pill}>
              <Text style={styles.pillText}>Try again</Text>
            </Pressable>
          </>
        ) : pose ? (
          <>
            <Text accessibilityLiveRegion="polite" style={styles.hint}>
              {busy ? 'Hold it…' : prompt!.hint}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }} accessibilityLabel={`Photo ${index + 1} of ${order.length}`}>
              {order.map((p, i) => (
                <View key={p} style={{ width: 28, height: 6, borderRadius: 3, backgroundColor: i < index ? '#22C55E' : 'rgba(255,255,255,0.35)' }} />
              ))}
            </View>
            {busy && <ActivityIndicator color="#fff" style={{ marginTop: 12 }} />}
          </>
        ) : (
          <>
            <Text style={styles.hint}>Fit your face in the oval. We’ll count down before each photo.</Text>
            <Pressable accessibilityRole="button" onPress={start} disabled={!ready} style={[styles.pill, { opacity: ready ? 1 : 0.5 }]}>
              <Text style={styles.pillText}>{ready ? 'Start' : 'Starting the camera…'}</Text>
            </Pressable>
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 56, paddingHorizontal: 24, alignItems: 'center' },
  close: { position: 'absolute', top: 48, left: 12, width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  prompt: { color: '#fff', fontSize: 24, lineHeight: 30, fontWeight: '600', textAlign: 'center', marginTop: 4, marginHorizontal: 40 },
  bottom: { position: 'absolute', left: 0, right: 0, alignItems: 'center', paddingHorizontal: 32 },
  hint: { color: '#FDE68A', fontSize: 17, lineHeight: 23, textAlign: 'center', minHeight: 24 },
  arrow: { position: 'absolute', width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' },
  count: { position: 'absolute', width: 80, height: 80, borderRadius: 40, backgroundColor: 'rgba(0,0,0,0.45)', alignItems: 'center', justifyContent: 'center' },
  countText: { color: '#fff', fontSize: 44, fontWeight: '700' },
  title: { color: '#fff', fontSize: 24, fontWeight: '600', textAlign: 'center' },
  body: { color: '#D4D4D4', fontSize: 16, lineHeight: 22, textAlign: 'center' },
  link: { color: '#fff', fontSize: 16, fontWeight: '600', textDecorationLine: 'underline' },
  pill: { minHeight: 52, minWidth: 200, borderRadius: 26, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, marginTop: 14 },
  pillText: { color: '#0D0D0D', fontSize: 17, fontWeight: '600' },
});
