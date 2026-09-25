import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert } from 'react-native';

import { AvatarBuilder } from '@/components/avatar-builder';
import { randomAvatar, type AvatarConfig } from '@/lib/avatar';
import { useCircle } from '@/providers/circle';

/** Change the icon later, from Settings. */
export default function EditAvatar() {
  const router = useRouter();
  const { me, updateAvatar } = useCircle();
  const [start] = useState(() => me?.avatar ?? randomAvatar());

  async function save(config: AvatarConfig) {
    try {
      await updateAvatar(config);
      router.back();
    } catch (e) {
      Alert.alert('Could not save your icon', (e as Error).message);
    }
  }

  return (
    <AvatarBuilder
      initial={start}
      title="Your icon"
      body="Change how you look on your family's map."
      saveLabel="Save"
      onSave={save}
      onBack={() => router.back()}
    />
  );
}
