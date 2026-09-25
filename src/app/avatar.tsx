import { useState } from 'react';
import { Alert } from 'react-native';

import { AvatarBuilder } from '@/components/avatar-builder';
import { randomAvatar, type AvatarConfig } from '@/lib/avatar';
import { useCircle } from '@/providers/circle';

/** Enrolment step: everyone picks an icon before anything else. Saving it moves them on. */
export default function ChooseAvatar() {
  const { me, updateAvatar } = useCircle();
  const [start] = useState(() => me?.avatar ?? randomAvatar());

  async function save(config: AvatarConfig) {
    try {
      await updateAvatar(config);
    } catch (e) {
      Alert.alert('Could not save your icon', (e as Error).message);
    }
  }

  return (
    <AvatarBuilder
      initial={start}
      title="Choose your icon"
      body="This is how your family sees you on the map. You can change it any time in Settings."
      saveLabel="Continue"
      onSave={save}
    />
  );
}
