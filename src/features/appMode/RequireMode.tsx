import type { ReactNode } from 'react';
import { Navigate } from 'react-router-dom';
import { useAppModeStore, homePathFor, type AppMode } from '@/stores/appModeStore';

/**
 * Keeps a route on its own side of the app.
 *
 * The two sides don't just look different — the rounds side must not surface
 * tournament screens at all, and vice versa. Hiding the links isn't enough when
 * a deep link, a back-button entry or a stale history stack can still land on
 * the wrong route, so the routes themselves enforce it.
 *
 * An unresolved mode falls through to the children: AuthGuard has already
 * bounced that case to /choose, and rendering nothing here would blank the
 * screen for a frame during the redirect.
 */
export function RequireMode({ mode, children }: { mode: AppMode; children: ReactNode }) {
  const current = useAppModeStore((s) => s.mode);
  if (current && current !== mode) {
    return <Navigate to={homePathFor(current)} replace />;
  }
  return <>{children}</>;
}
