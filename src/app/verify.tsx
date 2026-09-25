import { Ionicons } from '@expo/vector-icons';
import { usePreventScreenCapture } from 'expo-screen-capture';
import { useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, Text, View } from 'react-native';

import {
  AuthBody,
  AuthPage,
  AuthTitle,
  PillButton,
  PillField,
  useAuthTheme,
  useHardwareBack,
} from '@/components/auth-ui';
import { IdCamera } from '@/components/id-camera';
import { IdScanner, type ScanKind, type ScanResult } from '@/components/id-scanner';
import { LivenessCamera } from '@/components/liveness-camera';
import type { IdRead } from '@/lib/id-parse';
import { checkPassportNumber, checkSaId, cleanFullName } from '@/lib/id-number';
import { DOCUMENTS, photoSource, submitKyc, type DocumentOption, type LivenessResult, type Photo, type ScanNote } from '@/lib/kyc';
import { useAuth } from '@/providers/auth';
import { useKyc } from '@/providers/kyc';

type Step = 'intro' | 'document' | 'front' | 'back' | 'details' | 'selfie' | 'selfie-camera' | 'sending' | 'failed';

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const niceDate = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

function Row({ icon, text }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string }) {
  const t = useAuthTheme();
  return (
    <View style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start' }}>
      <Ionicons name={icon} size={24} color={t.text} style={{ marginTop: 1 }} />
      <Text style={{ flex: 1, color: t.text, fontSize: 16, lineHeight: 23 }}>{text}</Text>
    </View>
  );
}

function Thumb({ uri, label, onRetake }: { uri: string; label: string; onRetake: () => void }) {
  const t = useAuthTheme();
  return (
    <View style={{ flex: 1, gap: 6 }}>
      <Image source={{ uri }} accessibilityLabel={label} resizeMode="cover" style={{ width: '100%', height: 92, borderRadius: 12, borderWidth: 1, borderColor: t.border, backgroundColor: t.border }} />
      <Pressable accessibilityRole="button" accessibilityLabel={`Retake ${label}`} onPress={onRetake} style={{ minHeight: 36, justifyContent: 'center' }}>
        <Text style={{ color: t.text, fontSize: 14, fontWeight: '600', textDecorationLine: 'underline', textAlign: 'center' }}>Retake {label.toLowerCase()}</Text>
      </Pressable>
    </View>
  );
}

