import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Divider,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { spectatorFeed, type SpectatorFeed } from '@/services/spectatorFeed';
import { useSpectatorStore } from '@/stores/spectatorStore';
import { useAuthStore } from '@/stores/authStore';
import { SpectatorHoleMap } from '@/features/spectate/SpectatorHoleMap';
import { SpectatorMapView } from '@/features/spectate/SpectatorMapView';
import { scoreVsPar } from '@/utils/format';
import type { RoundHole, Shot } from '@/models';

/**
 * How often the live view asks for a fresh card.
 *
 * The real constraint is upstream: the athlete's phone reconciles its round to
 * Supabase on a 60-second scheduler (`useSyncScheduler`), so nothing a
 * spectator does can make the data fresher than that. Polling at 15s means a
 * shot appears within a few seconds of landing on the server without turning a
 * grandparent's phone into a space heater for four hours.
 */
const POLL_MS = 15_000;

/** Once a round is finished nothing about it will change again. */
const FINISHED_POLL_MS = 5 * 60_000;

function thruLabel(holes: RoundHole[]): string {
  const played = holes.filter((h) => (h.strokes ?? 0) > 0 || (h.penalty_strokes ?? 0) > 0);
  if (played.length === 0) return 'Not started';
  return `Thru ${played.length}`;
}

/** Running score against par over the holes actually played so far. */
function liveVsPar(holes: RoundHole[]): { strokes: number; par: number; vsPar: number } {
  let strokes = 0;
  let par = 0;
  for (const h of holes) {
    const s = (h.strokes ?? 0) + (h.penalty_strokes ?? 0);
    if (s > 0) {
      strokes += s;
      par += h.par ?? 0;
    }
  }
  return { strokes, par, vsPar: strokes - par };
}

function shotDescription(shot: Shot, clubs: Record<string, string>): string {
  const club = shot.club_id ? clubs[shot.club_id] : null;
  const distance =
    shot.calculated_distance ?? shot.distance ?? null;
  const unit = shot.distance_unit === 'feet' ? 'ft' : 'yds';
  const bits = [club, distance != null ? `${Math.round(distance)} ${unit}` : null].filter(Boolean);
  return bits.length ? bits.join(' · ') : 'Shot recorded';
}

/**
 * What a spectator sees: one athlete's tournament round, refreshing itself.
 *
 * No account, no session — everything on this screen came back from the
 * `spectator-api` edge function in exchange for the code held in
 * `spectatorStore`. If the athlete revokes it, the next poll fails and this
 * screen says so rather than sitting on stale data.
 */
