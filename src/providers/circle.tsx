import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AppState } from 'react-native';

import { parseAvatar, type AvatarConfig } from '@/lib/avatar';
import { DEMO_ENABLED, DEMO_MEMBER_ID, demoLocation, demoMember } from '@/lib/demo-member';
import {
  clearMyLocation,
  getSharingPermission,
  requestSharingPermission,
  setPushEnabled,
  startBackgroundUpdates,
  stopBackgroundUpdates,
  toMemberLocation,
  watchForeground,
  type SharingPermission,
} from '@/lib/location';
import { supabase } from '@/lib/supabase';
import type { Circle, Member, MemberLocation, Profile, Role, SafetyZone, ZoneLevel } from '@/lib/types';
import { useAuth } from '@/providers/auth';

type CircleValue = {
  loading: boolean;
  loadError: string | null;
  me: Profile | null;
  circle: Circle | null;
  myRole: Role | null;
  members: Member[];
  locations: Record<string, MemberLocation>;
  /** False until supabase/enrolment.sql has been run: icons cannot be saved without it. */
  avatarSupported: boolean;
  updateAvatar: (avatar: AvatarConfig) => Promise<void>;
  /** This phone's latest GPS fix, straight from the device rather than via the server. */
  myFix: MemberLocation | null;
  /** The family's red and be-aware zones (plus any shared ones). */
  zones: SafetyZone[];
  /** "missing" means supabase/safety-zones.sql has not been run on the project yet. */
  zonesStatus: 'loading' | 'ready' | 'missing' | 'error';
  addZone: (input: NewZone) => Promise<void>;
  deleteZone: (id: string) => Promise<void>;
  permission: SharingPermission | 'unknown';
  reload: () => Promise<void>;
  createCircle: (name: string) => Promise<void>;
  joinCircle: (code: string) => Promise<void>;
  leaveCircle: () => Promise<void>;
  removeMember: (userId: string) => Promise<void>;
  rotateInviteCode: () => Promise<void>;
  setSharing: (on: boolean) => Promise<'ok' | 'denied'>;
  requestPermission: (includeBackground?: boolean) => Promise<SharingPermission>;
  updateName: (name: string) => Promise<void>;
};

export type NewZone = {
  name: string;
  level: ZoneLevel;
  latitude: number;
  longitude: number;
  radius_m: number;
  note: string | null;
};

const CircleContext = createContext<CircleValue | null>(null);

type MemberRow = { user_id: string; role: Role; profiles: Omit<Profile, 'avatar'> | null };

/**
 * Icons live in their own query so an app that is ahead of the database (supabase/enrolment.sql not run yet)
 * still loads. Null means the avatar column does not exist.
 */
async function fetchAvatars(ids: string[]): Promise<Record<string, AvatarConfig | null> | null> {
  const { data, error } = await supabase.from('profiles').select('id, avatar').in('id', ids);
  if (error) return null;
  const byId: Record<string, AvatarConfig | null> = {};
  for (const row of data as { id: string; avatar: unknown }[]) byId[row.id] = parseAvatar(row.avatar);
  return byId;
}

