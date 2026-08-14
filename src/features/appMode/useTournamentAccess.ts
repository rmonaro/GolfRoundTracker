import { useMyTournaments, useCachedTournaments } from '@/features/tournaments/useMyTournaments';
import {
  useScorerAssignments,
  useCachedScorerAssignments
} from '@/features/tournaments/useScorerAssignments';
import { useAuthStore } from '@/stores/authStore';
import { resolveTournamentAccess, type TournamentAccess } from './resolveTournamentAccess';

export type { TournamentAccess } from './resolveTournamentAccess';

/**
 * Does this user have a tournament side at all?
 *
 * Drives the post-login chooser: no access → the app is just Golf Rounds and the
 * two-option screen never appears. "Access" deliberately includes scorekeepers
 * with no registration of their own — scoring lives on the tournament side, so
 * gating purely on registrations would lock a marker out of their assignments.
 *
 * Cached snapshots contribute DATA (so an offline launch still recognizes a
 * returning player) but never the decision to stop waiting — that belongs to the
 * live queries alone. See resolveTournamentAccess for why.
 */
export function useTournamentAccess(): TournamentAccess {
  const userId = useAuthStore((s) => s.session?.user.id);
  const liveTournaments = useMyTournaments();
  const cachedTournaments = useCachedTournaments();
  const liveScorer = useScorerAssignments();
  const cachedScorer = useCachedScorerAssignments();

  const tournaments = liveTournaments.data?.tournaments ?? cachedTournaments.data ?? [];
  const assignments = liveScorer.data ?? cachedScorer.data ?? [];

  return resolveTournamentAccess({
    hasUser: !!userId,
    tournamentCount: tournaments.length,
    scorerGroupCount: assignments.length,
    // A query that is pending AND fetching hasn't answered yet. Errors settle it
    // — retry is off on both, so a failure is final for this attempt.
    tournamentsSettled: !liveTournaments.isLoading,
    scorerSettled: !liveScorer.isLoading,
    tournamentsUnavailable: liveTournaments.isError && !cachedTournaments.data?.length,
    scorerUnavailable: liveScorer.isError && !cachedScorer.data?.length
  });
}
