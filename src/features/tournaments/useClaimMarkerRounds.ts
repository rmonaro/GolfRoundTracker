import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useAuthStore } from '@/stores/authStore';

/**
 * Attach any unclaimed marker cards waiting on this user's email.
 *
 * A junior who was scored at a tournament before they ever installed GRT should
 * find the round already in their history the first time they sign in — not
 * have to ask someone to re-send it. The RPC (migration 034) is SECURITY
 * DEFINER and matches only rounds whose `pending_athlete_email` equals the
 * CALLER'S OWN profile email, and that address comes from the TM registration
 * rather than anything a scorer typed, so there's nothing to spoof.
 *
 * Runs once per session at the app root. Almost always claims zero rows, and
 * the lookup is served by a partial index, so it's cheap enough to just do.
 */
export function useClaimMarkerRounds() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  const claimedFor = useRef<string | null>(null);

  useEffect(() => {
    if (!userId || claimedFor.current === userId) return;
    claimedFor.current = userId;

    void (async () => {
      const { data, error } = await supabase.rpc('claim_marker_rounds');
      if (error) {
        // Never surfaced: a golfer who has never been scored by anyone has
        // nothing to claim, and a failure here must not interrupt sign-in.
        console.warn('[claim] marker round claim failed', error.message);
        return;
      }
      const claimed = typeof data === 'number' ? data : 0;
      if (claimed > 0) {
        console.info(`[claim] attached ${claimed} scored round(s) to this account`);
        queryClient.invalidateQueries({ queryKey: ['rounds', userId] });
      }
    })();
  }, [userId, queryClient]);
}
