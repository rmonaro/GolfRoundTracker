import { supabase } from '@/lib/supabase';
import type { Round, RoundHole } from '@/models';
import { toAppError } from './errors';

/** A round joined with minimal owner info for the global admin rounds table. */
export interface AdminRound extends Round {
  player_name: string;
  player_email: string | null;
}

export interface RoundHoleTotals {
  score: number;
  par: number;
  scoreVsPar: number;
  holesPlayed: number;
}

type ScoreableHole = Pick<RoundHole, 'par' | 'strokes' | 'penalty_strokes'>;

/**
 * Running totals computed straight from round_holes, so a round shows a real
 * score even when it was never "finished" (the stored rounds.score stays 0
 * until the summary screen is opened). Mirrors the app's own scoring:
 *   score = Σ(strokes + penalty_strokes); par counts only *played* holes.
 */
export function computeRoundHoleTotals(holes: ScoreableHole[]): RoundHoleTotals {
  let score = 0;
  let par = 0;
  let holesPlayed = 0;
  for (const h of holes) {
    const strokes = h.strokes || 0;
    const pen = h.penalty_strokes || 0;
    const played = strokes > 0 || pen > 0;
    score += strokes + pen;
    if (played) {
      par += h.par || 0;
      holesPlayed++;
    }
  }
  return { score, par, scoreVsPar: score - par, holesPlayed };
}

/** Fetch round_holes for many rounds and fold into per-round live totals. */
export async function liveTotalsByRound(roundIds: string[]): Promise<Map<string, RoundHoleTotals>> {
  const result = new Map<string, RoundHoleTotals>();
  if (roundIds.length === 0) return result;

  // Chunk to keep the `in (...)` filter within URL limits on large datasets.
  const grouped = new Map<string, ScoreableHole[]>();
  for (let i = 0; i < roundIds.length; i += 300) {
    const chunk = roundIds.slice(i, i + 300);
    const { data, error } = await supabase
      .from('round_holes')
      .select('round_id, par, strokes, penalty_strokes')
      .in('round_id', chunk);
    if (error) throw toAppError(error, 'Could not load hole totals');
    for (const row of data ?? []) {
      const rid = row.round_id as string;
      const arr = grouped.get(rid) ?? [];
      arr.push(row as ScoreableHole);
      grouped.set(rid, arr);
    }
  }
  for (const [rid, holes] of grouped) result.set(rid, computeRoundHoleTotals(holes));
  return result;
}

/** Override the denormalized score fields on rounds with live hole totals. */
export function applyLiveTotals<T extends Round>(
  rounds: T[],
  totals: Map<string, RoundHoleTotals>
): T[] {
  return rounds.map((r) => {
    const t = totals.get(r.id);
    if (!t) return r; // no hole data — keep stored values
    return {
      ...r,
      score: t.score,
      par: t.par,
      score_vs_par: t.scoreVsPar,
      holes_played: t.holesPlayed
    };
  });
}

/**
 * Admin-scoped round queries across all users. Relies on the
 * `rounds_admin_select` / `profiles_admin_select` RLS policies (migration 022).
 */
export const adminRoundsRepo = {
  /** Every round across all users, newest first, with the player's name. */
  async listAll(): Promise<AdminRound[]> {
    const { data, error } = await supabase
      .from('rounds')
      .select('*, profiles(first_name, last_name, email)')
      .order('started_at', { ascending: false });
    if (error) throw toAppError(error, 'Could not load rounds');

    const rounds = (data ?? []).map((row) => {
      const { profiles, ...round } = row as Round & {
        profiles: { first_name: string | null; last_name: string | null; email: string | null } | null;
      };
      const name = [profiles?.first_name, profiles?.last_name].filter(Boolean).join(' ').trim();
      return {
        ...(round as Round),
        player_name: name || profiles?.email || '—',
        player_email: profiles?.email ?? null
      };
    });

    const totals = await liveTotalsByRound(rounds.map((r) => r.id));
    return applyLiveTotals(rounds, totals);
  },

  /** A single round with the player's name, for the admin round detail view. */
  async getOne(roundId: string): Promise<AdminRound | null> {
    // Two queries rather than one with an embedded `profiles`.
    //
    // The embed makes the whole request fail if the relationship can't be
    // resolved or the profile isn't readable — and the caller then sees an
    // absent round rather than an error, which reads as "Round not found" for
    // a round that plainly exists. The player's name is decoration; the round
    // is the point, so it must not depend on the name resolving.
    const { data, error } = await supabase
      .from('rounds')
      .select('*')
      .eq('id', roundId)
      .maybeSingle();
    if (error) throw toAppError(error, 'Could not load round');
    if (!data) return null;
    const round = data as Round;

    let name = '';
    let email: string | null = null;
    if (round.user_id) {
      const { data: profile } = await supabase
        .from('profiles')
        .select('first_name, last_name, email')
        .eq('id', round.user_id)
        .maybeSingle();
      name = [profile?.first_name, profile?.last_name].filter(Boolean).join(' ').trim();
      email = profile?.email ?? null;
    }

    const [withTotals] = applyLiveTotals([round], await liveTotalsByRound([round.id]));
    return {
      ...(withTotals ?? round),
      player_name: name || email || '—'
    } as AdminRound;
  },

  /** Map of club id → display name, for rendering clubs_used / shot clubs. */
  async clubsMap(): Promise<Record<string, string>> {
    const { data, error } = await supabase.from('clubs').select('id, name');
    if (error) throw toAppError(error, 'Could not load clubs');
    const map: Record<string, string> = {};
    for (const c of data ?? []) map[c.id as string] = c.name as string;
    return map;
  }
};
