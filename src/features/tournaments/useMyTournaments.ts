import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tmIntegrationRepo } from '@/services/tmIntegration/tmIntegrationRepo';
import { tmLinksRepo } from '@/services/tmIntegration/tmLinksRepo';
import { useAuthStore } from '@/stores/authStore';
import type { TmEntitlements, TmTournamentEntry } from '@/services/tmIntegration/types';

export const tournamentsQueryKey = (userId?: string) => ['tm', 'tournaments', userId];

/**
 * Live tournaments for the signed-in player from TM's entitlements endpoint.
 * Seeds from the locally-cached tm_links snapshot so the screen paints instantly
 * (e.g. offline / first frame), then refetches in the background. The fetch also
 * links grt_athlete_id onto the player's TM registrations as a side effect.
 */
export function useMyTournaments() {
  const userId = useAuthStore((s) => s.session?.user.id);

  return useQuery<TmEntitlements>({
    queryKey: tournamentsQueryKey(userId),
    enabled: !!userId,
    queryFn: () => tmIntegrationRepo.getEntitlements(),
    // Tee times + can_start are time-sensitive; keep it reasonably fresh.
    staleTime: 60_000,
    // Don't retry: this round-trips through the edge fn → TM. A failure (TM
    // unreachable, bad key) should surface immediately, not after retry backoff
    // that leaves the screen spinning.
    retry: false
  });
}

/**
 * Explicit read of the locally-cached tm_links snapshot (async). Useful as an
 * offline fallback when the live entitlements fetch fails — the snapshot's
 * can_start may be stale, so prefer the live data when available.
 */
export function useCachedTournaments() {
  const userId = useAuthStore((s) => s.session?.user.id);
  return useQuery<TmTournamentEntry[]>({
    queryKey: ['tm', 'links', userId],
    enabled: !!userId,
    queryFn: async () => {
      const rows = await tmLinksRepo.listForUser(userId!);
      return rows
        .map((r) => r.snapshot)
        .filter((s): s is TmTournamentEntry => !!s);
    }
  });
}

/** Explicit "link my registrations" action (also happens implicitly on fetch). */
export function useLinkTournaments() {
  const userId = useAuthStore((s) => s.session?.user.id);
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () => tmIntegrationRepo.link(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: tournamentsQueryKey(userId) });
      queryClient.invalidateQueries({ queryKey: ['tm', 'links', userId] });
    }
  });
}
