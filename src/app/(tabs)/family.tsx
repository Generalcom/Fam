import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { Alert, Pressable, Share, View } from 'react-native';

import { Avatar, Button, Card, Screen, Text } from '@/components/ui';
import { space } from '@/constants/theme';
import { useNow } from '@/hooks/use-now';
import { useTheme } from '@/hooks/use-theme';
import { memberStatus } from '@/lib/format';
import { ZONE_COLORS } from '@/lib/zones';
import { useCircle } from '@/providers/circle';

export default function FamilyScreen() {
  const theme = useTheme();
  const now = useNow();
  const { circle, me, myRole, members, locations, leaveCircle, removeMember, rotateInviteCode, zones, zonesStatus, deleteZone } =
    useCircle();
  const [copied, setCopied] = useState(false);
  const router = useRouter();

  if (!circle) return null;
  const isAdmin = myRole === 'admin';

  function confirmRemoveZone(id: string, name: string) {
    Alert.alert(`Remove "${name}"?`, 'It will disappear for everyone in the circle.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => deleteZone(id).catch((e: Error) => Alert.alert('Could not remove the zone', e.message)),
      },
    ]);
  }

  async function copyCode() {
    await Clipboard.setStringAsync(circle!.invite_code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function shareCode() {
    void Share.share({
      message: `Join "${circle!.name}" on Family Circle. Invite code: ${circle!.invite_code}`,
    });
  }

  function confirmNewCode() {
    Alert.alert('Make a new invite code?', 'The current code will stop working. Existing members stay in the circle.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'New code',
        onPress: () => rotateInviteCode().catch((e: Error) => Alert.alert('Could not change code', e.message)),
      },
    ]);
  }

  // Opens the map on them: navigation to someone else, your own location card for you.
  function showOnMap(userId: string, name: string, isMe: boolean) {
    if (!isMe && !locations[userId]) {
      Alert.alert(`${name} isn't sharing their location`, 'You can navigate to them once they turn sharing on.');
      return;
    }
    router.navigate({ pathname: '/', params: { focus: userId } });
  }

  function confirmRemove(userId: string, name: string) {
    Alert.alert(`Remove ${name}?`, 'They will no longer see or be seen by this circle.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: () => removeMember(userId).catch((e: Error) => Alert.alert('Could not remove', e.message)),
      },
    ]);
  }

  function confirmLeave() {
    Alert.alert(`Leave ${circle!.name}?`, 'You will stop seeing this circle, and it will stop seeing you.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Leave',
        style: 'destructive',
        onPress: () => leaveCircle().catch((e: Error) => Alert.alert('Could not leave', e.message)),
      },
    ]);
  }

  return (
    <Screen scroll>
      <Text variant="title">{circle.name}</Text>

      <Card>
        <Text variant="label" color="textSecondary">
          Invite code
        </Text>
        <Text variant="title" selectable style={{ letterSpacing: 3 }}>
          {circle.invite_code}
        </Text>
        <Text variant="caption" color="textSecondary">
          Anyone with this code can join the circle and see everyone's location. Only share it with people you trust.
        </Text>
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          <Button
            title={copied ? 'Copied' : 'Copy'}
            variant="secondary"
            onPress={() => void copyCode()}
            style={{ flex: 1 }}
          />
          <Button title="Share" onPress={shareCode} style={{ flex: 1 }} />
        </View>
        {isAdmin && <Button title="Make a new code" variant="secondary" onPress={confirmNewCode} />}
      </Card>

      <Text variant="heading">Members ({members.length})</Text>
      <Card style={{ gap: 0, paddingVertical: space.sm }}>
        {members.map((m, i) => {
          const isMe = m.user_id === me?.id;
          const name = m.profile.display_name;
          const status = memberStatus(m.profile, locations[m.user_id], now);
          return (
            <View
              key={m.user_id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: space.md,
                paddingVertical: space.sm + 2,
                borderTopWidth: i === 0 ? 0 : 1,
                borderTopColor: theme.border,
              }}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={isMe ? 'Show me on the map' : `Navigate to ${name}`}
                accessibilityHint={status}
                onPress={() => showOnMap(m.user_id, name, isMe)}
                style={({ pressed }) => ({ flex: 1, flexDirection: 'row', alignItems: 'center', gap: space.md, opacity: pressed ? 0.6 : 1 })}>
                <Avatar name={name} color={m.profile.color} avatar={m.profile.avatar} />
                <View style={{ flex: 1 }}>
                  <Text variant="label" numberOfLines={1}>
                    {name}
                    {isMe ? ' (you)' : ''}
                    {m.role === 'admin' ? ' · Admin' : ''}
                  </Text>
                  <Text variant="caption" color="textSecondary">
                    {status}
                  </Text>
                </View>
                {!isMe && locations[m.user_id] && <Ionicons name="navigate-outline" size={20} color={theme.primary} />}
              </Pressable>
              {isAdmin && !isMe && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${name}`}
                  onPress={() => confirmRemove(m.user_id, name)}
                  hitSlop={8}
                  style={{ padding: space.sm }}>
                  <Ionicons name="person-remove-outline" size={22} color={theme.danger} />
                </Pressable>
              )}
            </View>
          );
        })}
      </Card>

      <Text variant="heading">Safety zones ({zones.length})</Text>
      <Card>
        <Text variant="caption" color="textSecondary">
          Red zones are places to avoid and be-aware zones are places to take care. Press and hold the map to add
          one. Everyone in the circle is warned when someone is in or near a zone.
        </Text>
        {zonesStatus === 'missing' && (
          <Text variant="caption" style={{ color: theme.warningText, backgroundColor: theme.warningBg, padding: space.sm, borderRadius: 8 }}>
            Safety zones need one more setup step: run supabase/safety-zones.sql in your Supabase SQL editor, then reopen the app.
          </Text>
        )}
        {zonesStatus === 'error' && (
          <Text variant="caption" style={{ color: theme.danger }}>
            Could not load the safety zones. Check your connection.
          </Text>
        )}
        {zonesStatus === 'ready' && zones.length === 0 && (
          <Text variant="caption" color="textSecondary">
            No zones yet.
          </Text>
        )}
        {zones.map((zone) => {
          const canRemove = zone.circle_id !== null && (zone.created_by === me?.id || isAdmin);
          const color = ZONE_COLORS[zone.level];
          return (
            <View key={zone.id} style={{ flexDirection: 'row', alignItems: 'center', gap: space.sm, paddingVertical: space.xs }}>
              <View style={{ width: 14, height: 14, borderRadius: 7, backgroundColor: color }} />
              <View style={{ flex: 1 }}>
                <Text variant="label" numberOfLines={1}>
                  {zone.name}
                </Text>
                <Text variant="caption" color="textSecondary" numberOfLines={2}>
                  {zone.level === 'red' ? 'Red zone' : 'Be-aware zone'} · {zone.radius_m >= 1000 ? `${zone.radius_m / 1000} km` : `${zone.radius_m} m`}
                  {zone.circle_id === null ? ' · shared' : ''}
                  {zone.note ? ` · ${zone.note}` : ''}
                </Text>
              </View>
              {canRemove && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove zone ${zone.name}`}
                  onPress={() => confirmRemoveZone(zone.id, zone.name)}
                  hitSlop={8}
                  style={{ padding: space.sm }}>
                  <Ionicons name="trash-outline" size={20} color={theme.danger} />
                </Pressable>
              )}
            </View>
          );
        })}
      </Card>

      <Button title="Leave circle" variant="danger" onPress={confirmLeave} />
    </Screen>
  );
}
