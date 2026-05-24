import { Box, Stack, Typography } from '@mui/material';
import { Outlet } from 'react-router-dom';

export function AuthLayout() {
  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        bgcolor: 'background.default',
        px: 3,
        py: 6,
        backgroundImage:
          'radial-gradient(ellipse at top, rgba(46,125,50,0.25), transparent 60%), radial-gradient(ellipse at bottom, rgba(76,175,80,0.18), transparent 70%)'
      }}
    >
      <Stack alignItems="center" spacing={1} mt={2}>
        <Box
          sx={{
            width: 64,
            height: 64,
            borderRadius: 4,
            display: 'grid',
            placeItems: 'center',
            bgcolor: 'primary.main',
            color: 'primary.contrastText',
            fontWeight: 800,
            fontSize: 28
          }}
        >
          GT
        </Box>
        <Typography variant="h5">Golf Round Tracker</Typography>
        <Typography variant="body2" color="text.secondary">
          Score, shot, and handicap in one place.
        </Typography>
      </Stack>

      <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
        <Box sx={{ width: '100%', maxWidth: 420 }}>
          <Outlet />
        </Box>
      </Box>

      <Typography variant="caption" color="text.secondary" align="center">
        Estimated handicap only. Not an official USGA handicap.
      </Typography>
    </Box>
  );
}
