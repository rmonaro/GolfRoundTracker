// The scorekeeper's tracking screen: 2-4 players, one hole at a time.
//
// The group walks the course together, so the HOLE is shared state and the
// PLAYER is what you switch between. Switching players calls switchRound, which
// makes that player's card the active round — which in turn means every existing
// round mutator, and the offline reconciler, work on them unchanged.
//
// Deliberately absent: auto-track, watch integration and live-GPS club
// selection. The phone's GPS is the scorekeeper's position, not any player's
// ball, so ball positions come from tapping the map instead.

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Paper,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography
} from '@mui/material';
import ChevronLeftRoundedIcon from '@mui/icons-material/ChevronLeftRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import MapRoundedIcon from '@mui/icons-material/MapRounded';
import SpeedRoundedIcon from '@mui/icons-material/SpeedRounded';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import { PageHeader } from '@/components/layout/PageHeader';
import { HoleLayoutCard } from '@/features/course/HoleLayoutCard';
import { AddShotSheet } from '@/features/round/AddShotSheet';
import { SyncStatusChip } from '@/features/offline/SyncStatusChip';
import { ScorerQuickEntry, type QuickEntryChange } from '@/features/tournaments/ScorerQuickEntry';
import { useScorerAssignment } from '@/features/tournaments/useScorerAssignments';
import { finalizeScorerRound, pushScorerHole } from '@/features/tournaments/scorerPush';
import { enqueueFinishedRound, syncRound } from '@/services/roundSync';
import { computeTotalScore, holeTotalScore } from '@/features/round/computeRoundTotals';
import { abbreviateClubName } from '@/features/bag/abbreviateClubName';
import { useBagStore } from '@/stores/bagStore';
import { useRoundStore, type ActiveRound, type LocalHole } from '@/stores/roundStore';
import { newId } from '@/lib/ids';
import type { Lie, TargetResult } from '@/models';

/** Pending map tap, waiting for the shot sheet to collect the rest. */
interface PendingLanding {
  start: [number, number];
  end: [number, number];
  calculatedDistanceM: number;
  inferredLie: Lie | null;
  inferredTargetResult: TargetResult | null;
}

/** Exactly what AddShotSheet hands back, without re-declaring its shape. */
type ShotSubmitPayload = Parameters<
  React.ComponentProps<typeof AddShotSheet>['onSubmit']
>[0];

