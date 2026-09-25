import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Linking, Pressable, Switch, View } from 'react-native';

import { Avatar, Button, Card, Screen, Text, TextField } from '@/components/ui';
import { space } from '@/constants/theme';
import { useTheme } from '@/hooks/use-theme';
import { REQUIRE_KYC } from '@/lib/kyc';
import { useAuth } from '@/providers/auth';
import { useCircle } from '@/providers/circle';
import { useKyc, type KycStatus } from '@/providers/kyc';

const KYC_LABEL: Partial<Record<KycStatus, string>> = {
  verified: 'Verified. Thank you.',
  pending: 'Submitted. A reviewer will check your documents soon.',
  rejected: 'Not accepted. Open the app again to submit new photos.',
  none: 'Not done yet.',
  loading: 'Checking…',
};

const CREDIT_LINKS = [
  { label: 'OpenStreetMap copyright', url: 'https://www.openstreetmap.org/copyright' },
  { label: 'OpenFreeMap', url: 'https://openfreemap.org' },
  { label: 'OpenMapTiles', url: 'https://www.openmaptiles.org/' },
];

const PERMISSION_LABEL = {
  background: 'Sharing in the background',
  foreground: 'Sharing only while the app is open',
  denied: 'Location permission is off',
  undetermined: 'Waiting for your permission',
  unknown: 'Checking permission…',
} as const;

export default function SettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const kyc = useKyc();
  const { signOut, deleteAccount, isGuest } = useAuth();
  const { me, permission, setSharing, requestPermission, updateName } = useCircle();
  const [name, setName] = useState(me?.display_name ?? '');
  const [savingName, setSavingName] = useState(false);

  if (!me) return null;
  const nameChanged = name.trim() !== me.display_name && name.trim().length > 0;

  function offerSettings() {
    Alert.alert(
      'Location permission needed',
      'Allow location access in Settings so your family can see where you are.',
      [{ text: 'Not now', style: 'cancel' }, { text: 'Open Settings', onPress: () => void Linking.openSettings() }],
    );
  }

  async function onToggle(on: boolean) {
    try {
      if ((await setSharing(on)) === 'denied') offerSettings();
    } catch (e) {
      Alert.alert('Could not update sharing', (e as Error).message);
    }
  }

  async function onUpgradePermission() {
    if ((await requestPermission(true)) === 'denied') offerSettings();
  }

  async function saveName() {
    setSavingName(true);
    try {
      await updateName(name);
    } catch (e) {
      Alert.alert('Could not save name', (e as Error).message);
    } finally {
      setSavingName(false);
    }
  }

  function confirmSignOut() {
    if (!isGuest) {
      void signOut();
      return;
    }
    Alert.alert(
      'Sign out?',
      "You haven't set up an email or password, so signing out permanently loses this account. You'd have to join your circle again as a new person.",
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Sign out', style: 'destructive', onPress: () => void signOut() },
      ],
    );
  }

  function confirmDelete() {
    Alert.alert(
      'Delete your account?',
      'This permanently removes your account, your location and your place in every circle. It cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => deleteAccount().catch((e: Error) => Alert.alert('Could not delete account', e.message)),
        },
      ],
    );
  }

  return (
    <Screen scroll>
      <Text variant="title">Settings</Text>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <View style={{ flex: 1 }}>
            <Text variant="heading">Share my location</Text>
            <Text variant="caption" color="textSecondary">
              Your family circle sees your latest position. Turn this off and it's removed straight away.
            </Text>
          </View>
          <Switch
            accessibilityLabel="Share my location"
            value={me.sharing_enabled}
            onValueChange={(on) => void onToggle(on)}
            trackColor={{ true: theme.primary }}
          />
        </View>
        {me.sharing_enabled && (
          <>
            <Text variant="caption" color={permission === 'denied' ? 'danger' : 'textSecondary'}>
              {PERMISSION_LABEL[permission]}
            </Text>
            {permission === 'foreground' && (
              <Button
                title="Allow background sharing"
                variant="secondary"
                onPress={() => void onUpgradePermission()}
              />
            )}
            {permission === 'denied' && (
              <Button title="Open Settings" variant="secondary" onPress={() => void Linking.openSettings()} />
            )}
          </>
        )}
      </Card>

      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: space.md }}>
          <Avatar name={me.display_name} color={me.color} size={64} avatar={me.avatar} />
          <View style={{ flex: 1 }}>
            <Text variant="heading">Your icon</Text>
            <Text variant="caption" color="textSecondary">
              How you look on your family's map.
            </Text>
          </View>
        </View>
        <Button title="Change icon" variant="secondary" onPress={() => router.push('/edit-avatar')} />
      </Card>

      <Card>
        <TextField label="Your name" value={name} onChangeText={setName} autoCapitalize="words" />
        <Button title="Save name" onPress={() => void saveName()} loading={savingName} disabled={!nameChanged} />
      </Card>

      {REQUIRE_KYC && (
        <Card>
          <Text variant="heading">Identity check</Text>
          <Text variant="caption" color={kyc.status === 'verified' ? 'primary' : 'textSecondary'}>
            {KYC_LABEL[kyc.status] ?? ''}
          </Text>
        </Card>
      )}

      <Card>
        <Text variant="heading">Privacy</Text>
        <Text variant="caption" color="textSecondary">
          Only your most recent location is stored, and only people in your circle can see it. No location
          history is kept.
        </Text>
      </Card>

      <Card>
        <Text variant="heading">Map credits</Text>
        <Text variant="caption" color="textSecondary">
          Map data © OpenStreetMap contributors, available under the Open Database Licence. Map tiles and style by
          OpenFreeMap, using OpenMapTiles.
        </Text>
        {CREDIT_LINKS.map((link) => (
          <Pressable
            key={link.url}
            accessibilityRole="link"
            onPress={() => void Linking.openURL(link.url)}
            style={{ minHeight: 40, justifyContent: 'center' }}>
            <Text variant="label" color="primary">
              {link.label}
            </Text>
          </Pressable>
        ))}
      </Card>

      <Button title="Sign out" variant="secondary" onPress={confirmSignOut} />
      <Button title="Delete account" variant="danger" onPress={confirmDelete} />
    </Screen>
  );
}
