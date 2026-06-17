import { useState, type FormEvent } from 'react';
import { Alert, Button, Stack, TextField, Typography, Link as MuiLink } from '@mui/material';
import { Link } from 'react-router-dom';
import { authService } from '@/services/authService';
import { toAppError } from '@/services/errors';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setInfo(null);
    setError(null);
    setLoading(true);
    try {
      await authService.sendPasswordReset(email.trim());
      setInfo('Check your inbox for the password reset link.');
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
          Forgot your password?
        </Typography>
        <Typography variant="body2" color="text.secondary" align="center">
          Enter your email and we'll send you a reset link.
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {info && <Alert severity="success">{info}</Alert>}
        <TextField
          label="Email"
          type="email"
          autoComplete="email"
          inputMode="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Button type="submit" variant="contained" size="large" disabled={loading}>
          {loading ? 'Sending…' : 'Send Reset Link'}
        </Button>
        <MuiLink component={Link} to="/auth/login" underline="hover" variant="body2" align="center">
          Back to login
        </MuiLink>
      </Stack>
    </form>
  );
}
