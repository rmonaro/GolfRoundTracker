import { Box, CircularProgress } from '@mui/material';
import { Navigate, useLocation } from 'react-router-dom';
import { type ReactNode } from 'react';
import { useAuthStore } from '@/stores/authStore';
import { useAppModeStore } from '@/stores/appModeStore';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { useIsAdmin } from '@/admin/hooks/useIsAdmin';
import { DesktopMobileOnly } from './DesktopMobileOnly';

// Routes that must render before a side has been picked: the chooser itself,
// and onboarding (a brand-new account has nothing on either side yet).
const MODE_EXEMPT = ['/choose', '/onboarding'];

export function AuthGuard({ children }: { children: ReactNode }) {
  const session = useAuthStore((s) => s.session);
  const profile = useAuthStore((s) => s.profile);
  const initializing = useAuthStore((s) => s.initializing);
  const mode = useAppModeStore((s) => s.mode);
  const location = useLocation();
  const isDesktop = useIsDesktop();
  const { data: isAdmin, isLoading: adminLoading } = useIsAdmin();

  if (initializing) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100dvh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (!session) {
    return <Navigate to="/auth/login" replace state={{ from: location }} />;
  }

  // Desktop: the admin panel is the only thing on offer.
  //
  // Placed BEFORE the onboarding and mode redirects deliberately — both are
  // phone flows, and an admin opening the panel on a laptop has no business
  // being marched through "pick your gender and skill level" or a Tournaments
  // vs Golf Rounds chooser to get there.
  //
  // `/admin` has its own route tree behind AdminGuard rather than this guard,
  // so redirecting to it cannot loop back through here. `/spectate` and
  // `/auth` sit outside AuthGuard entirely and stay reachable on desktop,
  // which is what lets a parent watch a round from a laptop.
  if (isDesktop) {
    if (adminLoading) {
      return (
        <Box sx={{ display: 'grid', placeItems: 'center', height: '100dvh' }}>
          <CircularProgress />
        </Box>
      );
    }
    if (isAdmin) return <Navigate to="/admin" replace />;
    return <DesktopMobileOnly />;
  }

  // First-run onboarding: a freshly created profile has `onboarded_at = null`.
  // Send the user to /onboarding for gender + skill level + bag setup before
  // they can access the rest of the app.
  if (profile && profile.onboarded_at == null && location.pathname !== '/onboarding') {
    return <Navigate to="/onboarding" replace />;
  }

  // Tournaments or Golf Rounds. Unset on every cold start (the store isn't
  // persisted), so this runs once per launch. /choose resolves it silently when
  // there's nothing to ask about — no tournament side, or a round already in
  // progress — and carries `from` so a deep link survives the detour.
  if (mode == null && !MODE_EXEMPT.includes(location.pathname)) {
    return <Navigate to="/choose" replace state={{ from: location }} />;
  }

  return <>{children}</>;
}

export function PublicOnlyGuard({ children }: { children: ReactNode }) {
  const session = useAuthStore((s) => s.session);
  const initializing = useAuthStore((s) => s.initializing);

  if (initializing) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100dvh' }}>
        <CircularProgress />
      </Box>
    );
  }

  if (session) return <Navigate to="/" replace />;
  return <>{children}</>;
}
