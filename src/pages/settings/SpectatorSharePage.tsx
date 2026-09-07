import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Divider,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import IosShareRoundedIcon from '@mui/icons-material/IosShareRounded';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  formatShareCode,
  shareUrlFor,
  spectatorRepo,
  type SpectatorShare
} from '@/services/spectatorRepo';

/**
 * One share, rendered with its QR.
 *
 * The QR encodes the join URL rather than the bare code, so scanning it with a
 * phone's own camera app — which is what most people will do — opens straight
 * into the round instead of showing eight characters to retype.
 */
function ShareCard({ share, onRevoke }: { share: SpectatorShare; onRevoke: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const url = shareUrlFor(share.code);
  const pretty = formatShareCode(share.code);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Errors here are not worth surfacing: the code underneath the QR is the
    // real payload, and it is still perfectly usable if the drawing fails.
    void QRCode.toCanvas(canvas, url, { width: 200, margin: 1 }).catch(() => undefined);
  }, [url]);

  const copy = async (text: string, what: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(what);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setCopied(null);
    }
  };

  /** Native share sheet where there is one — the fastest route into a text
   *  message, which is how these actually get sent. */
  const share_ = async () => {
    const payload = {
      title: 'Follow my round',
      text: `Watch my round live — code ${pretty}`,
      url
    };
    if (navigator.share) {
      await navigator.share(payload).catch(() => undefined);
    } else {
      await copy(`${payload.text}\n${url}`, 'link');
    }
  };

  return (
    <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
      <CardContent>
        <Stack spacing={2} alignItems="center">
          {share.label && (
            <Typography variant="caption" color="text.secondary">
              {share.label}
            </Typography>
          )}
          <Box sx={{ bgcolor: '#fff', p: 1, borderRadius: 1, lineHeight: 0 }}>
            <canvas ref={canvasRef} />
          </Box>
          <Typography
            variant="h5"
            sx={{ fontWeight: 900, letterSpacing: 3, fontFamily: 'monospace' }}
          >
            {pretty}
          </Typography>

          <Stack direction="row" spacing={1} flexWrap="wrap" justifyContent="center" useFlexGap>
            <Button
              size="small"
              startIcon={<ContentCopyRoundedIcon />}
              onClick={() => copy(pretty, 'code')}
            >
              {copied === 'code' ? 'Copied' : 'Copy code'}
            </Button>
            <Button size="small" startIcon={<IosShareRoundedIcon />} onClick={() => void share_()}>
              {copied === 'link' ? 'Copied' : 'Share link'}
            </Button>
            <Button size="small" color="error" onClick={onRevoke}>
              Revoke
            </Button>
          </Stack>

          <Typography variant="caption" color="text.secondary" align="center">
            {share.view_count > 0
              ? `Opened ${share.view_count} time${share.view_count === 1 ? '' : 's'}${
                  share.last_viewed_at
                    ? `, last ${new Date(share.last_viewed_at).toLocaleString()}`
                    : ''
                }`
              : 'Not opened yet'}
          </Typography>
        </Stack>
      </CardContent>
    </Card>
  );
}

/**
 * Athlete side of spectator sharing.
 *
 * Generate a code, hand it to family, revoke it when the tournament's over. A
 * code only ever exposes TOURNAMENT rounds — a casual round is invisible to it
 * — which is what makes leaving one active between events safe.
 */
export function SpectatorSharePage() {
  const queryClient = useQueryClient();
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const shares = useQuery({
    queryKey: ['spectator-shares'],
    queryFn: () => spectatorRepo.listMine()
  });

  const invalidate = () =>
    queryClient.invalidateQueries({ queryKey: ['spectator-shares'] });

  const create = useMutation({
    mutationFn: (name: string) => spectatorRepo.create(name),
    onSuccess: () => {
      setLabel('');
      setError(null);
      invalidate();
    },
    onError: (err) => setError((err as Error).message)
  });

  const revoke = useMutation({
    mutationFn: (id: string) => spectatorRepo.revoke(id),
    onSuccess: invalidate,
    onError: (err) => setError((err as Error).message)
  });

  const rows = shares.data ?? [];

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', pb: 6 }}>
      <PageHeader title="Spectators" back="/settings" />
      <Stack spacing={2} sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Give family a code and they can follow your tournament rounds live — hole by hole scores,
          every shot, and the hole map. They don&apos;t need an account. Only tournament rounds are
          ever shown, so your other rounds stay private.
        </Typography>

        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
          <CardContent>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
            >
              New code
            </Typography>
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              <TextField
                size="small"
                fullWidth
                label="Who is it for? (optional)"
                placeholder="Mum"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
              />
              <Button
                variant="contained"
                onClick={() => create.mutate(label)}
                disabled={create.isPending}
                sx={{ flexShrink: 0 }}
              >
                {create.isPending ? '…' : 'Create'}
              </Button>
            </Stack>
            <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
              Make a separate code per person if you want to be able to cut one off without
              affecting the others.
            </Typography>
          </CardContent>
        </Card>

        {shares.isLoading ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 2 }}>
            No active codes.
          </Typography>
        ) : (
          <>
            <Divider />
            {rows.map((s) => (
              <ShareCard key={s.id} share={s} onRevoke={() => revoke.mutate(s.id)} />
            ))}
          </>
        )}
      </Stack>
    </Box>
  );
}
