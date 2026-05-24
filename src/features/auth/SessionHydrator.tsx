import { useBag } from '@/features/bag/useBag';

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
  return null;
}
