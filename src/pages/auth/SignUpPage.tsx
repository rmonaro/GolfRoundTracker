import { useState, type FormEvent } from 'react';
import { Alert, Button, Stack, TextField, Typography, Link as MuiLink } from '@mui/material';
import { Link, useNavigate } from 'react-router-dom';
import { authService } from '@/services/authService';
import { toAppError } from '@/services/errors';

export function SignUpPage() {
  const navigate = useNavigate();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const result = await authService.signUp(email.trim(), password, firstName.trim(), lastName.trim());
      if (result.session) {
        navigate('/', { replace: true });
      } else {
        setInfo('Check your email to confirm your account.');
      }
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
          Create your account
        </Typography>
        {error && <Alert severity="error">{error}</Alert>}
        {info && <Alert severity="info">{info}</Alert>}
        <Stack direction="row" spacing={1.5}>
          <TextField label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          <TextField label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} required />
        </Stack>
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
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          helperText="At least 8 characters"
          inputProps={{ minLength: 8 }}
        />
        <Button type="submit" variant="contained" size="large" disabled={loading}>
          {loading ? 'Creating…' : 'Sign Up'}
        </Button>
        <MuiLink component={Link} to="/auth/login" underline="hover" variant="body2" align="center">
          Already have an account? Log in
        </MuiLink>
      </Stack>
    </form>
  );
}
