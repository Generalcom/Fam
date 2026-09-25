import type { AvatarConfig } from '@/lib/avatar';

export type Role = 'admin' | 'member';

export type Profile = {
  id: string;
  display_name: string;
  color: string;
  sharing_enabled: boolean;
  /** The icon this person chose. Null until they have chosen one (or until supabase/enrolment.sql has been run). */
  avatar: AvatarConfig | null;
};

export type Circle = {
  id: string;
  name: string;
  invite_code: string;
  created_by: string;
};

export type Member = {
  user_id: string;
  role: Role;
  profile: Profile;
};

/** red = avoid this area; aware = be aware, take care. */
export type ZoneLevel = 'red' | 'aware';

/** A circle on the map that the family has marked as unsafe or worth being careful in. */
export type SafetyZone = {
  id: string;
  /** Null for a zone shared with every user (added by the app's owner, never by the app). */
  circle_id: string | null;
  name: string;
  level: ZoneLevel;
  latitude: number;
  longitude: number;
  radius_m: number;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

/** Where a person is relative to building outlines on the map. */
export type PresenceState =
  | 'inside'
  /** Probably inside a building, but the fix is too imprecise to be sure which. */
  | 'indoors'
  | 'around'
  | 'outside'
  /** The location fix is too imprecise to say. */
  | 'imprecise'
  /** The building data could not be loaded. */
  | 'unknown';

export type MemberLocation = {
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  speed: number | null;
  updated_at: string;
};
