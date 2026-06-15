import { supabase } from '@/lib/supabase';
import type { Profile, Round } from '@/models';
import { toAppError } from './errors';
import { applyLiveTotals, liveTotalsByRound } from './adminRoundsRepo';

/** A profile row enriched with aggregate round stats for the admin users table. */
export interface AdminUser extends Profile {
  rounds_count: number;
  last_round_at: string | null;
}

/**
 * Admin-scoped user queries. Relies on the `profiles_admin_select` /
 * `rounds_admin_select` RLS policies (migration 022) which grant admins read
 * access to every profile and round. AdminGuard checks `is_admin` client-side
 * before these fire.
 */
export const adminUsersRepo = {
  /** All users with a count of rounds played and the date of their latest round. */
  async listAll(): Promise<AdminUser[]> {
    const { data: profiles, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw toAppError(error, 'Could not load users');

    // Pull rounds for all users in one query, then fold into per-user aggregates.
    const { data: rounds, error: roundsErr } = await supabase
      .from('rounds')
      .select('user_id, started_at');
    if (roundsErr) throw toAppError(roundsErr, 'Could not load round counts');

    const counts = new Map<string, number>();
    const last = new Map<string, string>();
    for (const r of rounds ?? []) {
      const uid = r.user_id as string;
      counts.set(uid, (counts.get(uid) ?? 0) + 1);
      const startedAt = r.started_at as string | null;
      if (startedAt && (!last.has(uid) || startedAt > (last.get(uid) as string))) {
        last.set(uid, startedAt);
      }
    }

    return (profiles ?? []).map((p) => ({
      ...(p as Profile),
      rounds_count: counts.get(p.id) ?? 0,
      last_round_at: last.get(p.id) ?? null
    }));
  },

  async getOne(id: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw toAppError(error, 'Could not load user');
    return (data ?? null) as Profile | null;
  },

  /** Every round a given user has played, newest first. */
  async listRounds(userId: string): Promise<Round[]> {
    const { data, error } = await supabase
      .from('rounds')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false });
    if (error) throw toAppError(error, 'Could not load rounds');
    const rounds = (data ?? []) as Round[];
    const totals = await liveTotalsByRound(rounds.map((r) => r.id));
    return applyLiveTotals(rounds, totals);
  }
};