export function CircleProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const uid = session?.user.id ?? null;

  const [loading, setLoading] = useState(uid !== null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [me, setMe] = useState<Profile | null>(null);
  const [circle, setCircle] = useState<Circle | null>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [locations, setLocations] = useState<Record<string, MemberLocation>>({});
  const [myFix, setMyFix] = useState<MemberLocation | null>(null);
  const [avatarSupported, setAvatarSupported] = useState(true);
  const [zones, setZones] = useState<SafetyZone[]>([]);
  const [zonesStatus, setZonesStatus] = useState<'loading' | 'ready' | 'missing' | 'error'>('loading');
  const [appActive, setAppActive] = useState(AppState.currentState === 'active');
  const [permission, setPermission] = useState<SharingPermission | 'unknown'>('unknown');
  const memberIds = useRef<Set<string>>(new Set());
  const [demoAt, setDemoAt] = useState(() => Date.now());

  useEffect(() => {
    if (!DEMO_ENABLED) return;
    const timer = setInterval(() => setDemoAt(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const loadCircleDetails = useCallback(async (circleId: string) => {
    const membersRes = await supabase
      .from('circle_members')
      .select('user_id, role, profiles(id, display_name, color, sharing_enabled)')
      .eq('circle_id', circleId);
    if (membersRes.error) throw membersRes.error;

    const avatars = await fetchAvatars((membersRes.data as unknown as MemberRow[]).map((row) => row.user_id));
    const nextMembers = (membersRes.data as unknown as MemberRow[])
      .filter((row): row is MemberRow & { profiles: Omit<Profile, 'avatar'> } => row.profiles !== null)
      .map((row) => ({
        user_id: row.user_id,
        role: row.role,
        profile: { ...row.profiles, avatar: avatars?.[row.user_id] ?? null },
      }));
    memberIds.current = new Set(nextMembers.map((m) => m.user_id));
    setMembers(nextMembers);

    const locationsRes = await supabase
      .from('locations')
      .select('user_id, latitude, longitude, accuracy, speed, updated_at')
      .in('user_id', [...memberIds.current]);
    if (locationsRes.error) throw locationsRes.error;

    const byUser: Record<string, MemberLocation> = {};
    for (const loc of locationsRes.data as MemberLocation[]) byUser[loc.user_id] = loc;
    setLocations(byUser);
  }, []);

  const load = useCallback(async () => {
    if (!uid) return;
    const [profileRes, membershipRes] = await Promise.all([
      supabase.from('profiles').select('id, display_name, color, sharing_enabled').eq('id', uid).maybeSingle(),
      supabase.from('circle_members').select('circles(*)').eq('user_id', uid).order('joined_at').limit(1),
    ]);
    if (profileRes.error) throw profileRes.error;
    if (membershipRes.error) throw membershipRes.error;

    const own = await fetchAvatars([uid]);
    setAvatarSupported(own !== null);
    setMe(profileRes.data ? { ...(profileRes.data as Omit<Profile, 'avatar'>), avatar: own?.[uid] ?? null } : null);
    const row = membershipRes.data?.[0] as unknown as { circles: Circle } | undefined;
    const nextCircle = row?.circles ?? null;
    setCircle(nextCircle);

    if (nextCircle) {
      await loadCircleDetails(nextCircle.id);
    } else {
      memberIds.current = new Set();
      setMembers([]);
      setLocations({});
    }
  }, [uid, loadCircleDetails]);

  useEffect(() => {
    if (!uid) return;
    let cancelled = false;
    load()
      .then(() => {
        if (!cancelled) setLoadError(null);
      })
      .catch((e: Error) => {
        if (!cancelled) setLoadError(e.message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [uid, load]);

  useEffect(() => {
    const refreshPermission = () => getSharingPermission().then(setPermission);
    void refreshPermission();
    const sub = AppState.addEventListener('change', (state) => {
      setAppActive(state === 'active');
      if (state !== 'active') return;
      void refreshPermission();
      load().catch(() => {});
    });
    return () => sub.remove();
  }, [load]);

  const circleId = circle?.id ?? null;

  const loadZones = useCallback(async () => {
    if (!circleId) return;
    const { data, error } = await supabase.from('safety_zones').select('*').order('created_at');
    if (error) {
      // PGRST205 / "relation does not exist": the migration has not been run yet.
      const missing = error.code === 'PGRST205' || error.code === '42P01' || /could not find the table/i.test(error.message);
      setZones([]);
      setZonesStatus(missing ? 'missing' : 'error');
      return;
    }
    setZones((data as SafetyZone[]).filter((z) => z.circle_id === null || z.circle_id === circleId));
    setZonesStatus('ready');
  }, [circleId]);

  useEffect(() => {
    void loadZones();
  }, [loadZones]);

  useEffect(() => {
    if (!circleId) return;
    let resync: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`circle:${circleId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, (payload) => {
        if (payload.eventType === 'DELETE') {
          const id = (payload.old as { user_id?: string }).user_id;
          if (!id) return;
          setLocations((prev) => {
            const next = { ...prev };
            delete next[id];
            return next;
          });
          return;
        }
        const loc = payload.new as MemberLocation;
        if (!memberIds.current.has(loc.user_id)) return;
        setLocations((prev) => ({ ...prev, [loc.user_id]: loc }));
      })
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'circle_members', filter: `circle_id=eq.${circleId}` },
        () => {
          loadCircleDetails(circleId).catch(() => {});
        },
      )
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => {
        loadCircleDetails(circleId).catch(() => {});
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'safety_zones' }, () => {
        void loadZones();
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        // Changes in the first moments after (re)connecting can be missed, so re-sync once it has settled.
        clearTimeout(resync);
        resync = setTimeout(() => {
          loadCircleDetails(circleId).catch(() => {});
          void loadZones();
        }, 2000);
      });
    return () => {
      clearTimeout(resync);
      void supabase.removeChannel(channel);
    };
  }, [circleId, loadCircleDetails, loadZones]);

  const sharingOn = me?.sharing_enabled ?? false;

  // Ask for location access as soon as the user is in a circle, rather than waiting for them to find a toggle.
  const askedForPermission = useRef(false);
  useEffect(() => {
    if (askedForPermission.current || permission !== 'undetermined' || !sharingOn || !circleId) return;
    askedForPermission.current = true;
    requestSharingPermission()
      .then(setPermission)
      .catch(() => {});
  }, [permission, sharingOn, circleId]);

  useEffect(() => {
    setPushEnabled(sharingOn);
  }, [sharingOn]);

  useEffect(() => {
    if (sharingOn && circleId && permission === 'background') void startBackgroundUpdates();
    else void stopBackgroundUpdates();
  }, [sharingOn, circleId, permission]);

  // Live position while the app is open. It runs even while sharing is paused (so "You" stays current
  // on this phone) but is only sent to the family when sharing is on.
  useEffect(() => {
    if (!circleId || !appActive || !uid) return;
    if (permission !== 'foreground' && permission !== 'background') return;

    let cancelled = false;
    let subscription: { remove: () => void } | undefined;
    watchForeground((loc) => {
      if (!cancelled) setMyFix(toMemberLocation(uid, loc));
    }, sharingOn)
      .then((sub) => {
        if (cancelled) sub.remove();
        else subscription = sub;
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      subscription?.remove();
    };
  }, [circleId, appActive, permission, uid, sharingOn]);

  const reload = useCallback(async () => {
    try {
      await load();
      setLoadError(null);
    } catch (e) {
      setLoadError((e as Error).message);
    }
  }, [load]);

  const createCircle = useCallback(
    async (name: string) => {
      const { error } = await supabase.rpc('create_circle', { circle_name: name });
      if (error) throw error;
      await load();
    },
    [load],
  );

  const joinCircle = useCallback(
    async (code: string) => {
      const { error } = await supabase.rpc('join_circle', { code });
      if (error) throw error;
      await load();
    },
    [load],
  );

  const leaveCircle = useCallback(async () => {
    if (!uid || !circleId) return;
    const { error } = await supabase
      .from('circle_members')
      .delete()
      .eq('circle_id', circleId)
      .eq('user_id', uid);
    if (error) throw error;
    await clearMyLocation();
    await load();
  }, [uid, circleId, load]);

  const removeMember = useCallback(
    async (userId: string) => {
      if (!circleId) return;
      if (userId === DEMO_MEMBER_ID) throw new Error('This is a development test member. It is not stored anywhere.');
      const { data, error } = await supabase
        .from('circle_members')
        .delete()
        .eq('circle_id', circleId)
        .eq('user_id', userId)
        .select();
      if (error) throw error;
      if (!data?.length) throw new Error('Only admins can remove members.');
      await loadCircleDetails(circleId);
    },
    [circleId, loadCircleDetails],
  );

  const rotateInviteCode = useCallback(async () => {
    if (!circleId) return;
    const { data, error } = await supabase.rpc('rotate_invite_code', { circle: circleId });
    if (error) throw error;
    setCircle((c) => (c ? { ...c, invite_code: data as string } : c));
  }, [circleId]);

  const setSharing = useCallback(
    async (on: boolean) => {
      if (!uid) return 'denied' as const;
      if (on) {
        const status = await requestSharingPermission();
        setPermission(status);
        if (status === 'denied') return 'denied' as const;
      }
      const { error } = await supabase.from('profiles').update({ sharing_enabled: on }).eq('id', uid);
      if (error) throw error;
      setMe((prev) => (prev ? { ...prev, sharing_enabled: on } : prev));
      if (!on) {
        await stopBackgroundUpdates();
        await clearMyLocation();
        setLocations((prev) => {
          const next = { ...prev };
          delete next[uid];
          return next;
        });
      }
      return 'ok' as const;
    },
    [uid],
  );

  const requestPermission = useCallback(async (includeBackground = false) => {
    const status = await requestSharingPermission(includeBackground);
    setPermission(status);
    return status;
  }, []);

  const updateName = useCallback(
    async (name: string) => {
      if (!uid) return;
      const trimmed = name.trim();
      if (!trimmed) throw new Error('Name cannot be empty.');
      const { error } = await supabase.from('profiles').update({ display_name: trimmed }).eq('id', uid);
      if (error) throw error;
      setMe((prev) => (prev ? { ...prev, display_name: trimmed } : prev));
      if (circleId) await loadCircleDetails(circleId);
    },
    [uid, circleId, loadCircleDetails],
  );

  const updateAvatar = useCallback(
    async (avatar: AvatarConfig) => {
      if (!uid) return;
      const { data, error } = await supabase.from('profiles').update({ avatar }).eq('id', uid).select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Could not save your icon.');
      setAvatarSupported(true);
      setMe((prev) => (prev ? { ...prev, avatar } : prev));
      if (circleId) await loadCircleDetails(circleId);
    },
    [uid, circleId, loadCircleDetails],
  );

  const addZone = useCallback(
    async (input: NewZone) => {
      if (!uid || !circleId) throw new Error('Join a circle first.');
      const name = input.name.trim();
      if (!name) throw new Error('Give the zone a name.');
      const { error } = await supabase.from('safety_zones').insert({
        circle_id: circleId,
        created_by: uid,
        name,
        level: input.level,
        latitude: input.latitude,
        longitude: input.longitude,
        radius_m: input.radius_m,
        note: input.note?.trim() || null,
      });
      if (error) throw error;
      await loadZones();
    },
    [uid, circleId, loadZones],
  );

  const deleteZone = useCallback(
    async (id: string) => {
      const { data, error } = await supabase.from('safety_zones').delete().eq('id', id).select();
      if (error) throw error;
      if (!data?.length) throw new Error('Only the person who added a zone, or the circle admin, can remove it.');
      await loadZones();
    },
    [loadZones],
  );

  const myRole = members.find((m) => m.user_id === uid)?.role ?? null;

  const withDemo = DEMO_ENABLED && circle !== null;
  const shownMembers = useMemo(() => (withDemo ? [...members, demoMember] : members), [members, withDemo]);
  const shownLocations = useMemo(
    () => (withDemo ? { ...locations, [DEMO_MEMBER_ID]: demoLocation(demoAt) } : locations),
    [locations, withDemo, demoAt],
  );

  const value = useMemo<CircleValue>(
    () => ({
      loading,
      loadError,
      me,
      circle,
      myRole,
      members: shownMembers,
      locations: shownLocations,
      avatarSupported,
      updateAvatar,
      myFix,
      zones,
      zonesStatus,
      addZone,
      deleteZone,
      permission,
      reload,
      createCircle,
      joinCircle,
      leaveCircle,
      removeMember,
      rotateInviteCode,
      setSharing,
      requestPermission,
      updateName,
    }),
    [
      loading,
      loadError,
      me,
      circle,
      myRole,
      shownMembers,
      shownLocations,
      avatarSupported,
      updateAvatar,
      myFix,
      zones,
      zonesStatus,
      addZone,
      deleteZone,
      permission,
      reload,
      createCircle,
      joinCircle,
      leaveCircle,
      removeMember,
      rotateInviteCode,
      setSharing,
      requestPermission,
      updateName,
    ],
  );

  return <CircleContext.Provider value={value}>{children}</CircleContext.Provider>;
}

export function useCircle(): CircleValue {
  const ctx = useContext(CircleContext);
  if (!ctx) throw new Error('useCircle must be used inside CircleProvider');
  return ctx;
}