export function ScorerGroupPage() {
  const { teeGroupId } = useParams<{ teeGroupId: string }>();
  const navigate = useNavigate();
  const { assignment } = useScorerAssignment(teeGroupId);

  const active = useRoundStore((s) => s.active);
  const parked = useRoundStore((s) => s.parked);
  const switchRound = useRoundStore((s) => s.switchRound);
  const bagClubs = useBagStore((s) => s.clubs);

  const [mode, setMode] = useState<'detail' | 'quick'>('detail');
  const [holeNumber, setHoleNumber] = useState<number | null>(null);
  const [landing, setLanding] = useState<PendingLanding | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);

  /**
   * The group's cards in tab order. Ordered by the assignment's pairing
   * positions so the tabs match the printed tee sheet; anything the assignment
   * doesn't know about (a stale cache) still shows, just at the end.
   */
  const rounds = useMemo(() => {
    const all: ActiveRound[] = [
      ...(active ? [active] : []),
      ...Object.values(parked)
    ].filter((r) => r.teeGroupId === teeGroupId);

    const order = new Map(
      (assignment?.players ?? []).map((p, i) => [p.registration_id, p.position ?? i])
    );
    return all.sort((a, b) => {
      const ai = order.get(a.tmRegistrationId ?? '') ?? Number.MAX_SAFE_INTEGER;
      const bi = order.get(b.tmRegistrationId ?? '') ?? Number.MAX_SAFE_INTEGER;
      return ai - bi;
    });
  }, [active, parked, assignment, teeGroupId]);

  // Seed the shared hole from whichever card is on screen, once.
  useEffect(() => {
    if (holeNumber == null && active) {
      setHoleNumber(active.holes[active.currentHoleIndex]?.holeNumber ?? 1);
    }
  }, [active, holeNumber]);

  const currentHole: LocalHole | undefined = active?.holes.find(
    (h) => h.holeNumber === holeNumber
  );

  /** Record a shot against whichever player is on screen. */
  const addShot = useCallback(
    (payload: ShotSubmitPayload) => {
      const store = useRoundStore.getState();
      const round = store.active;
      if (!round || holeNumber == null) return;
      const hole = round.holes.find((h) => h.holeNumber === holeNumber);
      if (!hole) return;

      store.addShot(holeNumber, {
        id: newId(),
        shotNumber: hole.shots.length + 1,
        clubId: payload.clubId,
        shotResult: payload.derivedShotResult,
        targetType: payload.targetType,
        targetResult: payload.targetResult,
        lie: payload.lie,
        penaltyType: payload.penaltyType,
        distance: payload.distance,
        distanceUnit: payload.distanceUnit,
        notes: payload.notes,
        createdAt: new Date().toISOString(),
        syncedAt: null,
        // A scorer's entry is a deliberate observation, not a detection awaiting
        // review — nothing here comes from the impact detector.
        verified: true,
        startLat: payload.startLat,
        startLng: payload.startLng,
        endLat: payload.endLat,
        endLng: payload.endLng,
        calculatedDistance: payload.calculatedDistance
      });

      // Keep the derived hole stats in step with the shots on it.
      const after = useRoundStore
        .getState()
        .active?.holes.find((h) => h.holeNumber === holeNumber);
      if (after) {
        const putts = after.shots.filter((s) => {
          const club = bagClubs.find((c) => c.clubId === s.clubId);
          return club?.category === 'putter';
        }).length;
        store.updateHole(holeNumber, { strokes: after.shots.length, putts });
      }

      setLanding(null);
      setSheetOpen(false);
      schedulePush(useRoundStore.getState().active, holeNumber);
    },
    [holeNumber, bagClubs]
  );

  const removeShot = useCallback(
    (shotId: string, wasSynced: boolean) => {
      if (holeNumber == null) return;
      const store = useRoundStore.getState();
      store.recordShotDeletion(shotId, wasSynced);
      store.removeShot(holeNumber, shotId);
      const after = useRoundStore
        .getState()
        .active?.holes.find((h) => h.holeNumber === holeNumber);
      if (after) store.updateHole(holeNumber, { strokes: after.shots.length });
      schedulePush(useRoundStore.getState().active, holeNumber);
    },
    [holeNumber]
  );

  const onQuickChange = useCallback((change: QuickEntryChange) => {
    const store = useRoundStore.getState();
    const wasActive = store.active?.roundId;
    // updateHole writes to whatever is on screen, so briefly make this player
    // current, then hand the screen back. Cheaper and far less error-prone than
    // duplicating the hole-patch logic for parked rounds.
    if (wasActive !== change.roundId) store.switchRound(change.roundId);
    useRoundStore.getState().updateHole(change.holeNumber, change.patch);
    const updated = useRoundStore.getState().active;
    if (wasActive && wasActive !== change.roundId) {
      useRoundStore.getState().switchRound(wasActive);
    }
    schedulePush(updated, change.holeNumber);
  }, []);

  if (!active || rounds.length === 0) {
    return (
      <Box>
        <PageHeader title="Scoring" back="/scoring" />
        <Stack spacing={2} px={2}>
          <Alert severity="info">
            This group isn&apos;t open. Go back and start scoring it.
          </Alert>
          <Button variant="contained" onClick={() => navigate('/scoring')}>
            Back to my groups
          </Button>
        </Stack>
      </Box>
    );
  }

  const holeCount = active.holesPlayed || 18;

  return (
    <Box sx={{ pb: 10 }}>
      <PageHeader
        title={assignment?.tournament.name ?? 'Scoring'}
        subtitle={
          assignment
            ? `Round ${assignment.round_number} · ${rounds.length} players`
            : `${rounds.length} players`
        }
        back="/scoring"
        action={<SyncStatusChip compact />}
      />

      <Stack spacing={1.5} px={2}>
        {/* ---- Hole strip: shared by the whole group ---- */}
        <Paper
          elevation={0}
          sx={{
            p: 1,
            borderRadius: '5px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            bgcolor: 'background.paper'
          }}
        >
          <IconButton
            aria-label="Previous hole"
            disabled={(holeNumber ?? 1) <= 1}
            onClick={() => setHoleNumber((h) => Math.max(1, (h ?? 1) - 1))}
          >
            <ChevronLeftRoundedIcon />
          </IconButton>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Hole {holeNumber ?? 1}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Par {currentHole?.par ?? '—'}
              {currentHole?.yardage ? ` · ${currentHole.yardage}y` : ''}
            </Typography>
          </Box>
          <IconButton
            aria-label="Next hole"
            disabled={(holeNumber ?? 1) >= holeCount}
            onClick={() => setHoleNumber((h) => Math.min(holeCount, (h ?? 1) + 1))}
          >
            <ChevronRightRoundedIcon />
          </IconButton>
        </Paper>

        {/* ---- Player tabs ---- */}
        <Stack direction="row" spacing={0.75} sx={{ overflowX: 'auto', pb: 0.5 }}>
          {rounds.map((r) => {
            const hole = r.holes.find((h) => h.holeNumber === holeNumber);
            const thru = r.holes.filter((h) => holeTotalScore(h) > 0).length;
            const vsPar = r.holes.reduce(
              (sum, h) => (holeTotalScore(h) > 0 ? sum + holeTotalScore(h) - h.par : sum),
              0
            );
            const isCurrent = r.roundId === active.roundId;
            return (
              <Paper
                key={r.roundId}
                elevation={0}
                onClick={() => switchRound(r.roundId)}
                sx={{
                  px: 1.25,
                  py: 0.75,
                  minWidth: 96,
                  flexShrink: 0,
                  cursor: 'pointer',
                  borderRadius: '5px',
                  border: '2px solid',
                  borderColor: isCurrent ? 'primary.main' : 'transparent',
                  bgcolor: isCurrent ? 'action.selected' : 'background.paper'
                }}
              >
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                  {r.athleteName ?? 'Player'}
                </Typography>
                <Typography variant="caption" color="text.secondary" className="nums">
                  {thru > 0 ? `${vsPar > 0 ? '+' : ''}${vsPar === 0 ? 'E' : vsPar} · ${thru}` : '—'}
                  {hole && holeTotalScore(hole) > 0 ? ` · ${holeTotalScore(hole)}` : ''}
                </Typography>
              </Paper>
            );
          })}
        </Stack>

        <ToggleButtonGroup
          size="small"
          exclusive
          fullWidth
          value={mode}
          onChange={(_, v) => v && setMode(v)}
        >
          <ToggleButton value="detail">
            <MapRoundedIcon sx={{ fontSize: 16, mr: 0.5 }} /> Shot detail
          </ToggleButton>
          <ToggleButton value="quick">
            <SpeedRoundedIcon sx={{ fontSize: 16, mr: 0.5 }} /> Quick entry
          </ToggleButton>
        </ToggleButtonGroup>

        {mode === 'quick' ? (
          <ScorerQuickEntry
            rounds={rounds}
            holeNumber={holeNumber ?? 1}
            activeRoundId={active.roundId}
            onChange={onQuickChange}
            onSelectPlayer={(id) => switchRound(id)}
          />
        ) : (
          <>
            {/* Tap the map where the ball came to rest. The layout ray-casts the
                tap against the course polygons, so the shot sheet opens with the
                lie and result already inferred. */}
            <HoleLayoutCard
              courseId={active.courseId}
              holeNumber={holeNumber ?? 1}
              par={currentHole?.par ?? null}
              yardage={currentHole?.yardage ?? null}
              compact
              interactive
              landingPoint={landing?.end ?? null}
              shotEndPoints={
                currentHole?.shots
                  .filter((s) => s.endLng != null && s.endLat != null)
                  .map((s) => [s.endLng as number, s.endLat as number]) ?? []
              }
              shotLabels={
                currentHole?.shots
                  .filter((s) => s.endLng != null && s.endLat != null)
                  .map((s) => ({
                    club: clubLabelFor(s.clubId, bagClubs),
                    distance: s.distance != null ? `${Math.round(s.distance)}` : null
                  })) ?? []
              }
              onShotLanded={(data) => {
                setLanding(data);
                setSheetOpen(true);
              }}
            />

            <Paper elevation={0} sx={{ p: 1.5, borderRadius: '5px', bgcolor: 'background.paper' }}>
              <Stack
                direction="row"
                alignItems="center"
                justifyContent="space-between"
                sx={{ mb: 1 }}
              >
                <Typography variant="subtitle2">
                  {active.athleteName ?? 'Player'} — hole {holeNumber ?? 1}
                </Typography>
                <Chip
                  size="small"
                  variant="outlined"
                  label={`${currentHole ? holeTotalScore(currentHole) : 0}`}
                />
              </Stack>

              <Stack spacing={0.5}>
                {(currentHole?.shots ?? []).map((s) => (
                  <Stack
                    key={s.id}
                    direction="row"
                    alignItems="center"
                    spacing={1}
                    sx={{ py: 0.25 }}
                  >
                    <Typography
                      variant="caption"
                      className="nums"
                      sx={{ width: 18, fontWeight: 700, color: 'text.secondary' }}
                    >
                      {s.shotNumber}
                    </Typography>
                    <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }} noWrap>
                      {clubLabelFor(s.clubId, bagClubs) ?? '—'}
                      {s.distance != null
                        ? ` · ${Math.round(s.distance)}${s.distanceUnit === 'feet' ? 'ft' : 'y'}`
                        : ''}
                      {s.shotResult ? ` · ${s.shotResult.replace(/_/g, ' ')}` : ''}
                    </Typography>
                    <IconButton
                      size="small"
                      aria-label={`Delete shot ${s.shotNumber}`}
                      onClick={() => removeShot(s.id, !!s.syncedAt)}
                    >
                      <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
                    </IconButton>
                  </Stack>
                ))}
                {(currentHole?.shots.length ?? 0) === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    No shots recorded. Tap the map where the ball finished, or add
                    one manually.
                  </Typography>
                )}
              </Stack>

              <Button
                fullWidth
                size="small"
                sx={{ mt: 1 }}
                startIcon={<AddRoundedIcon />}
                onClick={() => {
                  setLanding(null);
                  setSheetOpen(true);
                }}
              >
                Add shot
              </Button>
            </Paper>
          </>
        )}

        <Button
          fullWidth
          variant="outlined"
          color="success"
          startIcon={<FlagRoundedIcon />}
          onClick={() => setFinishOpen(true)}
        >
          Finish group
        </Button>
      </Stack>

      <AddShotSheet
        open={sheetOpen}
        shotNumber={(currentHole?.shots.length ?? 0) + 1}
        holePar={currentHole?.par ?? 4}
        bagClubs={bagClubs}
        defaultGps={
          landing
            ? {
                startLat: landing.start[1],
                startLng: landing.start[0],
                endLat: landing.end[1],
                endLng: landing.end[0],
                calculatedDistanceM: landing.calculatedDistanceM,
                inferredLie: landing.inferredLie,
                inferredTargetResult: landing.inferredTargetResult
              }
            : null
        }
        onClose={() => {
          setSheetOpen(false);
          setLanding(null);
        }}
        onSubmit={addShot}
      />

      <FinishGroupDialog
        open={finishOpen}
        rounds={rounds}
        onCancel={() => setFinishOpen(false)}
        onDone={() => {
          setFinishOpen(false);
          navigate('/scoring');
        }}
      />
    </Box>
  );
}

