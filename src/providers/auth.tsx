import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { MEMBER_COLORS } from '@/constants/theme';
import { forgetPosition } from '@/lib/initial-view';
import { clearMyLocation, stopBackgroundUpdates } from '@/lib/location';
import { supabase } from '@/lib/supabase';

type AuthValue = {
  session: Session | null;
  /** True for accounts created without an email/password; signing out loses them for good. */
  isGuest: boolean;
  loading: boolean;
  signInAsGuest: (name: string) => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  /** Resolves true when the account needs email confirmation before signing in. */
  signUp: (name: string, email: string, password: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  deleteAccount: () => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

function randomColor(): string {
  return MEMBER_COLORS[Math.floor(Math.random() * MEMBER_COLORS.length)];
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') supabase.auth.startAutoRefresh();
      else supabase.auth.stopAutoRefresh();
    });
    return () => {
      sub.subscription.unsubscribe();
      appState.remove();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string) => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw error;
  }, []);

  const signUp = useCallback(async (name: string, email: string, password: string) => {
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: name.trim(), color: randomColor() } },
    });
    if (error) throw error;
    return data.session === null;
  }, []);

  const signInAsGuest = useCallback(async (name: string) => {
    const { error } = await supabase.auth.signInAnonymously({
      options: { data: { display_name: name.trim(), color: randomColor() } },
    });
    if (error) throw error;
  }, []);

  const stopSharing = useCallback(async () => {
    await stopBackgroundUpdates();
    await clearMyLocation();
    await forgetPosition();
  }, []);

  const signOut = useCallback(async () => {
    await stopSharing();
    await supabase.auth.signOut();
  }, [stopSharing]);

  const deleteAccount = useCallback(async () => {
    await stopSharing();
    const { error } = await supabase.rpc('delete_my_account');
    if (error) throw error;
    await supabase.auth.signOut();
  }, [stopSharing]);

  const isGuest = session?.user.is_anonymous ?? false;

  const value = useMemo(
    () => ({ session, isGuest, loading, signInAsGuest, signIn, signUp, signOut, deleteAccount }),
    [session, isGuest, loading, signInAsGuest, signIn, signUp, signOut, deleteAccount],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