export function SpectatorLivePage() {
  const navigate = useNavigate();
  const code = useSpectatorStore((s) => s.code);
  const storedRoundId = useSpectatorStore((s) => s.roundId);
  const selectRound = useSpectatorStore((s) => s.selectRound);
  const leave = useSpectatorStore((s) => s.leave);
  const setPendingFollow = useSpectatorStore((s) => s.setPendingFollow);
  const signedIn = useAuthStore((s) => !!s.session);
  /** Shown on the way out — see the dialog at the foot of this file. */
  const [leaving, setLeaving] = useState(false);
  const [holeNumber, setHoleNumber] = useState<number | null>(null);

  useEffect(() => {
    if (!code) navigate('/spectate', { replace: true });
  }, [code, navigate]);

  const { data, error, isLoading, dataUpdatedAt } = useQuery<SpectatorFeed>({
    queryKey: ['spectator-feed', code, storedRoundId],
    enabled: !!code,
    queryFn: () => spectatorFeed.fetch(code!, storedRoundId),
    // A finished round can't change; keep asking only while one is in play.
    refetchInterval: (query) =>
      query.state.data?.round?.completed_at ? FINISHED_POLL_MS : POLL_MS,
    refetchIntervalInBackground: false,
    // Keep the last good card on screen through a blip rather than flashing a
    // spinner over a round somebody is watching.
    placeholderData: (prev) => prev,
    retry: 1
  });

  const holes = data?.holes ?? [];
  const shots = data?.shots ?? [];

  /** round_holes.id → hole number, since shots reference the hole row. */
  const holeNumberById = useMemo(() => {
    const map = new Map<string, number>();
    for (const h of holes) map.set(h.id, h.hole_number);
    return map;
  }, [holes]);

  const shotsByHole = useMemo(() => {
    const map = new Map<number, Shot[]>();
    for (const s of shots) {
      const n = holeNumberById.get(s.hole_id);
      if (n == null) continue;
      const arr = map.get(n) ?? [];
      arr.push(s);
      map.set(n, arr);
    }
    for (const arr of map.values()) arr.sort((a, b) => a.shot_number - b.shot_number);
    return map;
  }, [shots, holeNumberById]);

  /** The hole they're on — the highest-numbered one with anything recorded. */
  const currentHole = useMemo(() => {
    const played = holes.filter((h) => (h.strokes ?? 0) > 0 || (h.penalty_strokes ?? 0) > 0);
    return played.length ? Math.max(...played.map((h) => h.hole_number)) : holes[0]?.hole_number ?? null;
  }, [holes]);

  // Follow the athlete around the course unless the viewer has picked a hole to
  // look at, in which case leave them there.
  const [pinnedHole, setPinnedHole] = useState(false);
  /** Full-screen read-only map. See SpectatorMapView. */
  const [mapOpen, setMapOpen] = useState(false);
  useEffect(() => {
    if (!pinnedHole) setHoleNumber(currentHole);
  }, [currentHole, pinnedHole]);

  if (!code) return null;

  const round = data?.round ?? null;
  const totals = liveVsPar(holes);
  const shownHole = holeNumber ?? currentHole;
  const shownHoleRow = holes.find((h) => h.hole_number === shownHole) ?? null;
  const shownShots = shownHole != null ? (shotsByHole.get(shownHole) ?? []) : [];

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default', pb: 4 }}>
      <PageHeader
        title={data?.athleteName ?? 'Watching'}
        subtitle={round?.course_name ?? undefined}
        action={
          <Button size="small" onClick={() => setLeaving(true)}>
            Leave
          </Button>
        }
      />

      <Stack spacing={2} sx={{ p: 2 }}>
        {error && (
          <Alert severity="error">
            {error instanceof Error ? error.message : 'Could not refresh.'}
          </Alert>
        )}

        {isLoading && !data && (
          <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
            <CircularProgress />
          </Box>
        )}

        {data && !round && (
          <Alert severity="info">
            {data.athleteName} has no tournament rounds yet. This screen will fill in as soon as
            they start one.
          </Alert>
        )}

        {round && (
          <>
            {/* Which round. Only offered when there's more than one, so a
                single-round tournament doesn't grow a pointless dropdown. */}
            {data!.rounds.length > 1 && (
              <TextField
                select
                size="small"
                label="Round"
                value={round.id}
                onChange={(e) => {
                  selectRound(e.target.value);
                  setPinnedHole(false);
                }}
              >
                {data!.rounds.map((r) => (
                  <MenuItem key={r.id} value={r.id}>
                    {r.tm_round_number ? `Round ${r.tm_round_number}` : 'Round'} ·{' '}
                    {new Date(r.started_at).toLocaleDateString()} · {r.course_name}
                  </MenuItem>
                ))}
              </TextField>
            )}

            <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
              <CardContent>
                <Stack direction="row" alignItems="baseline" spacing={2}>
                  <Typography variant="h3" sx={{ fontWeight: 900, lineHeight: 1 }}>
                    {scoreVsPar(totals.strokes, totals.par)}
                  </Typography>
                  <Stack>
                    <Typography variant="body2">{thruLabel(holes)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {totals.strokes} strokes
                      {round.tee_name ? ` · ${round.tee_name} tees` : ''}
                    </Typography>
                  </Stack>
                  <Box sx={{ flex: 1 }} />
                  <Chip
                    size="small"
                    color={round.completed_at ? 'default' : 'success'}
                    label={round.completed_at ? 'Finished' : 'Live'}
                  />
                </Stack>
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  {round.completed_at
                    ? `Finished ${new Date(round.completed_at).toLocaleString()}`
                    : `Updated ${new Date(dataUpdatedAt).toLocaleTimeString()} · refreshes automatically`}
                </Typography>
              </CardContent>
            </Card>

            {/* Hole strip. Tapping pins the view to that hole; the Follow
                button hands control back to the athlete's progress. */}
            <Box>
              <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 0.5 }}>
                <Typography variant="caption" color="text.secondary">
                  Holes
                </Typography>
                <Box sx={{ flex: 1 }} />
                {pinnedHole && (
                  <Button
                    size="small"
                    onClick={() => {
                      setPinnedHole(false);
                      setHoleNumber(currentHole);
                    }}
                  >
                    Follow live
                  </Button>
                )}
              </Stack>
              <Box sx={{ display: 'flex', gap: 0.5, overflowX: 'auto', pb: 1 }}>
                {holes.map((h) => {
                  const played = (h.strokes ?? 0) > 0 || (h.penalty_strokes ?? 0) > 0;
                  const vs = played ? (h.strokes ?? 0) + (h.penalty_strokes ?? 0) - (h.par ?? 0) : null;
                  return (
                    <Box
                      key={h.id}
                      onClick={() => {
                        setPinnedHole(true);
                        setHoleNumber(h.hole_number);
                      }}
                      sx={{
                        flex: '0 0 auto',
                        width: 46,
                        py: 0.75,
                        textAlign: 'center',
                        borderRadius: 1,
                        cursor: 'pointer',
                        border: 1,
                        borderColor: shownHole === h.hole_number ? 'primary.main' : 'divider',
                        bgcolor: shownHole === h.hole_number ? 'action.selected' : 'transparent'
                      }}
                    >
                      <Typography variant="caption" color="text.secondary" display="block">
                        {h.hole_number}
                      </Typography>
                      <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {played ? (h.strokes ?? 0) + (h.penalty_strokes ?? 0) : '–'}
                      </Typography>
                      <Typography
                        variant="caption"
                        color={
                          vs == null ? 'text.disabled' : vs < 0 ? 'success.main' : vs > 0 ? 'error.main' : 'text.secondary'
                        }
                      >
                        {vs == null ? `p${h.par ?? '-'}` : scoreVsPar(vs, 0)}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            </Box>

            {shownHole != null && (
              <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
                <CardContent>
                  <Stack direction="row" alignItems="baseline" spacing={1} sx={{ mb: 1 }}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                      Hole {shownHole}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Par {shownHoleRow?.par ?? '—'}
                      {shownHoleRow?.yardage ? ` · ${shownHoleRow.yardage} yds` : ''}
                    </Typography>
                  </Stack>

                  {round.course_id && (
                    <Box
                      sx={{
                        height: 260,
                        mb: 1.5,
                        borderRadius: 1,
                        overflow: 'hidden',
                        position: 'relative'
                      }}
                    >
                      <SpectatorHoleMap
                        code={code}
                        courseId={round.course_id}
                        holeNumber={shownHole}
                        shots={shownShots}
                        clubs={data!.clubs}
                      />
                      {/* Opens the same map full screen. The card is a glance;
                          this is for actually reading the hole. */}
                      <IconButton
                        aria-label="Open full map"
                        onClick={() => setMapOpen(true)}
                        sx={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          bgcolor: 'background.paper',
                          boxShadow: 2,
                          '&:hover': { bgcolor: 'background.paper' }
                        }}
                      >
                        <OpenInFullRoundedIcon fontSize="small" />
                      </IconButton>
                    </Box>
                  )}

                  {shownShots.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No shots recorded on this hole yet.
                    </Typography>
                  ) : (
                    <Stack divider={<Divider flexItem />}>
                      {shownShots.map((s) => (
                        <Stack
                          key={s.id}
                          direction="row"
                          alignItems="center"
                          spacing={1.5}
                          sx={{ py: 0.75 }}
                        >
                          <Typography
                            variant="caption"
                            sx={{ width: 20, color: 'text.secondary', flexShrink: 0 }}
                          >
                            {s.shot_number}
                          </Typography>
                          <Typography variant="body2" sx={{ flex: 1 }}>
                            {shotDescription(s, data!.clubs)}
                          </Typography>
                          {s.lie && <Chip size="small" label={s.lie} />}
                        </Stack>
                      ))}
                    </Stack>
                  )}
                </CardContent>
              </Card>
            )}
          </>
        )}
      </Stack>

      {/* Leaving is the one moment the viewer knows they might want this
          athlete back, and the only moment the app can ask. A code lives in
          this phone's localStorage and nowhere else: clear the app's data,
          change handset, or watch somebody else, and it is gone. */}
      <Dialog
        open={leaving}
        onClose={() => setLeaving(false)}
        fullWidth
        maxWidth="xs"
        PaperProps={{ sx: { borderRadius: '5px' } }}
      >
        <DialogTitle>Keep following {data?.athleteName ?? 'this player'}?</DialogTitle>
        <DialogContent>
          <DialogContentText variant="body2">
            {signedIn
              ? `Save ${data?.athleteName ?? 'this player'} to your account and you can come back to their rounds — including finished ones — without the code.`
              : `A free account remembers them, so you can watch their next round, and look back over past ones, without asking for the code again. It works on any phone you sign in on.`}
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ flexWrap: 'wrap', gap: 1, px: 3, pb: 2 }}>
          <Button
            onClick={() => {
              setLeaving(false);
              leave();
              navigate('/spectate', { replace: true });
            }}
          >
            Just leave
          </Button>
          <Box sx={{ flex: 1 }} />
          <Button
            variant="contained"
            onClick={() => {
              // Park the code either way. Signed in, `useFlushSpectatorFollow`
              // redeems it on the next render; signed out, it survives the
              // whole sign-up detour and is redeemed the moment a session
              // exists. Neither path needs this screen to still be mounted.
              if (code) setPendingFollow(code);
              setLeaving(false);
              leave();
              if (signedIn) {
                navigate('/spectate', { replace: true });
              } else {
                navigate('/auth/signup', { replace: true });
              }
            }}
          >
            {signedIn ? 'Save to my account' : 'Create free account'}
          </Button>
        </DialogActions>
      </Dialog>

      {round?.course_id && shownHole != null && (
        <SpectatorMapView
          open={mapOpen}
          onClose={() => setMapOpen(false)}
          code={code}
          courseId={round.course_id}
          athleteName={data?.athleteName ?? ''}
          holeNumber={shownHole}
          holes={holes}
          holeRow={shownHoleRow}
          shots={shownShots}
          clubs={data?.clubs ?? {}}
          // Stepping holes in the map pins the view, exactly as tapping the
          // hole strip does — otherwise the next poll would yank the viewer
          // back to whatever hole the athlete is on.
          onHoleChange={(n) => {
            setPinnedHole(true);
            setHoleNumber(n);
          }}
        />
      )}
    </Box>
  );
}
