import { useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Divider,
  Stack,
  TextField,
  Typography,
  Link as MuiLink
} from '@mui/material';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import { useIsDesktop } from '@/hooks/useIsDesktop';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { authService } from '@/services/authService';
import { toAppError } from '@/services/errors';

export function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Accounts are created on the phone, where the app actually runs — see the
  // note on the sign-up link below.
  const isDesktop = useIsDesktop();

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await authService.signIn(email.trim(), password);
      const from = (location.state as { from?: { pathname?: string } } | null)?.from?.pathname ?? '/';
      navigate(from, { replace: true });
    } catch (err) {
      setError(toAppError(err).message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={onSubmit}>
      <Stack spacing={2.5}>
        <Typography variant="h5" align="center" sx={{ fontWeight: 900, fontSize: '32px' }}>
          Welcome back
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          inputMode="email"
        />
        <TextField
          label="Password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Button type="submit" variant="contained" size="large" disabled={loading}>
          {loading ? 'Logging in…' : 'Log In'}
        </Button>
        {/* Sign-up is phone-only. A desktop browser can't run a round — GPS,
            the watch and the hole map are all phone features — so an account
            created here would land its owner straight on the "open this on your
            phone" screen. Better not to offer the dead end. Existing users can
            still sign in on desktop; admins get the panel. */}
        <Stack direction="row" justifyContent={isDesktop ? 'center' : 'space-between'}>
          <MuiLink component={Link} to="/auth/forgot-password" underline="hover" variant="body2">
            Forgot password?
          </MuiLink>
          {!isDesktop && (
            <MuiLink component={Link} to="/auth/signup" underline="hover" variant="body2">
              Create account
            </MuiLink>
          )}
        </Stack>

        {/* Spectators never sign in. A parent or grandparent has a code, not an
            account, so this has to be reachable from the screen they land on —
            not hidden behind one.

            Phone only. On a desktop browser the sign-in screen offers exactly
            two things: sign in, and reset your password. The /spectate route
            itself still works on desktop, which is what matters — the QR and
            the shared link both carry `?code=`, so a spectator lands straight
            in the round rather than ever needing this button. */}
        {!isDesktop && (
          <>
            <Divider sx={{ pt: 1 }}>
              <Typography variant="caption" color="text.secondary">
                or
              </Typography>
            </Divider>
            <Button
              component={Link}
              to="/spectate"
              variant="outlined"
              size="large"
              startIcon={<VisibilityRoundedIcon />}
            >
              Watch with a code
            </Button>
            <Typography variant="caption" color="text.secondary" align="center">
              Following an athlete? Enter or scan the code they sent you — no account needed.
            </Typography>
          </>
        )}
      </Stack>
    </form>
  );
}