function clubLabelFor(
  clubId: string | null,
  bagClubs: ReturnType<typeof useBagStore.getState>['clubs']
): string | null {
  if (!clubId) return null;
  const club = bagClubs.find((c) => c.clubId === clubId);
  if (!club) return null;
  return abbreviateClubName(club.customName?.trim() || club.name, club.category);
}

/**
 * Push one player's hole to TM, debounced so a flurry of stroke edits coalesces
 * into a single call. Keyed by round + hole, because two players' holes are
 * independent pushes and must not cancel each other.
 */
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
function schedulePush(round: ActiveRound | null | undefined, holeNumber: number, delayMs = 700) {
  if (!round?.tmRegistrationId) return;
  const key = `${round.roundId}:${holeNumber}`;
  const existing = pushTimers.get(key);
  if (existing) clearTimeout(existing);
  pushTimers.set(
    key,
    setTimeout(() => {
      pushTimers.delete(key);
      // Re-read: the round may have changed since the timer was set.
      const state = useRoundStore.getState();
      const fresh =
        state.active?.roundId === round.roundId ? state.active : state.parked[round.roundId];
      const hole = fresh?.holes.find((h) => h.holeNumber === holeNumber);
      if (fresh && hole) void pushScorerHole(fresh, hole);
    }, delayMs)
  );
}