/** The identity check (FICA): ID document photos, the number, and a selfie with a head-turn check. */
export default function Verify() {
  usePreventScreenCapture();
  const t = useAuthTheme();
  const { session } = useAuth();
  const { status, rejectReason, refresh, skipForDev } = useKyc();

  const [step, setStep] = useState<Step>('intro');
  const [agreed, setAgreed] = useState(false);
  const [doc, setDoc] = useState<DocumentOption>(DOCUMENTS[0]);
  const [front, setFront] = useState<Photo | null>(null);
  const [back, setBack] = useState<Photo | null>(null);
  const [frontNote, setFrontNote] = useState<ScanNote | null>(null);
  const [backNote, setBackNote] = useState<ScanNote | null>(null);
  const [frontRead, setFrontRead] = useState<IdRead | null>(null);
  const [prefilled, setPrefilled] = useState(false);
  const [basicCamera, setBasicCamera] = useState(false);
  const [fullName, setFullName] = useState('');
  const [idNumber, setIdNumber] = useState('');
  const [liveness, setLiveness] = useState<LivenessResult | null>(null);
  const [sent, setSent] = useState<{ done: number; total: number }>({ done: 0, total: 1 });
  const [failure, setFailure] = useState('');

  const isPassport = doc.id === 'passport';
  const idCheck = isPassport ? null : checkSaId(idNumber);
  const numberCheck = idCheck ?? checkPassportNumber(idNumber);
  const numberOk = numberCheck.ok;
  const name = cleanFullName(fullName);
  const showNumberError = idNumber.length > 0 && !numberCheck.ok && (isPassport || idNumber.replace(/\s/g, '').length >= 13);
  const numberError = numberCheck.ok ? undefined : numberCheck.reason;
  const canContinue = !!name && numberOk && !!front && (!doc.backTitle || !!back);

  const scanKind = (side: 'front' | 'back'): ScanKind =>
    doc.id === 'sa_id_card' ? (side === 'front' ? 'sa_card_front' : 'sa_card_back') : doc.id === 'sa_id_book' ? 'sa_book' : 'passport';
  const noteOf = (r: ScanResult): ScanNote => ({ via: r.via, sharp: r.quality.sharp, light: r.quality.light, glare: r.quality.glare, tilt: r.tilt });

  useHardwareBack(step === 'document' || step === 'details' || step === 'selfie', () =>
    setStep(step === 'selfie' ? 'details' : step === 'details' ? 'document' : 'intro'),
  );

  async function send(result: LivenessResult) {
    if (!session || !front || !frontNote) return;
    setStep('sending');
    setSent({ done: 0, total: 1 });
    try {
      await submitKyc(
        {
          userId: session.user.id,
          documentType: doc.id,
          fullName: name ?? fullName.trim(),
          idNumber,
          dateOfBirth: idCheck && idCheck.ok ? idCheck.dateOfBirth : null,
          front,
          back: doc.backTitle ? back : null,
          frontNote,
          backNote: doc.backTitle ? backNote : null,
          read: frontRead,
          liveness: result,
        },
        (done, total) => setSent({ done, total }),
      );
      await refresh();
    } catch (e) {
      setFailure((e as Error).message);
      setStep('failed');
    }
  }

  if (step === 'front') {
    const next = () => setStep(doc.backTitle && !back ? 'back' : 'details');
    const cancel = () => setStep(front ? 'details' : 'document');
    if (basicCamera) {
      return (
        <IdCamera
          key="front-basic"
          title={doc.frontTitle}
          hint="Fit the whole document inside the frame. Avoid glare and shadows."
          ratio={doc.ratio}
          onCapture={(uri) => {
            setFront({ uri });
            setFrontNote({ via: 'basic' });
            setFrontRead(null);
            next();
          }}
          onCancel={cancel}
        />
      );
    }
    return (
      <IdScanner
        key="front"
        kind={scanKind('front')}
        title={doc.frontTitle}
        ratio={doc.ratio}
        read
        onCapture={(r) => {
          setFront({ base64: r.base64 });
          setFrontNote(noteOf(r));
          setFrontRead(r.ocrRan ? r.read : null);
          let filled = false;
          if (r.read.idNumber) { setIdNumber(r.read.idNumber); filled = true; }
          if (r.read.fullName) { setFullName(r.read.fullName); filled = true; }
          setPrefilled(filled);
          next();
        }}
        onCancel={cancel}
        onFallback={() => setBasicCamera(true)}
      />
    );
  }
  if (step === 'back' && doc.backTitle) {
    const cancel = () => setStep(back ? 'details' : 'front');
    if (basicCamera) {
      return (
        <IdCamera
          key="back-basic"
          title={doc.backTitle}
          hint="Now turn the card over and fit the back inside the frame."
          ratio={doc.ratio}
          onCapture={(uri) => {
            setBack({ uri });
            setBackNote({ via: 'basic' });
            setStep('details');
          }}
          onCancel={cancel}
        />
      );
    }
    return (
      <IdScanner
        key="back"
        kind={scanKind('back')}
        title={doc.backTitle}
        ratio={doc.ratio}
        read={false}
        onCapture={(r) => {
          setBack({ base64: r.base64 });
          setBackNote(noteOf(r));
          setStep('details');
        }}
        onCancel={cancel}
        onFallback={() => setBasicCamera(true)}
      />
    );
  }
  if (step === 'selfie-camera') {
    return (
      <LivenessCamera
        onResult={(result) => {
          setLiveness(result);
          void send(result);
        }}
        onCancel={() => setStep('selfie')}
      />
    );
  }

  if (step === 'sending') {
    return (
      <AuthPage>
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 20 }}>
          <ActivityIndicator size="large" color={t.text} />
          <AuthTitle>Sending securely</AuthTitle>
          <AuthBody>Uploading photo {Math.min(sent.done + 1, sent.total)} of {sent.total}. Please keep the app open.</AuthBody>
        </View>
      </AuthPage>
    );
  }

  if (step === 'failed') {
    return (
      <AuthPage>
        <View style={{ gap: 12, marginTop: 40 }}>
          <AuthTitle>That didn’t go through</AuthTitle>
          <AuthBody>{failure}</AuthBody>
        </View>
        <View style={{ gap: 12, marginTop: 32 }}>
          <PillButton title="Try again" onPress={() => (liveness ? void send(liveness) : setStep('selfie'))} />
          <PillButton title="Start over" variant="outline" onPress={() => { setLiveness(null); setStep('intro'); }} />
        </View>
      </AuthPage>
    );
  }

  if (step === 'intro') {
    return (
      <AuthPage>
        <View style={{ gap: 12, marginTop: 24 }}>
          <AuthTitle>Verify your identity</AuthTitle>
          <AuthBody>South African law (FICA) requires us to confirm who our customers are. It takes about two minutes.</AuthBody>
        </View>
        {status === 'rejected' && (
          <View style={{ marginTop: 20, padding: 14, borderRadius: 16, borderWidth: 1, borderColor: '#DC2626' }} accessibilityRole="alert">
            <Text style={{ color: t.text, fontSize: 15, lineHeight: 21 }}>
              Your last submission was not accepted{rejectReason ? `: ${rejectReason}` : '.'} Please try again.
            </Text>
          </View>
        )}
        <View style={{ gap: 16, marginTop: 28 }}>
          <Row icon="card-outline" text="Your ID: smart ID card, green ID book or passport" />
          <Row icon="scan-outline" text="A quick selfie, turning your head left and right" />
          <Row icon="sunny-outline" text="Good light and a few quiet minutes" />
        </View>
        <Pressable
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          onPress={() => setAgreed((v) => !v)}
          style={{ flexDirection: 'row', gap: 14, alignItems: 'flex-start', marginTop: 28 }}>
          <View style={{ width: 26, height: 26, borderRadius: 7, borderWidth: 2, borderColor: t.text, backgroundColor: agreed ? t.solidBg : 'transparent', alignItems: 'center', justifyContent: 'center', marginTop: 1 }}>
            {agreed && <Ionicons name="checkmark" size={18} color={t.solidText} />}
          </View>
          <Text style={{ flex: 1, color: t.muted, fontSize: 14, lineHeight: 20 }}>
            I agree that Family Circle may collect my ID photos, my selfie photos and my ID number to verify who I am, and keep them securely for as long as the law requires. Only authorised reviewers can open them.
          </Text>
        </Pressable>
        <View style={{ flex: 1, minHeight: 24 }} />
        <View style={{ gap: 6 }}>
          <PillButton title="Continue" disabled={!agreed} onPress={() => setStep('document')} />
          {__DEV__ && (
            <Pressable accessibilityRole="button" onPress={skipForDev} style={{ minHeight: 44, justifyContent: 'center' }}>
              <Text style={{ color: t.muted, fontSize: 14, textAlign: 'center', textDecorationLine: 'underline' }}>Skip (development builds only)</Text>
            </Pressable>
          )}
        </View>
      </AuthPage>
    );
  }

  if (step === 'document') {
    return (
      <AuthPage onBack={() => setStep('intro')}>
        <View style={{ gap: 12, marginTop: 8 }}>
          <AuthTitle>Choose your document</AuthTitle>
          <AuthBody small>Use a document that is valid, with your photo on it.</AuthBody>
        </View>
        <View style={{ gap: 12, marginTop: 28 }}>
          {DOCUMENTS.map((d) => (
            <Pressable
              key={d.id}
              accessibilityRole="button"
              accessibilityLabel={`${d.title}. ${d.hint}`}
              onPress={() => {
                if (d.id !== doc.id) { setFront(null); setBack(null); setFrontNote(null); setBackNote(null); setFrontRead(null); setPrefilled(false); setIdNumber(''); }
                setDoc(d);
                setStep('front');
              }}
              style={({ pressed }) => ({ flexDirection: 'row', alignItems: 'center', gap: 14, minHeight: 72, paddingHorizontal: 20, borderRadius: 20, borderWidth: 1, borderColor: t.border, opacity: pressed ? 0.7 : 1 })}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: t.text, fontSize: 17, fontWeight: '600' }}>{d.title}</Text>
                <Text style={{ color: t.muted, fontSize: 14, marginTop: 2 }}>{d.hint}</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={t.muted} />
            </Pressable>
          ))}
        </View>
      </AuthPage>
    );
  }

  if (step === 'details') {
    return (
      <AuthPage onBack={() => setStep('document')}>
        <View style={{ gap: 12, marginTop: 8 }}>
          <AuthTitle>Check your details</AuthTitle>
          <AuthBody small>Type them exactly as they appear on your {doc.title}.</AuthBody>
        </View>

        <View style={{ flexDirection: 'row', gap: 12, marginTop: 24 }}>
          {front && <Thumb uri={photoSource(front)} label="Front" onRetake={() => setStep('front')} />}
          {doc.backTitle && back && <Thumb uri={photoSource(back)} label="Back" onRetake={() => setStep('back')} />}
        </View>

        <View style={{ gap: 14, marginTop: 20 }}>
          {prefilled && <AuthBody small>Filled in from your ID. Please check every letter and digit.</AuthBody>}
          <PillField label="Full name" value={fullName} onChangeText={setFullName} autoCapitalize="words" autoComplete="name" textContentType="name" />
          <PillField
            label={doc.numberLabel}
            value={idNumber}
            onChangeText={(v) => setIdNumber(isPassport ? v.toUpperCase() : v.replace(/[^\d\s]/g, ''))}
            keyboardType={isPassport ? 'default' : 'number-pad'}
            autoCapitalize="characters"
            autoCorrect={false}
            maxLength={isPassport ? 14 : 17}
          />
          {showNumberError && (
            <Text accessibilityRole="alert" style={{ color: '#DC2626', fontSize: 14, lineHeight: 20, textAlign: 'center' }}>{numberError}</Text>
          )}
          {idCheck && idCheck.ok && <AuthBody small>Date of birth on this number: {niceDate(idCheck.dateOfBirth)}</AuthBody>}
          <PillButton title="Continue" disabled={!canContinue} onPress={() => setStep('selfie')} />
        </View>
      </AuthPage>
    );
  }

  return (
    <AuthPage onBack={() => setStep('details')}>
      <View style={{ gap: 12, marginTop: 8 }}>
        <AuthTitle>Now a quick selfie</AuthTitle>
        <AuthBody>We’ll ask you to look straight ahead, then turn your head to the left and right.</AuthBody>
      </View>
      <View style={{ gap: 16, marginTop: 28 }}>
        <Row icon="glasses-outline" text="Take off sunglasses, and keep your hair off your face" />
        <Row icon="bulb-outline" text="Face a light so your face is clear" />
        <Row icon="wifi-outline" text="This step needs an internet connection" />
      </View>
      <View style={{ flex: 1, minHeight: 24 }} />
      <PillButton
        title="Start selfie"
        onPress={() => {
          if (!canContinue) return Alert.alert('Something is missing', 'Go back and check your photos and details.');
          setStep('selfie-camera');
        }}
      />
    </AuthPage>
  );
}
