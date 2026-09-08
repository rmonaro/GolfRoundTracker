import { useMediaQuery, useTheme } from '@mui/material';
import { Capacitor } from '@capacitor/core';

/**
 * "Is this a desktop browser?" — the single definition, so the admin gate, the
 * sign-up gate and the desktop routing rule can't drift apart.
 *
 * Two conditions, and the native check is the one that matters. Width alone is
 * not enough: an iPhone 15 Pro Max in landscape is 932px and an iPad is wider
 * still, so a viewport test on its own would decide the native app was a
 * desktop and lock a golfer standing on the tee out of their own round. The
 * Capacitor shell is the mobile app by definition, whatever size it is.
 */
export function useIsDesktop(): boolean {
  const theme = useTheme();
  // `md` ~ 900px. Laptops and desktops pass; phones in either orientation don't.
  const wideViewport = useMediaQuery(theme.breakpoints.up('md'));
  return !Capacitor.isNativePlatform() && wideViewport;
}
