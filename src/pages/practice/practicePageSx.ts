import type { SxProps, Theme } from '@mui/material';

/**
 * Root padding for the standalone practice screens. These routes render
 * outside MobileShell (like the round screens), so they must add the iOS
 * safe-area inset themselves — otherwise content sits under the status
 * bar / notch with `contentInset: 'never'`.
 */
export const practicePageSx = (maxWidth = 520): SxProps<Theme> => ({
  px: 2,
  pt: 'calc(env(safe-area-inset-top) + 16px)',
  pb: 'calc(env(safe-area-inset-bottom) + 16px)',
  maxWidth,
  mx: 'auto'
});
