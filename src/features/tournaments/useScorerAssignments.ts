import { useQuery } from '@tanstack/react-query';
import { tmIntegrationRepo } from '@/services/tmIntegration/tmIntegrationRepo';
import { scorerAssignmentsRepo } from '@/services/tmIntegration/scorerAssignmentsRepo';
import { useAuthStore } from '@/stores/authStore';
import type { TmScorerAssignment } from '@/services/tmIntegration/types';

export const scorerAssignmentsKey = (userId?: string) => ['tm', 'scorer-assignments', userId];
export const cachedAssignmentsKey = (userId?: string) => ['tm', 'scorer-cache', userId];

/**
 * Tee groups the signed-in user has been assigned to score.
 *
 * Mirrors useMyTournaments: one round-trip through the edge function to TM,
 * which refreshes the local `tm_scorer_assignments` cache as a side effect.
 * No retry — a failure here (TM unreachable, no assignment) should surface
 * immediately rather than leave the screen spinning through a backoff.
 */
export function useScorerAssignments() {
  const userId = useAuthStore((s) => s.session?.user.id);

  return useQuery<TmScorerAssignment[]>({
    queryKey: scorerAssignmentsKey(userId),
    enabled: !!userId,
    queryFn: async () => {
      const result = await tmIntegrationRepo.getScorerAssignments();
      return result.assignments ?? [];
    },
    // Tee times and can_start are time-sensitive.
    staleTime: 60_000,
    retry: false
  });
}

/**
 * The locally-cached assignments, for when the live pull fails.
 *
 * A scorekeeper standing on the first tee with no bars still has to see their
 * group, so this is a real fallback rather than a nicety. `can_start` in a
 * snapshot was computed when it was written and may be stale — prefer live data
 * whenever it's available.
 */
export function useCachedScorerAssignments() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery<TmScorerAssignment[]>({
    queryKey: cachedAssignmentsKey(userId),
    enabled: !!userId,
    queryFn: () => scorerAssignmentsRepo.listSnapshots(userId!)
  });
}

/** Live assignments when they arrive, cached ones until then. */
export function useScorerAssignmentsWithFallback() {
  const live = useScorerAssignments();
  const cached = useCachedScorerAssignments();
  const assignments = live.data ?? cached.data ?? [];
  return {
    assignments,
    /** True when we're showing cached data because the live pull failed. */
    isStale: !live.data && !!cached.data?.length && live.isError,
    isLoading: live.isLoading && cached.isLoading,
    isError: live.isError && !cached.data?.length,
    error: live.error,
    isFetching: live.isFetching,
    refetch: live.refetch
  };
}

/** One assignment by tee group id, from whichever source has it. */
export function useScorerAssignment(teeGroupId: string | undefined) {
  const { assignments, ...rest } = useScorerAssignmentsWithFallback();
  return {
    assignment: assignments.find((a) => a.tee_group_id === teeGroupId) ?? null,
    ...rest
  };
}