function FinishGroupDialog({
  open,
  rounds,
  onCancel,
  onDone
}: {
  open: boolean;
  rounds: ActiveRound[];
  onCancel: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      for (const r of rounds) {
        const score = computeTotalScore(r.holes);
        const completion = {
          score,
          scoreVsPar: score - r.totalPar,
          completedAt: new Date().toISOString()
        };

        // Stamp completed_at and push everything that hasn't landed. Without
        // this the card stays in progress forever and reopening the group would
        // resume it instead of starting the next round.
        // eslint-disable-next-line no-await-in-loop
        const result = await syncRound(r, completion);
        if (!result.ok) {
          // The moment a scorekeeper believes four players' rounds are safe.
          // Park each snapshot before the store is cleared so the scheduler
          // keeps retrying until the server confirms it.
          enqueueFinishedRound(r, completion);
          console.warn('[scorer] finish deferred to sync outbox', r.athleteName, result.error);
        }

        // Best-effort TM submit — never blocks closing the group.
        // eslint-disable-next-line no-await-in-loop
        await finalizeScorerRound(r);
      }

      // Phase 5 adds the ownership transfer and the athlete's confirmation.
      // Until then the cards stay in the scorer's account carrying
      // pending_athlete_email — exactly the state claim_marker_rounds() resolves.
      const store = useRoundStore.getState();
      for (const r of rounds) store.closeRound(r.roundId);
      onDone();
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={busy ? undefined : onCancel} fullWidth maxWidth="xs">
      <DialogTitle>Finish this group?</DialogTitle>
      <DialogContent>
        <Typography variant="body2" color="text.secondary">
          Submits {rounds.length} scorecard{rounds.length === 1 ? '' : 's'} to the
          tournament and closes the group.
        </Typography>
        <Stack spacing={0.5} sx={{ mt: 1.5 }}>
          {rounds.map((r) => {
            const played = r.holes.filter((h) => holeTotalScore(h) > 0);
            const total = played.reduce((sum, h) => sum + holeTotalScore(h), 0);
            return (
              <Stack key={r.roundId} direction="row" justifyContent="space-between">
                <Typography variant="body2">{r.athleteName ?? 'Player'}</Typography>
                <Typography variant="body2" className="nums" color="text.secondary">
                  {played.length} holes · {total}
                </Typography>
              </Stack>
            );
          })}
        </Stack>
        {rounds.some((r) => r.holes.every((h) => holeTotalScore(h) === 0)) && (
          <Alert severity="warning" sx={{ mt: 1.5 }}>
            A player has no holes recorded.
          </Alert>
        )}
      </DialogContent>
      <DialogActions>
        <Button onClick={onCancel} disabled={busy}>
          Keep scoring
        </Button>
        <Button variant="contained" onClick={submit} disabled={busy}>
          {busy ? <CircularProgress size={18} /> : 'Submit'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
