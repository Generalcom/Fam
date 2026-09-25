import '@/lib/location';

import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useEffect, type ReactNode } from 'react';
import { Pressable, Text, View } from 'react-native';

import { AuthBody, AuthPage, AuthTitle, PillButton, useAuthTheme } from '@/components/auth-ui';
import { Button, Screen, Text as UiText } from '@/components/ui';
import { REQUIRE_KYC } from '@/lib/kyc';
import { isConfigured } from '@/lib/supabase';
import { AuthProvider, useAuth } from '@/providers/auth';
import { CircleProvider, useCircle } from '@/providers/circle';
import { KycProvider, useKyc } from '@/providers/kyc';

SplashScreen.preventAutoHideAsync();

export default function RootLayout() {
  if (!isConfigured) return <SetupNeeded />;
  return (
    <AuthProvider>
      <KeyedByUser>
        <Navigator />
      </KeyedByUser>
    </AuthProvider>
  );
}

// Remounting per user guarantees no circle/location state leaks between accounts.
function KeyedByUser({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  return (
    <CircleProvider key={session?.user.id ?? 'signed-out'}>
      <KycProvider>{children}</KycProvider>
    </CircleProvider>
  );
}

function Navigator() {
  const { session, loading: authLoading } = useAuth();
  const { circle, me, avatarSupported, loading: circleLoading, loadError, reload } = useCircle();
  const kyc = useKyc();

  const ready = !authLoading && !(session && (circleLoading || (REQUIRE_KYC && kyc.status === 'loading')));
  useEffect(() => {
    if (ready) void SplashScreen.hideAsync();
  }, [ready]);

  if (!ready) return null;

  if (session && loadError && !circle) {
    return (
      <Screen style={{ justifyContent: 'center', gap: 16 }}>
        <UiText variant="title">Can't reach your circle</UiText>
        <UiText color="textSecondary">{loadError}</UiText>
        <Button title="Try again" onPress={() => void reload()} />
        <StatusBar style="auto" />
      </Screen>
    );
  }

  const checksKyc = REQUIRE_KYC && !kyc.skipped;
  if (session && !kyc.skipped && (!avatarSupported || (checksKyc && kyc.status === 'missing'))) {
    return <EnrolmentSetup onRetry={() => void Promise.all([reload(), kyc.refresh()])} onSkip={kyc.skipForDev} />;
  }
  if (session && checksKyc && kyc.status === 'error') {
    return (
      <Screen style={{ justifyContent: 'center', gap: 16 }}>
        <UiText variant="title">Can't check your verification</UiText>
        <UiText color="textSecondary">Check your internet connection and try again.</UiText>
        <Button title="Try again" onPress={() => void kyc.refresh()} />
        <StatusBar style="auto" />
      </Screen>
    );
  }

  const signedIn = !!session;
  const needsAvatar = signedIn && avatarSupported && !me?.avatar;
  const needsVerify = signedIn && checksKyc && (kyc.status === 'none' || kyc.status === 'rejected');
  const enrolled = signedIn && !needsAvatar && !needsVerify;

  return (
    <>
      <StatusBar style="auto" />
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Protected guard={!signedIn}>
          <Stack.Screen name="sign-in" />
        </Stack.Protected>
        <Stack.Protected guard={needsAvatar}>
          <Stack.Screen name="avatar" />
        </Stack.Protected>
        <Stack.Protected guard={signedIn && !needsAvatar && needsVerify}>
          <Stack.Screen name="verify" />
        </Stack.Protected>
        <Stack.Protected guard={enrolled && !circle}>
          <Stack.Screen name="onboarding" />
        </Stack.Protected>
        <Stack.Protected guard={enrolled && !!circle}>
          <Stack.Screen name="(tabs)" />
          <Stack.Screen name="edit-avatar" options={{ presentation: 'modal' }} />
        </Stack.Protected>
      </Stack>
    </>
  );
}

function EnrolmentSetup({ onRetry, onSkip }: { onRetry: () => void; onSkip: () => void }) {
  const t = useAuthTheme();
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  return (
    <AuthPage>
      <View style={{ gap: 12, marginTop: 48 }}>
        <AuthTitle>One more setup step</AuthTitle>
        <AuthBody>
          The database needs the enrolment update. Open the Supabase SQL editor and run supabase/enrolment.sql, then try again.
        </AuthBody>
      </View>
      <View style={{ gap: 8, marginTop: 32 }}>
        <PillButton title="Try again" onPress={onRetry} />
        {__DEV__ && (
          <Pressable accessibilityRole="button" onPress={onSkip} style={{ minHeight: 44, justifyContent: 'center' }}>
            <Text style={{ color: t.muted, fontSize: 14, textAlign: 'center', textDecorationLine: 'underline' }}>
              Skip for now (development builds only)
            </Text>
          </Pressable>
        )}
      </View>
      <StatusBar style="auto" />
    </AuthPage>
  );
}

function SetupNeeded() {
  useEffect(() => {
    void SplashScreen.hideAsync();
  }, []);
  return (
    <Screen style={{ justifyContent: 'center', gap: 12 }}>
      <UiText variant="title">Backend not configured</UiText>
      <UiText color="textSecondary">
        Copy .env.example to .env, fill in your Supabase project URL and anon key, then restart the
        dev server with "npx expo start -c".
      </UiText>
    </Screen>
  );
}
