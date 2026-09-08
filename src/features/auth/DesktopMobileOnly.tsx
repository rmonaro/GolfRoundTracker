import { Box, Button, Stack, Typography } from '@mui/material';
import PhoneIphoneRoundedIcon from '@mui/icons-material/PhoneIphoneRounded';
import { useNavigate } from 'react-router-dom';
import { authService } from '@/services/authService';

/**
 * What a signed-in non-admin sees on a desktop browser.
 *
 * Everything this app does for a golfer is built for a phone in one hand on a
 * course: GPS, the watch bridge, the hole map, one-thumb shot entry. None of it
 * is usable on a laptop and some of it isn't even meaningful there, so offering
 * it mostly generates bug reports about a product nobody is meant to be using
 * that way. Better to say so plainly than to render a round tracker that can't
 * track a round.
 *
 * Sign out is here on purpose — it is the one action that still makes sense,
 * and without it someone on a shared machine would have no way to leave.
 */
export function DesktopMobileOnly() {
  const navigate = useNavigate();

  return (
    <Box sx={{ display: 'grid', placeItems: 'center', minHeight: '100dvh', p: 4 }}>
      <Stack spacing={2} alignItems="center" sx={{ maxWidth: 380, textAlign: 'center' }}>
        <PhoneIphoneRoundedIcon sx={{ fontSize: 48, color: 'text.secondary' }} />
        <Typography variant="h6">Open this on your phone</Typography>
        <Typography variant="body2" color="text.secondary">
          Round tracking needs GPS and your watch, so it lives on your phone. Install the app there
          and sign in with the same account.
        </Typography>
        <Button
          variant="outlined"
          onClick={async () => {
            await authService.signOut();
            navigate('/auth/login', { replace: true });
          }}
        >
          Sign out
        </Button>
      </Stack>
    </Box>
  );
}
