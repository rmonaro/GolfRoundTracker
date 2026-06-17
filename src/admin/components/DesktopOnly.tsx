import type { ReactNode } from 'react';
import { Box, Stack, Typography, useMediaQuery, useTheme } from '@mui/material';
import DesktopWindowsRoundedIcon from '@mui/icons-material/DesktopWindowsRounded';

/**
 * Gate that only renders its children on desktop-width viewports. The admin
 * panel is data-dense (wide tables) and intentionally desktop-only; on smaller
 * screens it shows a friendly notice instead.
 */
export function DesktopOnly({ children }: { children: ReactNode }) {
  const theme = useTheme();
  // `md` ~ 900px. Tablets in landscape and laptops/desktops pass; phones don't.
  const isDesktop = useMediaQuery(theme.breakpoints.up('md'));

  if (!isDesktop) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', p: 4 }}>
        <Stack spacing={2} alignItems="center" sx={{ maxWidth: 360, textAlign: 'center' }}>
          <DesktopWindowsRoundedIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
          <Typography variant="h6">Desktop only</Typography>
          <Typography variant="body2" color="text.secondary">
            The admin panel is only available on a larger screen. Please open it on a desktop or
            laptop.
          </Typography>
        </Stack>
      </Box>
    );
  }

  return <>{children}</>;
}
