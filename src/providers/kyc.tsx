import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';

import { supabase } from '@/lib/supabase';
import { useAuth } from '@/providers/auth';

/**
 * loading  - asking the server
 * none     - nothing submitted yet
 * pending  - submitted, waiting for a reviewer
 * verified / rejected - the reviewer's decision
 * missing  - supabase/enrolment.sql has not been run
 */
export type KycStatus = 'loading' | 'none' | 'pending' | 'verified' | 'rejected' | 'missing' | 'error';

type KycValue = {
  status: KycStatus;
  rejectReason: string | null;
  refresh: () => Promise<void>;
  /** Development builds only: lets a developer past the identity check. Ignored in release builds. */
  skipped: boolean;
  skipForDev: () => void;
};

const KycContext = createContext<KycValue | null>(null);

export function KycProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const uid = session?.user.id ?? null;
  const [status, setStatus] = useState<KycStatus>(uid ? 'loading' : 'none');
  const [rejectReason, setRejectReason] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!uid) return;
    const { data, error } = await supabase
      .from('kyc_submissions')
      .select('status, reject_reason')
      .eq('user_id', uid)
      .maybeSingle();
    if (error) {
      const missing = error.code === 'PGRST205' || error.code === '42P01' || /could not find the table/i.test(error.message);
      setStatus(missing ? 'missing' : 'error');
      return;
    }
    const row = data as { status: 'pending' | 'verified' | 'rejected'; reject_reason: string | null } | null;
    setStatus(row?.status ?? 'none');
    setRejectReason(row?.reject_reason ?? null);
  }, [uid]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!uid) return;
    const channel = supabase
      .channel(`kyc:${uid}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'kyc_submissions', filter: `user_id=eq.${uid}` },
        () => void refresh(),
      )
      .subscribe();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void refresh();
    });
    return () => {
      sub.remove();
      void supabase.removeChannel(channel);
    };
  }, [uid, refresh]);

  const [skipped, setSkipped] = useState(false);
  const skipForDev = useCallback(() => {
    if (__DEV__) setSkipped(true);
  }, []);

  const value = useMemo(
    () => ({ status, rejectReason, refresh, skipped, skipForDev }),
    [status, rejectReason, refresh, skipped, skipForDev],
  );
  return <KycContext.Provider value={value}>{children}</KycContext.Provider>;
}

export function useKyc(): KycValue {
  const value = useContext(KycContext);
  if (!value) throw new Error('useKyc must be used inside KycProvider');
  return value;
}
