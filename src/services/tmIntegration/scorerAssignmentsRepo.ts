import { supabase } from '@/lib/supabase';
import { toAppError } from '@/services/errors';
import type { TmScorerAssignment } from './types';

export interface TmScorerAssignmentRow {
  id: string;
  user_id: string;
  tee_group_id: string;
  tournament_id: string | null;
  tournament_slug: string | null;
  tournament_name: string | null;
  round_number: number | null;
  tee_time: string | null;
  starting_hole: number | null;
  external_course_id: string | null;
  /** The 2-4 players in the group, as TM returned them. */
  players: TmScorerAssignment['players'] | null;
  /** Full assignment payload from the last successful pull. */
  snapshot: TmScorerAssignment | null;
  updated_at: string;
}

// Read-only access to the locally-cached scorer assignments (migration 034).
// The tm-integration edge function writes these with the service role on every
// pull; the client reads them so the group list still renders on a course with
// no signal — which is the normal condition, not the exception.
export const scorerAssignmentsRepo = {
  async listForUser(userId: string): Promise<TmScorerAssignmentRow[]> {
    const { data, error } = await supabase
      .from('tm_scorer_assignments')
      .select('*')
      .eq('user_id', userId)
      .order('tee_time', { ascending: true });
    if (error) throw toAppError(error, 'Could not load your scoring assignments');
    return (data ?? []) as TmScorerAssignmentRow[];
  },

  /** Cached assignments as the same shape the live endpoint returns. */
  async listSnapshots(userId: string): Promise<TmScorerAssignment[]> {
    const rows = await this.listForUser(userId);
    return rows
      .map((r) => r.snapshot)
      .filter((s): s is TmScorerAssignment => !!s);
  },

  async getByTeeGroup(
    userId: string,
    teeGroupId: string
  ): Promise<TmScorerAssignmentRow | null> {
    const { data, error } = await supabase
      .from('tm_scorer_assignments')
      .select('*')
      .eq('user_id', userId)
      .eq('tee_group_id', teeGroupId)
      .maybeSingle();
    if (error) throw toAppError(error, 'Could not load this tee group');
    return (data ?? null) as TmScorerAssignmentRow | null;
  }
};
