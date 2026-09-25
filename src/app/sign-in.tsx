import { useState } from 'react';
import { Alert, View } from 'react-native';

import {
  AuthBody,
  AuthPage,
  AuthTitle,
  OrDivider,
  PillButton,
  PillField,
  Reveal,
  RingMark,
  SwitchLine,
  Wordmark,
  useHardwareBack,
} from '@/components/auth-ui';
import { useAuth } from '@/providers/auth';

type Step = 'landing' | 'name' | 'log-in' | 'sign-up';

export default function SignIn() {
  const { signInAsGuest, signIn, signUp } = useAuth();
  const [step, setStep] = useState<Step>('landing');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const isGuest = step === 'name';
  const isSignUp = step === 'sign-up';
  const needsName = isGuest || isSignUp;
  const canSubmit =
    (!needsName || name.trim().length > 0) &&
    (isGuest || (email.trim().length > 0 && password.length >= 6));

  useHardwareBack(step !== 'landing', () => setStep('landing'));

  async function submit() {
    setBusy(true);
    try {
      if (isGuest) {
        await signInAsGuest(name);
      } else if (isSignUp) {
        const needsConfirmation = await signUp(name, email, password);
        if (needsConfirmation) {
          Alert.alert('Check your email', 'Confirm your address, then log in.');
          setStep('log-in');
        }
      } else {
        await signIn(email, password);
      }
    } catch (e) {
      Alert.alert(isSignUp ? 'Could not create account' : 'Could not log in', (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (step === 'landing') {
    return (
      <AuthPage header={<Wordmark />}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: 28, paddingVertical: 24 }}>
          <Reveal>
            <RingMark size={112} />
          </Reveal>
          <Reveal delay={120} style={{ gap: 14 }}>
            <AuthTitle hero>{'Your family,\non one map.'}</AuthTitle>
            <AuthBody>Share where you are with the people you choose, and pause any time.</AuthBody>
          </Reveal>
        </View>
        <Reveal delay={260} style={{ gap: 12 }}>
          <PillButton title="Get started" onPress={() => setStep('name')} />
          <PillButton title="Log in" variant="outline" onPress={() => setStep('log-in')} />
          <AuthBody small>No email or password needed to start.</AuthBody>
        </Reveal>
      </AuthPage>
    );
  }

  const title = isGuest ? 'What should we call you?' : isSignUp ? 'Create your account' : 'Welcome back';

  return (
    <AuthPage onBack={() => setStep('landing')}>
      <View style={{ gap: 12, marginTop: 24 }}>
        <AuthTitle>{title}</AuthTitle>
        {isGuest && <AuthBody>This is the name your family sees on the map.</AuthBody>}
      </View>

      <View style={{ gap: 14, marginTop: 32 }}>
        {needsName && (
          <PillField
            label="Your name"
            value={name}
            onChangeText={setName}
            autoCapitalize="words"
            autoComplete="name"
            returnKeyType={isGuest ? 'go' : 'next'}
            onSubmitEditing={() => isGuest && canSubmit && void submit()}
          />
        )}
        {!isGuest && (
          <>
            <PillField
              label="Email"
              value={email}
              onChangeText={setEmail}
              autoCapitalize="none"
              autoComplete="email"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
            />
            <PillField
              label="Password"
              value={password}
              onChangeText={setPassword}
              secureTextEntry
              autoCapitalize="none"
              autoComplete={isSignUp ? 'new-password' : 'current-password'}
              textContentType={isSignUp ? 'newPassword' : 'password'}
              returnKeyType="go"
              onSubmitEditing={() => canSubmit && void submit()}
            />
          </>
        )}
        {isSignUp && <AuthBody small>Use at least 6 characters for your password.</AuthBody>}
        <PillButton title="Continue" onPress={() => void submit()} loading={busy} disabled={!canSubmit} />
        {isGuest && <AuthBody small>No email or password needed for now.</AuthBody>}
      </View>

      <View style={{ gap: 12, marginTop: 20 }}>
        {step === 'log-in' && (
          <SwitchLine prompt="Don't have an account?" action="Sign up" onPress={() => setStep('sign-up')} />
        )}
        {isSignUp && <SwitchLine prompt="Already have an account?" action="Log in" onPress={() => setStep('log-in')} />}
        <OrDivider />
        {isGuest ? (
          <PillButton title="Log in with email" variant="outline" onPress={() => setStep('log-in')} />
        ) : (
          <PillButton title="Continue with just my name" variant="outline" onPress={() => setStep('name')} />
        )}
      </View>
    </AuthPage>
  );
}
