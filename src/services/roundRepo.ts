import { supabase } from '@/lib/supabase';
import type {
  Round,
  RoundInsert,
  RoundHole,
  Shot,
  FairwayResult,
  ShotResult,
  DistanceUnit,
  TargetType,
  TargetResult,
  Lie,
  PenaltyType
} from '@/models';
import { toAppError } from './errors';

export const roundRepo = {
  /**
   * Create a round. The `id` is minted on the client (see lib/ids.ts), so this
   * is an UPSERT rather than an insert — replaying it after a failed or queued
   * attempt updates the same row instead of creating a second round.
   */
  async create(payload: RoundInsert): Promise<Round> {
    const { data, error } = await supabase
      .from('rounds')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not start round');
    return data;
  },

  async update(roundId: string, patch: Partial<Round>): Promise<Round> {
    const { data, error } = await supabase
      .from('rounds')
      .update(patch)
      .eq('id', roundId)
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not update round');
    return data;
  },

  /**
   * Delete a round. RLS allows only the owner (rounds_owner_rw policy).
   * The schema cascades to round_holes and shots, so a single delete here
   * cleans up the entire round graph — no need to remove children first.
   */
  async deleteRound(roundId: string): Promise<void> {
    const { error } = await supabase.from('rounds').delete().eq('id', roundId);
    if (error) throw toAppError(error, 'Could not delete round');
  },

  /**
   * A user's own rounds — history, stats and handicap all read this.
   *
   * Excludes marker cards THIS user recorded for somebody else. While a
   * scorekeeper is tracking (and until an unclaimed card is claimed) they are
   * `rounds.user_id`, so without this filter a scorer's own history and
   * handicap would absorb the four players they scored.
   *
   * A marker card the user OWNS but somebody else recorded is deliberately kept:
   * that's their tournament round, transferred to them after the round, and it
   * belongs in their history.
   */
  async listForUser(userId: string): Promise<Round[]> {
    const { data, error } = await supabase
      .from('rounds')
      .select('*')
      .eq('user_id', userId)
      // NOT (scoring_mode = 'MARKER' AND scored_by_user_id = userId)
      .or(
        `scoring_mode.eq.SELF,scored_by_user_id.is.null,scored_by_user_id.neq.${userId}`
      )
      .order('started_at', { ascending: false });
    if (error) throw toAppError(error, 'Could not load rounds');
    return data ?? [];
  },

  async getById(roundId: string): Promise<Round | null> {
    const { data, error } = await supabase.from('rounds').select('*').eq('id', roundId).maybeSingle();
    if (error) throw toAppError(error, 'Could not load round');
    return data ?? null;
  },

  /**
   * Find the best in-progress (not completed) round to RESUME for a TM
   * tournament registration + round number. When more than one exists (e.g. an
   * empty duplicate was created by an earlier version, or a re-entry raced),
   * pick the one with the MOST recorded shots so a player's real progress is
   * never shadowed by an empty round. Ties break to the earliest start.
   */
  async findBestTournamentRound(
    userId: string,
    tmRegistrationId: string,
    tmRoundNumber: number
  ): Promise<Round | null> {
    const { data: rounds, error } = await supabase
      .from('rounds')
      .select('*')
      .eq('user_id', userId)
      .eq('tm_registration_id', tmRegistrationId)
      .eq('tm_round_number', tmRoundNumber)
      .is('completed_at', null)
      .order('started_at', { ascending: true });
    if (error) throw toAppError(error, 'Could not look up tournament round');
    if (!rounds || rounds.length === 0) return null;
    if (rounds.length === 1) return rounds[0];

    // Tally shots per candidate round in one query, then pick the richest.
    const ids = rounds.map((r) => r.id);
    const { data: shots } = await supabase
      .from('shots')
      .select('round_id')
      .in('round_id', ids);
    const counts = new Map<string, number>();
    for (const s of shots ?? []) {
      counts.set(s.round_id, (counts.get(s.round_id) ?? 0) + 1);
    }
    // rounds is ascending by started_at, so the first max encountered is the
    // earliest — the natural tie-breaker.
    let best = rounds[0];
    let bestCount = counts.get(best.id) ?? 0;
    for (const r of rounds) {
      const c = counts.get(r.id) ?? 0;
      if (c > bestCount) {
        best = r;
        bestCount = c;
      }
    }
    return best;
  },

  async listHoles(roundId: string): Promise<RoundHole[]> {
    const { data, error } = await supabase
      .from('round_holes')
      .select('*')
      .eq('round_id', roundId)
      .order('hole_number', { ascending: true });
    if (error) throw toAppError(error, 'Could not load holes');
    return data ?? [];
  },

  // Hole ids are client-minted, so these conflict on the PRIMARY KEY, not on
  // the (round_id, hole_number) natural key.
  //
  // That distinction matters: conflicting on (round_id, hole_number) while also
  // sending `id` would make Postgres overwrite the existing row's primary key,
  // silently orphaning every shot whose `hole_id` pointed at the old value.
  // Conflicting on `id` keeps the key stable, and the table's
  // `unique (round_id, hole_number)` constraint stays in place to catch a
  // duplicate loudly rather than corrupting the graph.

  async upsertHole(hole: Omit<RoundHole, 'id'> & { id: string }): Promise<RoundHole> {
    const { data, error } = await supabase
      .from('round_holes')
      .upsert(hole, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not save hole');
    return data;
  },

  async upsertHoles(holes: Array<Omit<RoundHole, 'id'> & { id: string }>): Promise<RoundHole[]> {
    if (holes.length === 0) return [];
    const { data, error } = await supabase
      .from('round_holes')
      .upsert(holes, { onConflict: 'id' })
      .select('*');
    if (error) throw toAppError(error, 'Could not save holes');
    return data ?? [];
  },

  async listShots(roundId: string): Promise<Shot[]> {
    const { data, error } = await supabase
      .from('shots')
      .select('*')
      .eq('round_id', roundId)
      .order('hole_id', { ascending: true })
      .order('shot_number', { ascending: true });
    if (error) throw toAppError(error, 'Could not load shots');
    return data ?? [];
  },

  /**
   * Persist a shot. `id` comes from the client, making this an upsert — the
   * same shot pushed twice (a retry, or a queued write draining after a manual
   * save beat it) lands on one row instead of two.
   */
  async addShot(payload: {
    id: string;
    round_id: string;
    hole_id: string;
    shot_number: number;
    club_id: string | null;
    shot_result: ShotResult;
    target_type: TargetType | null;
    target_result: TargetResult | null;
    lie: Lie | null;
    penalty_type: PenaltyType | null;
    distance: number | null;
    distance_unit: DistanceUnit | null;
    notes: string | null;
    // V2 GPS placeholders — pass null in V1.
    start_lat?: number | null;
    start_lng?: number | null;
    end_lat?: number | null;
    end_lng?: number | null;
    calculated_distance?: number | null;
    /** Auto-detected shots pass false (awaiting review); omit/true for manual. */
    verified?: boolean;
    // Motion swing data from the watch (migration 031).
    swing_type?: import('@/models').SwingTypeValue | null;
    swing_metrics?: import('@/models').RoundSwingMetrics | null;
    watch_impact_id?: number | null;
  }): Promise<Shot> {
    const { data, error } = await supabase
      .from('shots')
      .upsert(payload, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not add shot');
    return data;
  },

  async updateShot(
    shotId: string,
    patch: {
      club_id?: string | null;
      /** Position of the shot in the hole (1-based). Set when renumbering after
       *  an insert or reorder so the new play order survives a reload. */
      shot_number?: number;
      shot_result?: ShotResult;
      target_type?: TargetType | null;
      target_result?: TargetResult | null;
      lie?: Lie | null;
      penalty_type?: PenaltyType | null;
      distance?: number | null;
      distance_unit?: DistanceUnit | null;
      notes?: string | null;
      start_lat?: number | null;
      start_lng?: number | null;
      end_lat?: number | null;
      end_lng?: number | null;
      calculated_distance?: number | null;
      /** Set true when the golfer confirms an auto-detected shot. */
      verified?: boolean;
    }
  ): Promise<Shot> {
    const { data, error } = await supabase
      .from('shots')
      .update(patch)
      .eq('id', shotId)
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not update shot');
    return data;
  },

  async deleteShot(shotId: string): Promise<void> {
    const { error } = await supabase.from('shots').delete().eq('id', shotId);
    if (error) throw toAppError(error, 'Could not delete shot');
  },

  /**
   * Idempotency check for watch-detected shots (migration 031): true if a shot
   * for this round already carries the given watch impact id. Guards against the
   * same strike being committed twice (auto-track + a racing manual add).
   */
  async shotExistsForImpact(roundId: string, watchImpactId: number): Promise<boolean> {
    const { count, error } = await supabase
      .from('shots')
      .select('id', { count: 'exact', head: true })
      .eq('round_id', roundId)
      .eq('watch_impact_id', watchImpactId);
    if (error) throw toAppError(error, 'Could not check shot');
    return (count ?? 0) > 0;
  }
};

export type { FairwayResult, ShotResult };
