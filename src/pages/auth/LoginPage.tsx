import { useState, type FormEvent } from 'react';
import { Alert, Button, Stack, TextField, Typography, Link as MuiLink } from '@mui/material';
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
        <Stack direction="row" justifyContent="space-between">
          <MuiLink component={Link} to="/auth/forgot-password" underline="hover" variant="body2">
            Forgot password?
          </MuiLink>
          <MuiLink component={Link} to="/auth/signup" underline="hover" variant="body2">
            Create account
          </MuiLink>
        </Stack>
      </Stack>
    </form>
  );
}
