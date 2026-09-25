import { randomAvatar } from '@/lib/avatar';
import type { Member, MemberLocation } from '@/lib/types';

/**
 * A stand-in second family member for judging how the map, family list and location card look with more
 * than one person. It exists only in development builds and only in memory: nothing is written to Supabase
 * and nobody else can see it. Set this to false to switch it off.
 */
export const DEMO_ENABLED = __DEV__ && true;

export const DEMO_MEMBER_ID = 'demo-member-dolphin-street';

/** Middle of Dolphin Street, Mqansa, Thembisa. OpenStreetMap has no house numbers there, so no exact "62". */
const DEMO_SPOT = { latitude: -26.0125641, longitude: 28.2388131 };

export const demoMember: Member = {
  user_id: DEMO_MEMBER_ID,
  role: 'member',
  profile: {
    id: DEMO_MEMBER_ID,
    display_name: 'Thandi (test)',
    color: '#7C3AED',
    sharing_enabled: true,
    avatar: randomAvatar(62),
  },
};

export function demoLocation(now: number): MemberLocation {
  return { user_id: DEMO_MEMBER_ID, ...DEMO_SPOT, accuracy: 8, speed: 0, updated_at: new Date(now).toISOString() };
}
