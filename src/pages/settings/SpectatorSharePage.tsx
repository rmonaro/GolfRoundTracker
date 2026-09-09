import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography
} from '@mui/material';
import ContentCopyRoundedIcon from '@mui/icons-material/ContentCopyRounded';
import IosShareRoundedIcon from '@mui/icons-material/IosShareRounded';
import { useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import QRCode from 'qrcode';
import { PageHeader } from '@/components/layout/PageHeader';
import {
  formatShareCode,
  shareUrlFor,
  spectatorRepo,
  type SpectatorShare
} from '@/services/spectatorRepo';

function invalidateShares(queryClient: ReturnType<typeof useQueryClient>) {
  return queryClient.invalidateQueries({ queryKey: ['spectator-shares'] });
}

/**
 * One share, rendered with its QR.
 *
 * The QR encodes the join URL rather than the bare code, so scanning it with a
 * phone's own camera app — which is what most people will do — opens straight
 * into the round instead of showing eight characters to retype.
 */
function ShareCard({
  share,
  onRevoke,
  revokeLabel = 'Reset code'
}: {
  share: SpectatorShare;
  onRevoke: () => void;
  revokeLabel?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const url = shareUrlFor(share.code);
  const pretty = formatShareCode(share.code);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // With no public web origin configured there is no link to encode, so the
    // QR carries the CODE itself — a camera then shows eight characters to type
    // in, which is worse than a link but works, unlike a `capacitor://` URL
    // that resolves only on this phone. See shareUrlFor.
    // Errors here are not worth surfacing: the code underneath the QR is the
    // real payload, and it is still perfectly usable if the drawing fails.
    void QRCode.toCanvas(canvas, url ?? pretty, { width: 200, margin: 1 }).catch(
      () => undefined
    );
  }, [url, pretty]);

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
    // With no link to send, the message has to carry the instructions — the
    // recipient gets eight characters and no idea what to do with them
    // otherwise. Names the exact button they are looking for.
    const text = url
      ? `Watch my round live — code ${pretty}`
      : `Watch my round live in Golf Round Tracker. Install the app, tap "Watch with a code" on the sign-in screen, and enter ${pretty}`;
    // Omit `url` entirely when there isn't a real one. Passing a
    // `capacitor://` link makes the share sheet send something no recipient can
    // open; the code on its own is always usable.
    const payload = url ? { title: 'Follow my round', text, url } : { title: 'Follow my round', text };
    if (navigator.share) {
      await navigator.share(payload).catch(() => undefined);
    } else {
      await copy(url ? `${text}\n${url}` : text, 'link');
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
              {copied === 'link' ? 'Copied' : url ? 'Share link' : 'Share code'}
            </Button>
            {/* One code per athlete, so this is a ROTATE, not a delete: the old
                code stops working immediately and a fresh one is minted in its
                place. Anyone still holding the old one is refused as if it had
                never existed. */}
            <Button size="small" color="error" onClick={onRevoke}>
              {revokeLabel}
            </Button>
          </Stack>

          {!url && (
            <Typography variant="caption" color="text.secondary" align="center">
              They need the app. On the sign-in screen, tap{' '}
              <strong>Watch with a code</strong> — then scan this, or type the code.
            </Typography>
          )}
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
  const [error, setError] = useState<string | null>(null);

  const shares = useQuery({
    queryKey: ['spectator-shares'],
    queryFn: () => spectatorRepo.listMine()
  });

  // Mint the first code automatically.
  //
  // Having to press "Create" before anyone could watch meant the athlete found
  // out they had no code at the moment someone asked for it. A code exposes
  // tournament rounds and nothing else, so there is no decision to put in front
  // of them — the screen should already have one to show.
  //
  // The ref is what makes this fire once. `shares.data` changes identity on
  // every refetch, and without the guard a slow create would let a second
  // render start another one; `ensureShare` is idempotent server-side but two
  // in flight at once would still race to mint two codes.
  const autoCreated = useRef(false);
  const ensure = useMutation({
    mutationFn: () => spectatorRepo.ensureShare(),
    onSuccess: () => invalidateShares(queryClient),
    onError: (err) => setError((err as Error).message)
  });
  useEffect(() => {
    if (autoCreated.current) return;
    if (shares.isLoading || shares.error) return;
    if ((shares.data ?? []).length > 0) return;
    autoCreated.current = true;
    ensure.mutate();
    // `ensure` is a stable mutation object from React Query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shares.data, shares.isLoading, shares.error]);

  const invalidate = () => invalidateShares(queryClient);

  const revoke = useMutation({
    mutationFn: (id: string) => spectatorRepo.revoke(id),
    // Re-arm the auto-mint. With no create form left, revoking the only code
    // would otherwise leave the athlete on an empty screen with no way back —
    // so "reset" means exactly that: the old code stops working and a fresh one
    // takes its place on the next pass of the effect above.
    onSuccess: () => {
      autoCreated.current = false;
      return invalidate();
    },
    onError: (err) => setError((err as Error).message)
  });

  const rows = shares.data ?? [];
  const location = useLocation();

  // Reached two ways (see AppRouter): as the tournament side's Follow TAB,
  // where a back arrow would be wrong because a tab is a destination, and from
  // the Settings card, where it must go back there.
  const asTab = location.pathname.startsWith('/follow');

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', pb: 6 }}>
      <PageHeader
        title={asTab ? 'Follow My Rounds' : 'Spectators'}
        {...(asTab ? {} : { back: '/settings' })}
      />
      <Stack spacing={2} sx={{ p: 2 }}>
        <Typography variant="body2" color="text.secondary">
          Give family a code and they can follow your tournament rounds live — hole by hole scores,
          every shot, and the hole map. They need the app but not an account: on the sign-in
          screen they tap <strong>Watch with a code</strong>. Only tournament rounds are ever
          shown, so your other rounds stay private.
        </Typography>

        {error && (
          <Alert severity="error" onClose={() => setError(null)}>
            {error}
          </Alert>
        )}

        {shares.isLoading || ensure.isPending ? (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
            <CircularProgress />
          </Box>
        ) : rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary" align="center" sx={{ py: 2 }}>
            Making a code…
          </Typography>
        ) : (
          <>
            <ShareCard share={rows[0]} onRevoke={() => revoke.mutate(rows[0].id)} />

            {/* Codes minted before this screen dropped its create form. They are
                STILL LIVE, so they cannot just be hidden — a credential nobody
                can see is one nobody can turn off. Listed plainly, with a
                revoke each, and they disappear for good once retired. */}
            {rows.length > 1 && (
              <>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ textTransform: 'uppercase', letterSpacing: 0.6, pt: 1 }}
                >
                  Older codes, still working
                </Typography>
                {rows.slice(1).map((s) => (
                  <ShareCard
                    key={s.id}
                    share={s}
                    revokeLabel="Revoke"
                    onRevoke={() => revoke.mutate(s.id)}
                  />
                ))}
              </>
            )}
          </>
        )}

      </Stack>
    </Box>
  );
}
