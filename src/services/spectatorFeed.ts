// Spectator side: read an athlete's round with nothing but a code.
//
// A spectator has no account, so nothing here goes through the Supabase client
// with a session. Every call is a POST to the `spectator-api` edge function
// carrying the code, which that function re-validates each time — so revoking a
// code takes effect on the viewer's very next poll rather than whenever they
// happen to reload.

import type { HoleFeature, Round, RoundHole, Shot, CourseHole } from '@/models';
import { normaliseShareCode } from './spectatorRepo';

/** Round columns the feed returns. A subset — a spectator sees the card, not
 *  the handicap maths or the TM card-role bookkeeping. */
export type SpectatorRound = Pick<
  Round,
  | 'id'
  | 'course_id'
  | 'course_name'
  | 'started_at'
  | 'completed_at'
  | 'holes_played'
  | 'score'
  | 'par'
  | 'score_vs_par'
  | 'tee_name'
  | 'tm_round_number'
  | 'tm_tournament_slug'
  | 'tm_registration_id'
  | 'scoring_mode'
  | 'user_id'
>;

export interface SpectatorJoinResult {
  athleteName: string;
  /** Echoed back grouped, so the join screen can show what was accepted. */
  code: string;
  rounds: SpectatorRound[];
}

export interface SpectatorFeed {
  athleteName: string;
  round: SpectatorRound | null;
  rounds: SpectatorRound[];
  holes: RoundHole[];
  shots: Shot[];
  /** club id -> display name, resolved server-side (a spectator can't read the
   *  clubs catalogue itself). */
  clubs: Record<string, string>;
  fetchedAt: string;
}

export interface SpectatorLayout {
  course: { id: string; name: string; osm_status: string | null } | null;
  holes: CourseHole[];
  features: HoleFeature[];
}

const FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/spectator-api`;

/**
 * Call the function directly rather than through `supabase.functions.invoke`.
 *
 * invoke attaches whatever session the Supabase client is holding. A spectator
 * has none, and — worse — an athlete previewing their own code on the same
 * device does, which would quietly send their JWT to an endpoint that has no
 * business seeing it. A bare fetch with only the anon key keeps the spectator
 * path genuinely anonymous.
 */
async function call<T>(action: string, payload: Record<string, unknown>): Promise<T> {
  const res = await fetch(FUNCTION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: import.meta.env.VITE_SUPABASE_ANON_KEY
    },
    body: JSON.stringify({ action, ...payload })
  });

  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      (body as { error?: { message?: string } } | null)?.error?.message ??
      `Request failed (${res.status})`;
    const err = new Error(message) as Error & { status: number };
    err.status = res.status;
    throw err;
  }
  return body as T;
}

export const spectatorFeed = {
  /** Redeem a code. Throws with a readable message when it isn't valid. */
  join(code: string): Promise<SpectatorJoinResult> {
    return call<SpectatorJoinResult>('join', { code: normaliseShareCode(code) });
  },

  /** One round, whole. Called on a timer while the live view is open. */
  fetch(code: string, roundId?: string | null): Promise<SpectatorFeed> {
    return call<SpectatorFeed>('feed', {
      code: normaliseShareCode(code),
      roundId: roundId ?? undefined
    });
  },

  /** Course geometry for the hole map. Fetched once per course and cached. */
  layout(code: string, courseId: string): Promise<SpectatorLayout> {
    return call<SpectatorLayout>('layout', { code: normaliseShareCode(code), courseId });
  }
};
