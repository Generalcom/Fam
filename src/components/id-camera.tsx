import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { File } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, BackHandler, Image, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Mask, Rect } from 'react-native-svg';

const MAX_WIDTH = 1600;

/**
 * Takes one photo of an ID document: a guide frame the shape of the document, a torch for poor light, and a review
 * step ("is every word readable?") before the photo is kept. Photos are shrunk to 1600 px wide JPEGs.
 */
export function IdCamera({
  title,
  hint,
  ratio,
  onCapture,
  onCancel,
}: {
  title: string;
  hint: string;
  /** Width over height of the document. */
  ratio: number;
  onCapture: (uri: string) => void;
  onCancel: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const camera = useRef<CameraView>(null);
  const [ready, setReady] = useState(false);
  const [torch, setTorch] = useState(false);
  const [busy, setBusy] = useState(false);
  const [shot, setShot] = useState<{ uri: string; width: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (shot) setShot(null);
      else onCancel();
      return true;
    });
    return () => sub.remove();
  }, [shot, onCancel]);

  const frameW = Math.min(width - 40, 440);
  const frameH = frameW / ratio;
  const cy = height * 0.4;

  async function take() {
    if (!camera.current || busy) return;
    setBusy(true);
    setError(null);
    try {
      const photo = await camera.current.takePictureAsync({ quality: 0.9, skipProcessing: false });
      setShot({ uri: photo.uri, width: photo.width });
    } catch {
      setError('The photo could not be taken. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function keep() {
    if (!shot || busy) return;
    setBusy(true);
    try {
      let context = ImageManipulator.manipulate(shot.uri);
      if (shot.width > MAX_WIDTH) context = context.resize({ width: MAX_WIDTH });
      const rendered = await context.renderAsync();
      const saved = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.8 });
      try {
        new File(shot.uri).delete();
      } catch {
        // the original is in the cache, which the system empties
      }
      onCapture(saved.uri);
    } catch {
      setError('The photo could not be saved. Try again.');
      setBusy(false);
    }
  }

  if (!permission) return <View style={styles.root} />;

  if (!permission.granted) {
    return (
      <View style={[styles.root, styles.center, { padding: 32, gap: 16 }]}>
        <Ionicons name="camera-outline" size={48} color="#fff" />
        <Text style={styles.title}>Camera access is needed</Text>
        <Text style={styles.body}>We use the camera to photograph your ID document.</Text>
        <Pressable accessibilityRole="button" onPress={() => (permission.canAskAgain ? void requestPermission() : void Linking.openSettings())} style={styles.pill}>
          <Text style={styles.pillText}>{permission.canAskAgain ? 'Allow camera' : 'Open Settings'}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onCancel} style={{ minHeight: 44, justifyContent: 'center' }}>
          <Text style={styles.link}>Cancel</Text>
        </Pressable>
      </View>
    );
  }

  if (shot) {
    return (
      <View style={styles.root}>
        <View style={[styles.top, { alignItems: 'center' }]}>
          <Text accessibilityRole="header" style={styles.title}>Is it clear?</Text>
          <Text style={[styles.body, { marginTop: 8 }]}>Every word readable, no glare, all four edges in view.</Text>
        </View>
        <Image source={{ uri: shot.uri }} resizeMode="contain" accessibilityLabel="Photo of your ID" style={{ position: 'absolute', left: 20, right: 20, top: 150, height: height - 340 }} />
        <View style={styles.actions}>
          {error && <Text style={styles.error}>{error}</Text>}
          <Pressable accessibilityRole="button" onPress={() => void keep()} disabled={busy} style={[styles.pill, { opacity: busy ? 0.6 : 1 }]}>
            {busy ? <ActivityIndicator color="#0D0D0D" /> : <Text style={styles.pillText}>Use this photo</Text>}
          </Pressable>
          <Pressable accessibilityRole="button" onPress={() => setShot(null)} disabled={busy} style={{ minHeight: 48, justifyContent: 'center' }}>
            <Text style={styles.link}>Retake</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <CameraView ref={camera} style={StyleSheet.absoluteFill} facing="back" enableTorch={torch} onCameraReady={() => setReady(true)} />
      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <Mask id="window">
            <Rect x={0} y={0} width={width} height={height} fill="white" />
            <Rect x={(width - frameW) / 2} y={cy - frameH / 2} width={frameW} height={frameH} rx={14} fill="black" />
          </Mask>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="rgba(0,0,0,0.62)" mask="url(#window)" />
        <Rect x={(width - frameW) / 2} y={cy - frameH / 2} width={frameW} height={frameH} rx={14} fill="none" stroke="#fff" strokeWidth={3} />
      </Svg>

      <View style={styles.top} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel} hitSlop={8} style={[styles.iconButton, { left: 12 }]}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <Pressable accessibilityRole="switch" accessibilityLabel="Torch" accessibilityState={{ checked: torch }} onPress={() => setTorch((v) => !v)} hitSlop={8} style={[styles.iconButton, { right: 12 }]}>
          <Ionicons name={torch ? 'flash' : 'flash-outline'} size={24} color="#fff" />
        </Pressable>
        <Text accessibilityRole="header" style={[styles.title, { marginTop: 4 }]}>{title}</Text>
      </View>

      <View style={[styles.hintBox, { top: cy + frameH / 2 + 18 }]} pointerEvents="none">
        <Text style={styles.body}>{hint}</Text>
      </View>

      <View style={styles.actions}>
        {error && <Text style={styles.error}>{error}</Text>}
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Take photo"
          onPress={() => void take()}
          disabled={!ready || busy}
          style={({ pressed }) => [styles.shutter, { opacity: !ready || busy ? 0.5 : pressed ? 0.8 : 1 }]}>
          {busy ? <ActivityIndicator color="#0D0D0D" /> : <View style={styles.shutterInner} />}
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: '#000' },
  center: { alignItems: 'center', justifyContent: 'center' },
  top: { position: 'absolute', top: 0, left: 0, right: 0, paddingTop: 56, paddingHorizontal: 24, alignItems: 'center' },
  iconButton: { position: 'absolute', top: 48, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  title: { color: '#fff', fontSize: 22, lineHeight: 28, fontWeight: '600', textAlign: 'center', marginHorizontal: 44 },
  body: { color: '#D4D4D4', fontSize: 16, lineHeight: 22, textAlign: 'center' },
  hintBox: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 32 },
  actions: { position: 'absolute', left: 0, right: 0, bottom: 40, alignItems: 'center', gap: 6, paddingHorizontal: 32 },
  error: { color: '#FCA5A5', fontSize: 15, textAlign: 'center', marginBottom: 6 },
  shutter: { width: 76, height: 76, borderRadius: 38, borderWidth: 4, borderColor: '#fff', alignItems: 'center', justifyContent: 'center' },
  shutterInner: { width: 58, height: 58, borderRadius: 29, backgroundColor: '#fff' },
  pill: { minHeight: 52, minWidth: 220, borderRadius: 26, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  pillText: { color: '#0D0D0D', fontSize: 17, fontWeight: '600' },
  link: { color: '#fff', fontSize: 16, fontWeight: '600', textDecorationLine: 'underline' },
});
