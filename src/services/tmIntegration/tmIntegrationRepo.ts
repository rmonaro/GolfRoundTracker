import { supabase } from '@/lib/supabase';
import { toAppError } from '@/services/errors';
import type {
  TmEntitlements,
  TmLinkResult,
  TmScorePush,
  TmScorecardResult,
  TmShotsPush
} from './types';

// All TM calls go through the `tm-integration` edge function so the shared
// INTEGRATION_API_KEY stays server-side. The function is action-routed, exactly
// like `courses-api`. `grt_athlete_id` + `email` are resolved server-side from
// the caller's session/profile — never sent from here.
async function callTm<T>(action: string, payload: Record<string, unknown> = {}): Promise<T> {
  const { data, error } = await supabase.functions.invoke('tm-integration', {
    body: { action, ...payload }
  });
  if (error) {
    // Supabase wraps non-2xx as FunctionsHttpError; surface the TM message when present.
    let message = error.message ?? 'Tournament service call failed';
    const ctx = (error as { context?: Response }).context;
    if (ctx && typeof ctx.json === 'function') {
      try {
        const body = await ctx.json();
        message = body?.error?.message ?? message;
      } catch {
        // keep the wrapped message
      }
    }
    throw toAppError({ message }, 'Tournament service call failed');
  }
  if (data && typeof data === 'object' && 'error' in data) {
    const err = (data as { error: { message?: string } }).error;
    throw toAppError({ message: err.message }, 'Tournament service error');
  }
  return (data as { data: T }).data;
}

export const tmIntegrationRepo = {
  /** A player's tournaments, tee times, can_start flags, and linked scorecards. */
  getEntitlements(): Promise<TmEntitlements> {
    return callTm<TmEntitlements>('entitlements');
  },

  /** Explicitly link the signed-in user to their TM registrations by email. */
  link(): Promise<TmLinkResult> {
    return callTm<TmLinkResult>('link');
  },

  /** Push hole scores (drives TM's live leaderboard). SUBMITTED locks the round. */
  pushScores(payload: TmScorePush): Promise<TmScorecardResult> {
    return callTm<TmScorecardResult>('scores', payload as unknown as Record<string, unknown>);
  },

  /** Push shot/GPS data (powers TM's public parent replay + admin map). */
  pushShots(
    payload: TmShotsPush
  ): Promise<{ scorecard_id: string; shots_written: number; holes: number }> {
    return callTm('shots', payload as unknown as Record<string, unknown>);
  }
};
