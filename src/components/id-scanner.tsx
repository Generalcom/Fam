import { Ionicons } from '@expo/vector-icons';
import { useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Image, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { ID_SCANNER_BASE_URL, ID_SCANNER_HTML } from '@/components/id-scanner-html';

export type ScanKind = 'sa_card_front' | 'sa_card_back' | 'sa_book' | 'passport';

export type ScanQuality = { light: number; glare: number; sharp: number };

/** What the scanner hands back: the cropped photo and how it was taken. The server reads the text later. */
export type ScanResult = {
  base64: string;
  width: number;
  height: number;
  via: 'auto' | 'manual';
  quality: ScanQuality;
  tilt: number;
};

type Progress = {
  state: 'searching' | 'adjusting' | 'holding';
  hint: string;
  checks: { edges: boolean; size: boolean; sharp: boolean; glare: boolean; steady: boolean };
  hold: number;
};

type Layout = { x: number; y: number; w: number; h: number };

const CHECKS: { key: keyof Progress['checks']; label: string }[] = [
  { key: 'edges', label: 'Edges' },
  { key: 'size', label: 'Position' },
  { key: 'sharp', label: 'Focus' },
  { key: 'glare', label: 'No glare' },
  { key: 'steady', label: 'Steady' },
];

const MANUAL_AFTER_MS = 12_000;
const FALLBACK_AFTER_MS = 30_000;

/**
 * The ID document camera. The page inside the WebView (see id-scanner-html) finds the document, checks focus, glare and
 * light, and takes the photo by itself once it has held still. This screen shows the guidance and lets the person
 * confirm the photo.
 */
export function IdScanner({
  kind,
  title,
  ratio,
  onCapture,
  onCancel,
  onFallback,
}: {
  kind: ScanKind;
  title: string;
  /** Width over height of the document. */
  ratio: number;
  onCapture: (result: ScanResult) => void;
  onCancel: () => void;
  /** Use the ordinary camera instead, when this one cannot start. */
  onFallback: () => void;
}) {
  const { width, height } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const web = useRef<WebView>(null);
  const [ready, setReady] = useState(false);
  const [torchAvailable, setTorchAvailable] = useState(false);
  const [torch, setTorch] = useState(false);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [waited, setWaited] = useState(0);
  const [shot, setShot] = useState<ScanResult | null>(null);

  useEffect(() => {
    if (permission && !permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (shot) retake();
      else onCancel();
      return true;
    });
    return () => sub.remove();
  });

  useEffect(() => {
    if (!ready || shot || failure) return;
    const timer = setInterval(() => setWaited((ms) => ms + 1000), 1000);
    return () => clearInterval(timer);
  }, [ready, shot, failure]);

  const send = useCallback((command: object) => {
    web.current?.injectJavaScript('window.__cmd(' + JSON.stringify(JSON.stringify(command)) + '); true;');
  }, []);

  const begin = useCallback(() => {
    setShot(null);
    setProgress(null);
    setWaited(0);
    send({ cmd: 'begin', kind, ratio });
  }, [send, kind, ratio]);

  function retake() {
    begin();
  }

  function onMessage(event: WebViewMessageEvent) {
    let msg: { type: string; [key: string]: unknown };
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    switch (msg.type) {
      case 'status':
        if (msg.status === 'ready') {
          setReady(true);
          setTorchAvailable(msg.torch === true);
          begin();
        }
        break;
      case 'layout':
        setLayout({ x: Number(msg.x), y: Number(msg.y), w: Number(msg.w), h: Number(msg.h) });
        break;
      case 'progress':
        setProgress(msg as unknown as Progress);
        break;
      case 'captured':
        setShot({
          base64: String(msg.image),
          width: Number(msg.width),
          height: Number(msg.height),
          via: msg.via === 'manual' ? 'manual' : 'auto',
          quality: msg.quality as ScanQuality,
          tilt: Number(msg.tilt ?? 0),
        });
        break;
      case 'error':
        setFailure(String(msg.message));
        break;
    }
  }

  function toggleTorch() {
    setTorch((on) => {
      send({ cmd: 'torch', on: !on });
      return !on;
    });
  }

  function accept() {
    if (!shot) return;
    send({ cmd: 'stop' });
    onCapture(shot);
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
    const q = shot.quality;
    const facts = [
      { ok: q.sharp >= 20, label: 'Sharp' },
      { ok: q.glare < 0.06, label: 'No glare' },
      { ok: q.light >= 60 && q.light <= 225, label: 'Good light' },
    ];
    return (
      <View style={styles.root}>
        <View style={[styles.top, { alignItems: 'center' }]}>
          <Text accessibilityRole="header" style={styles.title}>Is it clear?</Text>
          <Text style={[styles.body, { marginTop: 8 }]}>Every word readable, no glare, all four edges in view.</Text>
        </View>
        <Image source={{ uri: `data:image/jpeg;base64,${shot.base64}` }} resizeMode="contain" accessibilityLabel="Photo of your ID" style={{ position: 'absolute', left: 20, right: 20, top: 140, height: Math.min(height * 0.36, ((width - 40) * shot.height) / shot.width) }} />
        <View style={[styles.reviewPanel, { top: 150 + Math.min(height * 0.36, ((width - 40) * shot.height) / shot.width) }]}>
          <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            {facts.map((f) => (
              <View key={f.label} style={[styles.chip, { backgroundColor: f.ok ? 'rgba(34,197,94,0.22)' : 'rgba(251,191,36,0.22)' }]}>
                <Ionicons name={f.ok ? 'checkmark' : 'alert-circle'} size={14} color={f.ok ? '#4ADE80' : '#FBBF24'} />
                <Text style={styles.chipText}>{f.label}</Text>
              </View>
            ))}
          </View>
        </View>
        <View style={styles.actions}>
          <Pressable accessibilityRole="button" onPress={accept} style={styles.pill}>
            <Text style={styles.pillText}>Use this photo</Text>
          </Pressable>
          <Pressable accessibilityRole="button" onPress={retake} style={{ minHeight: 48, justifyContent: 'center' }}>
            <Text style={styles.link}>Retake</Text>
          </Pressable>
        </View>
      </View>
    );
  }

  const g = layout;
  const hintTop = g ? g.y + g.h + 16 : height * 0.62;
  const stateColor = progress?.state === 'holding' ? '#4ADE80' : progress?.state === 'adjusting' ? '#FBBF24' : '#D4D4D4';

  return (
    <View style={styles.root}>
      <WebView
        ref={web}
        source={{ html: ID_SCANNER_HTML, baseUrl: ID_SCANNER_BASE_URL }}
        style={StyleSheet.absoluteFill}
        javaScriptEnabled
        domStorageEnabled
        originWhitelist={['*']}
        mediaPlaybackRequiresUserAction={false}
        allowsInlineMediaPlayback
        mediaCapturePermissionGrantType="grant"
        scrollEnabled={false}
        bounces={false}
        overScrollMode="never"
        setSupportMultipleWindows={false}
        onMessage={onMessage}
        onError={() => setFailure('The camera page could not load.')}
        onRenderProcessGone={() => setFailure('The camera stopped unexpectedly.')}
      />

      <View style={styles.top} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel} hitSlop={8} style={[styles.iconButton, { left: 12 }]}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        {torchAvailable && (
          <Pressable accessibilityRole="switch" accessibilityLabel="Torch" accessibilityState={{ checked: torch }} onPress={toggleTorch} hitSlop={8} style={[styles.iconButton, { right: 12 }]}>
            <Ionicons name={torch ? 'flash' : 'flash-outline'} size={24} color="#fff" />
          </Pressable>
        )}
        <Text accessibilityRole="header" style={[styles.title, { marginTop: 4 }]}>{title}</Text>
      </View>

      <View style={[styles.hintBox, { top: hintTop }]} pointerEvents="box-none">
        {failure ? (
          <>
            <Text style={[styles.hint, { color: '#FCA5A5' }]}>{failure}</Text>
            <Pressable accessibilityRole="button" onPress={onFallback} style={styles.pill}>
              <Text style={styles.pillText}>Use the basic camera</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text accessibilityLiveRegion="polite" style={[styles.hint, { color: stateColor }]}>
              {!ready ? 'Starting the camera…' : (progress?.hint ?? 'Fit the whole document inside the frame')}
            </Text>
            <View style={styles.chips}>
              {CHECKS.map((c) => {
                const ok = progress?.checks[c.key] === true;
                return (
                  <View key={c.key} style={[styles.chip, { backgroundColor: ok ? 'rgba(34,197,94,0.25)' : 'rgba(255,255,255,0.12)' }]}>
                    <Ionicons name={ok ? 'checkmark' : 'ellipse-outline'} size={13} color={ok ? '#4ADE80' : '#A3A3A3'} />
                    <Text style={[styles.chipText, { color: ok ? '#fff' : '#A3A3A3' }]}>{c.label}</Text>
                  </View>
                );
              })}
            </View>
            <Text style={[styles.body, { marginTop: 10, textAlign: 'center' }]}>
              {kind === 'sa_card_back' ? 'Turn the card over. It is taken automatically.' : 'Lay it flat on a plain, darker surface. It is taken automatically.'}
            </Text>
            {ready && waited * 1000 >= MANUAL_AFTER_MS && (
              <Pressable accessibilityRole="button" onPress={() => send({ cmd: 'snap' })} style={[styles.pill, { marginTop: 14 }]}>
                <Text style={styles.pillText}>Take photo now</Text>
              </Pressable>
            )}
            {waited * 1000 >= FALLBACK_AFTER_MS && (
              <Pressable accessibilityRole="button" onPress={onFallback} style={{ minHeight: 44, justifyContent: 'center' }}>
                <Text style={styles.link}>Trouble? Use the basic camera</Text>
              </Pressable>
            )}
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
  iconButton: { position: 'absolute', top: 48, width: 44, height: 44, alignItems: 'center', justifyContent: 'center', zIndex: 2 },
  title: { color: '#fff', fontSize: 22, lineHeight: 28, fontWeight: '600', textAlign: 'center', marginHorizontal: 44 },
  body: { color: '#D4D4D4', fontSize: 15, lineHeight: 21, textAlign: 'center' },
  hintBox: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 24, alignItems: 'center' },
  hint: { fontSize: 19, lineHeight: 25, fontWeight: '600', textAlign: 'center', minHeight: 26 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center', marginTop: 10 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 10, height: 28, borderRadius: 14 },
  chipText: { color: '#fff', fontSize: 13, fontWeight: '500' },
  reviewPanel: { position: 'absolute', left: 0, right: 0, paddingHorizontal: 24 },
  actions: { position: 'absolute', left: 0, right: 0, bottom: 40, alignItems: 'center', gap: 6, paddingHorizontal: 32 },
  pill: { minHeight: 52, minWidth: 220, borderRadius: 26, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28 },
  pillText: { color: '#0D0D0D', fontSize: 17, fontWeight: '600' },
  link: { color: '#fff', fontSize: 16, fontWeight: '600', textDecorationLine: 'underline' },
});
