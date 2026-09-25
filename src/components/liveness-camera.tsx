import { Ionicons } from '@expo/vector-icons';
import { useCameraPermissions } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BackHandler, Linking, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Defs, Ellipse, Mask, Rect } from 'react-native-svg';
import { WebView, type WebViewMessageEvent } from 'react-native-webview';

import { LIVENESS_BASE_URL, LIVENESS_HTML } from '@/components/liveness-html';
import { loadModelChunks } from '@/lib/anti-spoof-models';
import type { LivenessResult } from '@/lib/kyc';

type Progress = {
  phase: 'align' | 'turn' | 'recenter';
  prompt: string;
  hint: string;
  faceOk: boolean;
  step: number;
  total: number;
  direction: 'left' | 'right' | null;
};

type Failure = { code: string; message: string };

const LOAD_TIMEOUT_MS = 45_000;

/**
 * The selfie check: the front camera with an oval guide, asking the person to look straight, then turn their
 * head left and right in a random order. The face tracking runs in a page inside the WebView (see liveness-html).
 */
export function LivenessCamera({ onResult, onCancel }: { onResult: (result: LivenessResult) => void; onCancel: () => void }) {
  const { width, height } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const web = useRef<WebView>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready'>('loading');
  const [progress, setProgress] = useState<Progress | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [spoofTries, setSpoofTries] = useState(0);
  const [flagged, setFlagged] = useState<LivenessResult | null>(null);
  const modelsSent = useRef(false);

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

  const send = useCallback((command: object) => {
    web.current?.injectJavaScript('window.__cmd(' + JSON.stringify(JSON.stringify(command)) + '); true;');
  }, []);

  const begin = useCallback(() => {
    setFailure(null);
    setProgress(null);
    const challenges = Math.random() < 0.5 ? ['left', 'right'] : ['right', 'left'];
    send({ cmd: 'begin', challenges, timeoutMs: 12000, alignTimeoutMs: 30000 });
  }, [send]);

  useEffect(() => {
    if (!permission?.granted || status === 'ready' || failure) return;
    const timer = setTimeout(() => setFailure({ code: 'model-failed', message: 'The face check took too long to load. Check your internet connection.' }), LOAD_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [permission?.granted, status, failure, attempt]);

  // The live-face models are sent in pieces once the page is up, and load while the face model loads.
  async function sendModels() {
    if (modelsSent.current) return;
    modelsSent.current = true;
    for (const chunk of await loadModelChunks()) {
      send({ cmd: 'model', ...chunk });
      await new Promise((resolve) => setTimeout(resolve, 15));
    }
  }

  function onMessage(event: WebViewMessageEvent) {
    let msg: { type: string; [key: string]: unknown };
    try {
      msg = JSON.parse(event.nativeEvent.data);
    } catch {
      return;
    }
    if (msg.type === 'status' && msg.status === 'loading-model') {
      void sendModels();
    } else if (msg.type === 'status' && msg.status === 'ready') {
      setStatus('ready');
      begin();
    } else if (msg.type === 'progress') {
      setProgress(msg as unknown as Progress);
    } else if (msg.type === 'done') {
      const result = msg.result as LivenessResult;
      const spoof = result.antiSpoof;
      if (spoof && !spoof.real) {
        // Looks like a photo or a screen, not a live face. Let them try again; after two tries they may go on, flagged.
        const tries = spoofTries + 1;
        setSpoofTries(tries);
        setFlagged({ ...result, antiSpoof: { ...spoof, attempts: tries, reviewFlag: true } });
        setFailure({
          code: 'spoof',
          message: "We couldn't confirm a live face. Use good light, face the camera, and don't hold up a photo or a screen.",
        });
        return;
      }
      send({ cmd: 'stop' });
      onResult(result);
    } else if (msg.type === 'error') {
      setFailure({ code: String(msg.code), message: String(msg.message) });
    }
  }

  function retry() {
    if (failure && failure.code !== 'timeout' && failure.code !== 'face-lost' && failure.code !== 'spoof') {
      // the camera or the face model never started: load the page again
      modelsSent.current = false;
      setStatus('loading');
      setFailure(null);
      setProgress(null);
      setAttempt((n) => n + 1);
    } else {
      begin();
    }
  }

  if (!permission) return <View style={styles.root} />;

  if (!permission.granted) {
    return (
      <View style={[styles.root, styles.center, { padding: 32, gap: 16 }]}>
        <Ionicons name="camera-outline" size={48} color="#fff" />
        <Text style={styles.title}>Camera access is needed</Text>
        <Text style={styles.body}>We use the front camera for a short selfie check. Nothing is recorded until you finish it.</Text>
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
  const stroke = progress?.faceOk ? '#22C55E' : '#FFFFFF';
  const total = progress?.total ?? 3;
  const doneSteps = progress ? (progress.phase === 'align' ? 0 : progress.step) : 0;

  return (
    <View style={styles.root}>
      <WebView
        key={attempt}
        ref={web}
        source={{ html: LIVENESS_HTML, baseUrl: LIVENESS_BASE_URL }}
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
        onError={() => setFailure({ code: 'model-failed', message: 'The face check could not load.' })}
        onRenderProcessGone={() => setFailure({ code: 'model-failed', message: 'The face check stopped unexpectedly.' })}
      />

      <Svg width={width} height={height} style={StyleSheet.absoluteFill} pointerEvents="none">
        <Defs>
          <Mask id="hole">
            <Rect x={0} y={0} width={width} height={height} fill="white" />
            <Ellipse cx={cx} cy={cy} rx={ovalW / 2} ry={ovalH / 2} fill="black" />
          </Mask>
        </Defs>
        <Rect x={0} y={0} width={width} height={height} fill="rgba(0,0,0,0.66)" mask="url(#hole)" />
        <Ellipse cx={cx} cy={cy} rx={ovalW / 2} ry={ovalH / 2} fill="none" stroke={stroke} strokeWidth={4} />
      </Svg>

      {progress?.phase === 'turn' && progress.direction && !failure && (
        <View pointerEvents="none" style={{ position: 'absolute', top: cy - 28, [progress.direction === 'left' ? 'left' : 'right']: Math.max(8, (width - ovalW) / 2 - 64), width: 56, height: 56, borderRadius: 28, backgroundColor: 'rgba(255,255,255,0.92)', alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name={progress.direction === 'left' ? 'arrow-back' : 'arrow-forward'} size={32} color="#0D0D0D" />
        </View>
      )}

      <View style={styles.top} pointerEvents="box-none">
        <Pressable accessibilityRole="button" accessibilityLabel="Cancel" onPress={onCancel} hitSlop={8} style={styles.close}>
          <Ionicons name="close" size={26} color="#fff" />
        </Pressable>
        <Text accessibilityRole="header" accessibilityLiveRegion="polite" style={styles.prompt}>
          {failure ? 'Let’s try that again' : status === 'loading' ? 'Getting ready…' : (progress?.prompt ?? 'Fit your face in the oval')}
        </Text>
      </View>

      <View style={[styles.bottom, { top: cy + ovalH / 2 + 20 }]} pointerEvents="box-none">
        {failure ? (
          <>
            <Text style={styles.hint}>{failure.message}</Text>
            <Pressable accessibilityRole="button" onPress={retry} style={styles.pill}>
              <Text style={styles.pillText}>Try again</Text>
            </Pressable>
            {failure.code === 'spoof' && spoofTries >= 2 && flagged && (
              <Pressable
                accessibilityRole="button"
                onPress={() => {
                  send({ cmd: 'stop' });
                  onResult(flagged);
                }}
                style={{ minHeight: 48, justifyContent: 'center' }}>
                <Text style={styles.link}>Continue anyway (a person will review it)</Text>
              </Pressable>
            )}
          </>
        ) : (
          <>
            <Text accessibilityLiveRegion="polite" style={styles.hint}>
              {status === 'loading' ? 'Loading the face check. This needs an internet connection.' : (progress?.hint ?? '')}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }} accessibilityLabel={`Step ${Math.min(doneSteps + 1, total)} of ${total}`}>
              {Array.from({ length: total }, (_, i) => (
                <View key={i} style={{ width: 28, height: 6, borderRadius: 3, backgroundColor: i < doneSteps ? '#22C55E' : 'rgba(255,255,255,0.35)' }} />
              ))}
            </View>
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
  title: { color: '#fff', fontSize: 24, fontWeight: '600', textAlign: 'center' },
  body: { color: '#D4D4D4', fontSize: 16, lineHeight: 22, textAlign: 'center' },
  link: { color: '#fff', fontSize: 16, fontWeight: '600', textDecorationLine: 'underline' },
  pill: { minHeight: 52, minWidth: 200, borderRadius: 26, backgroundColor: '#fff', alignItems: 'center', justifyContent: 'center', paddingHorizontal: 28, marginTop: 14 },
  pillText: { color: '#0D0D0D', fontSize: 17, fontWeight: '600' },
});
