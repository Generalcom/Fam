import { useState } from 'react';
import { Alert, View } from 'react-native';

import {
  AuthBody,
  AuthPage,
  AuthTitle,
  PillButton,
  PillField,
  Reveal,
  RingMark,
  SwitchLine,
  Wordmark,
  useHardwareBack,
} from '@/components/auth-ui';
import { useAuth } from '@/providers/auth';
import { useCircle } from '@/providers/circle';

type Step = 'choose' | 'create' | 'join';

export default function Onboarding() {
  const { createCircle, joinCircle } = useCircle();
  const { signOut } = useAuth();
  const [step, setStep] = useState<Step>('choose');
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);

  useHardwareBack(step !== 'choose', () => setStep('choose'));

  async function run(kind: 'create' | 'join', action: () => Promise<void>) {
    setBusy(true);
    try {
      await action();
    } catch (e) {
      Alert.alert(kind === 'create' ? 'Could not create circle' : 'Could not join circle', (e as Error).message);
      setBusy(false);
    }
  }

  if (step === 'choose') {
    return (
      <AuthPage header={<Wordmark />}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 28, paddingVertical: 24 }}>
          <Reveal>
            <RingMark size={112} />
          </Reveal>
          <Reveal delay={120} style={{ gap: 14 }}>
            <AuthTitle hero>{'Bring your family\ntogether.'}</AuthTitle>
            <AuthBody>
              A circle is a private group. Only its members can see each other on the map, and nobody outside it can.
            </AuthBody>
          </Reveal>
        </View>
        <Reveal delay={260} style={{ gap: 12 }}>
          <PillButton title="Create a circle" onPress={() => setStep('create')} />
          <PillButton title="I have an invite code" variant="outline" onPress={() => setStep('join')} />
          <SwitchLine prompt="Not you?" action="Log out" onPress={() => void signOut()} />
        </Reveal>
      </AuthPage>
    );
  }

  const creating = step === 'create';
  return (
    <AuthPage onBack={() => setStep('choose')}>
      <View style={{ gap: 12, marginTop: 24 }}>
        <AuthTitle>{creating ? 'Name your circle' : 'Enter your invite code'}</AuthTitle>
        <AuthBody>
          {creating
            ? "You'll get an invite code to share with your family."
            : 'Ask a family member for the code from their Family tab.'}
        </AuthBody>
      </View>

      <View style={{ gap: 14, marginTop: 32 }}>
        {creating ? (
          <PillField
            label="Circle name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            returnKeyType="go"
            onSubmitEditing={() => name.trim() && !busy && void run('create', () => createCircle(name))}
          />
        ) : (
          <PillField
            label="Invite code"
            value={code}
            onChangeText={(t) => setCode(t.toUpperCase())}
            autoCapitalize="characters"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={() => code.trim() && !busy && void run('join', () => joinCircle(code))}
          />
        )}
        {creating && <AuthBody small>For example, The Zwanes.</AuthBody>}
        <PillButton
          title={creating ? 'Create circle' : 'Join circle'}
          onPress={() => void run(step, () => (creating ? createCircle(name) : joinCircle(code)))}
          loading={busy}
          disabled={(creating ? name : code).trim().length === 0}
        />
      </View>
    </AuthPage>
  );
}
