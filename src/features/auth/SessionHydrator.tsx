import { useBag } from '@/features/bag/useBag';
import { useFlushSpectatorFollow } from '@/features/spectate/useFlushSpectatorFollow';

/**
 * Renders nothing. Fires session-scoped queries that populate Zustand stores
 * (currently: the user's bag). Mounted inside AuthProvider so the queries kick
 * off as soon as we have a session, regardless of which route the user lands on.
 *
 * Without this, routes that live OUTSIDE MobileShell (e.g. /round/play,
 * /round/summary/:id, /watch) would render with an empty bagStore until the
 * user navigates back through Home or My Bag.
 */
export function SessionHydrator() {
  useBag();
  // Saves an athlete a spectator asked to keep, the moment they have an account
  // to keep them on. Here rather than on a spectator screen because the sign-up
  // detour ends somewhere else entirely.
  useFlushSpectatorFollow();
  return null;
}
