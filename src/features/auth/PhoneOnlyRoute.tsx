import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useIsDesktop } from '@/hooks/useIsDesktop';

/**
 * Route that only exists on a phone; a desktop browser is sent to `to`.
 *
 * Hiding a link is a hint, not a gate — a bookmark, a back button or a typed
 * URL all walk straight past it. Sign-up is the case that matters: an account
 * created on a laptop lands its owner immediately on "open this on your phone",
 * so the flow is a dead end that also leaves a half-configured profile behind.
 */
export function PhoneOnlyRoute({ children, to }: { children: ReactNode; to: string }) {
  const isDesktop = useIsDesktop();
  if (isDesktop) return <Navigate to={to} replace />;
  return <>{children}</>;
}
