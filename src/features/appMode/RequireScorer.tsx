import type { ReactNode } from 'react';
import { Box, CircularProgress } from '@mui/material';
import { Navigate } from 'react-router-dom';
import {
  useScorerAssignments,
  useCachedScorerAssignments
} from '@/features/tournaments/useScorerAssignments';

/**
 * Scorer-only routes.
 *
 * Keeping the nav tab hidden isn't enough — an athlete could still arrive by URL
 * or from a back-button entry left over from a previous session. Scoring is for
 * people an admin assigned to keep someone else's card; everyone else goes back
 * to their tournaments.
 *
 * Waits for the live pull before turning anyone away: the cached snapshot can
 * legitimately be empty on a new device, and bouncing a real scorekeeper off
 * their own group is worse than a moment of spinner.
 */
export function RequireScorer({ children }: { children: ReactNode }) {
  const live = useScorerAssignments();
  const cached = useCachedScorerAssignments();
  const count = (live.data ?? cached.data ?? []).length;

  if (count === 0 && live.isLoading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100dvh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (count === 0) return <Navigate to="/tournaments" replace />;

  return <>{children}</>;
}
