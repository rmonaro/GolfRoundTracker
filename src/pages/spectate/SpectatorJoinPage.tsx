import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Box,
  Button,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Typography,
  Link as MuiLink
} from '@mui/material';
import QrCodeScannerRoundedIcon from '@mui/icons-material/QrCodeScannerRounded';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { spectatorFeed } from '@/services/spectatorFeed';
import { formatShareCode, normaliseShareCode, spectatorRepo } from '@/services/spectatorRepo';
import { useSpectatorStore } from '@/stores/spectatorStore';
import { useAuthStore } from '@/stores/authStore';
import { QrScanner } from '@/features/spectate/QrScanner';

/**
 * A QR can carry either the join link we generate or, if someone typed one out,
 * a bare code. Pull the code out of whatever came back rather than insisting on
 * one shape.
 */
function codeFromScan(text: string): string {
  try {
    const url = new URL(text);
    const fromQuery = url.searchParams.get('code');
    if (fromQuery) return normaliseShareCode(fromQuery);
  } catch {
    // Not a URL — fall through and treat it as a code.
  }
  return normaliseShareCode(text);
}

/**
 * Where a spectator starts: enter the code an athlete gave you, or scan it.
 *
 * Deliberately reachable without an account and without a session — this is the
 * whole point of the feature. A grandparent should get from a text message to
 * watching in two taps.
 */
export function SpectatorJoinPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const join = useSpectatorStore((s) => s.join);
  const signedIn = useAuthStore((s) => !!s.session);

  // Athletes this viewer saved to their account (migration 045). Signed-out
  // viewers have none by definition, so the query never runs for them.
  const follows = useQuery({
    queryKey: ['spectator-follows'],
    enabled: signedIn,
    queryFn: () => spectatorRepo.listFollows()
  });
  const [code, setCode] = useState(() => formatShareCode(params.get('code') ?? ''));
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const submit = async (raw: string) => {
    const bare = normaliseShareCode(raw);
    if (bare.length < 6) {
      setError('That code looks too short. It should be eight characters.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const result = await spectatorFeed.join(bare);
      join(bare, result.athleteName);
      navigate('/spectate/live', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not check that code.');
    } finally {
      setLoading(false);
    }
  };

  // Arriving from a scanned link (?code=...) should just work — that is the
  // path a phone's own camera app takes, and asking someone to press a button
  // after they have already scanned the thing is a wasted step.
  useEffect(() => {
    const fromLink = params.get('code');
    if (fromLink) void submit(normaliseShareCode(fromLink));
    // Once, on arrival.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit(code);
  };

  if (scanning) {
    return (
      <Stack spacing={2.5}>
        <Typography variant="h5" align="center" sx={{ fontWeight: 900 }}>
          Scan the code
        </Typography>
        <QrScanner
          onResult={(text) => {
            setScanning(false);
            const found = codeFromScan(text);
            setCode(formatShareCode(found));
            void submit(found);
          }}
          onCancel={() => setScanning(false)}
        />
      </Stack>
    );
  }

  return (
    <form onSubmit={onSubmit}>
      <Stack spacing={2.5}>
        <Box>
          <Typography variant="h5" align="center" sx={{ fontWeight: 900, fontSize: '32px' }}>
            Watch a round
          </Typography>
          <Typography variant="body2" color="text.secondary" align="center" sx={{ mt: 1 }}>
            Enter the code your athlete gave you. No account needed.
          </Typography>
        </Box>

        {error && <Alert severity="error">{error}</Alert>}

        {/* Saved athletes — one tap back into somebody they already follow,
            above the code field because for a returning viewer this IS the
            screen. A revoked follow stays listed and says so, rather than
            vanishing and leaving them wondering where their player went. */}
        {signedIn && (follows.data?.length ?? 0) > 0 && (
          <Stack spacing={1}>
            <Typography variant="caption" color="text.secondary">
              Saved
            </Typography>
            {follows.data!.map((f) => (
              <Button
                key={f.id}
                variant="outlined"
                size="large"
                disabled={loading || f.revoked}
                onClick={() => void submit(f.code)}
                sx={{ justifyContent: 'flex-start' }}
              >
                {f.athlete_name ?? 'Athlete'}
                {f.revoked ? ' · code no longer active' : ''}
              </Button>
            ))}
            <Divider sx={{ pt: 1 }} />
          </Stack>
        )}

        <TextField
          label="Spectator code"
          placeholder="ABCD-EFGH"
          value={code}
          // Re-group as they type so the field always reads back the way the
          // athlete's screen shows it.
          onChange={(e) => setCode(formatShareCode(e.target.value))}
          autoComplete="off"
          autoCapitalize="characters"
          inputProps={{ style: { textTransform: 'uppercase', letterSpacing: 2, fontSize: 20 } }}
          disabled={loading}
        />

        <Button type="submit" variant="contained" size="large" disabled={loading}>
          {loading ? <CircularProgress size={22} /> : 'Start watching'}
        </Button>

        <Button
          startIcon={<QrCodeScannerRoundedIcon />}
          onClick={() => setScanning(true)}
          disabled={loading}
        >
          Scan QR code instead
        </Button>

        <MuiLink component={Link} to="/auth/login" underline="hover" variant="body2" align="center">
          Back to log in
        </MuiLink>
      </Stack>
    </form>
  );
}
