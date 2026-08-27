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

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
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
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import MapRoundedIcon from '@mui/icons-material/MapRounded';
import SpeedRoundedIcon from '@mui/icons-material/SpeedRounded';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import GolfCourseRoundedIcon from '@mui/icons-material/GolfCourseRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { PageHeader } from '@/components/layout/PageHeader';
import { HoleLayoutCard } from '@/features/course/HoleLayoutCard';
import { recommendClub } from '@/features/course/HoleLayout';
import { metersToYards } from '@/features/course/distance';
import { AddShotSheet } from '@/features/round/AddShotSheet';
import { SyncStatusChip } from '@/features/offline/SyncStatusChip';
import { ScorerQuickEntry, type QuickEntryChange } from '@/features/tournaments/ScorerQuickEntry';
import { useScorerAssignment } from '@/features/tournaments/useScorerAssignments';
import { useScorerGroupRounds } from '@/features/tournaments/useScorerGroupRounds';
import { bagForPlayer, isCatalogBag } from '@/features/tournaments/athleteBag';
import { useTournamentCourse } from '@/features/tournaments/useTournamentCourse';
import { tmIntegrationRepo } from '@/services/tmIntegration/tmIntegrationRepo';
import { toAppError } from '@/services/errors';
import { finalizeScorerRound, pushScorerHole } from '@/features/tournaments/scorerPush';
import { enqueueFinishedRound, syncRound } from '@/services/roundSync';
import {
  computeCompletedTotals,
  computeTotalScore,
  holeTotalScore
} from '@/features/round/computeRoundTotals';
import { abbreviateClubName } from '@/features/bag/abbreviateClubName';
import {
  useRoundStore,
  type ActiveRound,
  type LocalHole,
  type LocalShot
} from '@/stores/roundStore';
import { newId } from '@/lib/ids';
import type { BagClub, Lie, TargetResult } from '@/models';

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

/**
 * Score relative to par, over completed holes only.
 *
 * Shows "E" before any hole is finished rather than the "--" the round summary
 * uses. On a scoring screen a player who hasn't holed out yet IS level — the
 * dash reads as missing data, and a scorekeeper glancing at four players wants
 * a stable baseline, not a placeholder.
 */
function fmtVsPar(vsPar: number, completedCount: number): string {
  if (completedCount === 0 || vsPar === 0) return 'E';
  return vsPar > 0 ? `+${vsPar}` : `${vsPar}`;
}

export function ScorerGroupPage() {
  const { teeGroupId } = useParams<{ teeGroupId: string }>();
  const navigate = useNavigate();
  const { assignment, refetch } = useScorerAssignment(teeGroupId);

  const hydrated = useRoundStore((s) => s.hydrated);
  const activeRound = useRoundStore((s) => s.active);
  const parked = useRoundStore((s) => s.parked);
  const switchRound = useRoundStore((s) => s.switchRound);

  /**
   * The round on screen, but only when it belongs to THIS group.
   *
   * These can diverge: `startRound` replaces the active round without touching
   * parked ones, so a scorer who starts their own round leaves the group's four
   * cards parked and someone else's round current. Rendering this screen
   * against that would show a personal round under the group's player tabs.
   */
  const active = activeRound?.teeGroupId === teeGroupId ? activeRound : null;
  /**
   * The bag of the player on screen — NEVER the scorekeeper's.
   *
   * The club recorded on somebody's round has to come from the clubs they
   * actually carry, with their own carry distances, or the suggestion is
   * guessing from the wrong yardages. Falling back to the scorer's own bag
   * would silently put their clubs on another player's card, so an empty bag
   * here means an empty picker until the backfill below fills it in.
   */
  const bagClubs = active?.athleteBag ?? [];

  const [mode, setMode] = useState<'detail' | 'quick'>('detail');
  const [holeNumber, setHoleNumber] = useState<number | null>(null);
  const [landing, setLanding] = useState<PendingLanding | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  /** Shot being edited, or null when the sheet is recording a new one. */
  const [editingShot, setEditingShot] = useState<LocalShot | null>(null);

  /**
   * The group's cards in tab order. Ordered by the assignment's pairing
   * positions so the tabs match the printed tee sheet; anything the assignment
   * doesn't know about (a stale cache) still shows, just at the end.
   */
  const rounds = useMemo(() => {
    const all: ActiveRound[] = [
      ...(activeRound ? [activeRound] : []),
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
  }, [activeRound, parked, assignment, teeGroupId]);

  // The group is live but a different round is on screen — put the group back.
  useEffect(() => {
    if (!hydrated || active || rounds.length === 0) return;
    switchRound(rounds[0].roundId);
  }, [hydrated, active, rounds, switchRound]);

  /**
   * Backfill athlete bags, and UPGRADE a catalog stand-in to the real thing.
   *
   * The bag is captured when a group is opened, so a group that was already
   * live has none. But the harder case is a player who wasn't linked to a GRT
   * account at open time: they get the catalog stand-in, then open the app
   * themselves, TM stamps their id, and the scorer should start seeing their
   * real clubs. Storing the catalog bag as if it were final would freeze the
   * wrong answer in place forever.
   *
   * So the guard is keyed by the player's GRT id, not the round: when that id
   * appears the key changes and the real bag is fetched. A catalog bag is only
   * ever provisional while an id exists to try.
   */
  const backfilled = useRef<Set<string>>(new Set());
  const runBackfill = useCallback(() => {
    if (!assignment) return;
    for (const r of rounds) {
      const player = assignment.players.find(
        (p) => p.registration_id === r.tmRegistrationId
      );
      if (!player) continue;

      const stored = r.athleteBag;
      const provisional = !stored?.length || (isCatalogBag(stored) && !!player.grt_athlete_id);
      if (!provisional) continue;

      const key = `${r.roundId}:${player.grt_athlete_id ?? 'unlinked'}`;
      if (backfilled.current.has(key)) continue;
      backfilled.current.add(key);

      void bagForPlayer(player).then((bag) => {
        // Don't overwrite a real bag with the catalog if they raced.
        const current = useRoundStore.getState();
        const live =
          current.active?.roundId === r.roundId ? current.active : current.parked[r.roundId];
        if (!bag.length) return;
        if (live?.athleteBag?.length && !isCatalogBag(live.athleteBag) && isCatalogBag(bag)) return;
        current.setAthleteBag(r.roundId, bag);
      });
    }
  }, [assignment, rounds]);

  useEffect(() => {
    runBackfill();
  }, [runBackfill]);

  /**
   * Pull the assignment again and re-try every bag.
   *
   * Needed because `refetchOnWindowFocus` is off app-wide: when a player links
   * their account mid-round, nothing tells the scorer's device. This is the
   * "their clubs still look wrong" button.
   */
  const refreshPlayers = useCallback(async () => {
    backfilled.current.clear();
    await refetch();
    runBackfill();
  }, [refetch, runBackfill]);

  // Seed the shared hole from whichever card is on screen, once.
  useEffect(() => {
    if (holeNumber == null && active) {
      setHoleNumber(active.holes[active.currentHoleIndex]?.holeNumber ?? 1);
    }
  }, [active, holeNumber]);

  const currentHole: LocalHole | undefined = active?.holes.find(
    (h) => h.holeNumber === holeNumber
  );

  /**
   * Club suggested for the shot the scorer just marked, from the distance the
   * map measured and the ATHLETE's own carry distances.
   *
   * `excludeDriver` past the tee mirrors the recommender's real-golf rule: from
   * 250 out in the fairway you hit a 3-wood or hybrid, not a driver. Shot 1 on
   * a par 4 or 5 is the exception.
   */
  const suggestedClubId = useMemo(() => {
    if (!landing) return null;
    const yards = metersToYards(landing.calculatedDistanceM);
    if (!Number.isFinite(yards) || yards <= 0) return null;
    const shotNumber = (currentHole?.shots.length ?? 0) + 1;
    const isTeeShot = shotNumber === 1 && (currentHole?.par ?? 4) !== 3;
    return (
      recommendClub(bagClubs, yards, { excludeDriver: !isTeeShot })?.clubId ?? null
    );
  }, [landing, bagClubs, currentHole]);

  /** Recompute the hole's derived stroke/putt counts from its shot list. */
  const syncHoleStats = useCallback(
    (hole: number) => {
      const store = useRoundStore.getState();
      const after = store.active?.holes.find((h) => h.holeNumber === hole);
      if (!after) return;
      const putts = after.shots.filter((s) => {
        const club = bagClubs.find((c) => c.clubId === s.clubId);
        return club?.category === 'putter';
      }).length;
      store.updateHole(hole, { strokes: after.shots.length, putts });
    },
    [bagClubs]
  );

  /**
   * Save a shot for whichever player is on screen — new, or an edit of an
   * existing one when `editingShot` is set.
   */
  const submitShot = useCallback(
    (payload: ShotSubmitPayload) => {
      const store = useRoundStore.getState();
      const round = store.active;
      if (!round || holeNumber == null) return;
      const hole = round.holes.find((h) => h.holeNumber === holeNumber);
      if (!hole) return;

      const fields = {
        clubId: payload.clubId,
        shotResult: payload.derivedShotResult,
        targetType: payload.targetType,
        targetResult: payload.targetResult,
        lie: payload.lie,
        penaltyType: payload.penaltyType,
        distance: payload.distance,
        distanceUnit: payload.distanceUnit,
        notes: payload.notes,
        startLat: payload.startLat,
        startLng: payload.startLng,
        endLat: payload.endLat,
        endLng: payload.endLng,
        calculatedDistance: payload.calculatedDistance
      };

      if (editingShot) {
        store.updateShot(holeNumber, editingShot.id, {
          ...fields,
          // Re-queue it for push. Shots upsert on their client-minted id, so
          // clearing this makes the reconciler re-send the edited row on the
          // next pass. Deliberately different from HoleTrackingPage, which
          // writes the edit remotely there and then — that call is simply lost
          // when a scorekeeper is standing in a dead zone.
          syncedAt: null
        });
      } else {
        store.addShot(holeNumber, {
          id: newId(),
          shotNumber: hole.shots.length + 1,
          createdAt: new Date().toISOString(),
          syncedAt: null,
          // A scorer's entry is a deliberate observation, not a detection
          // awaiting review — nothing here comes from the impact detector.
          verified: true,
          ...fields
        });
      }

      syncHoleStats(holeNumber);
      setLanding(null);
      setEditingShot(null);
      setSheetOpen(false);
      schedulePush(useRoundStore.getState().active, holeNumber);
    },
    [holeNumber, editingShot, syncHoleStats]
  );

  const removeShot = useCallback(
    (shotId: string, wasSynced: boolean) => {
      if (holeNumber == null) return;
      const store = useRoundStore.getState();
      store.recordShotDeletion(shotId, wasSynced);
      store.removeShot(holeNumber, shotId);
      syncHoleStats(holeNumber);
      schedulePush(useRoundStore.getState().active, holeNumber);
    },
    [holeNumber, syncHoleStats]
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

  // The round comes back from IndexedDB asynchronously, so before that read
  // settles `active` is null for reasons that have nothing to do with this
  // group. Showing the empty state here would tell a scorekeeper mid-round that
  // their group is gone.
  if (!hydrated) {
    return (
      <Box>
        <PageHeader title="Scoring" back="/scoring" />
        <Stack alignItems="center" py={6}>
          <CircularProgress />
        </Stack>
      </Box>
    );
  }

  if (rounds.length === 0) {
    return <ReopenGroup teeGroupId={teeGroupId} blockedBy={activeRound} />;
  }

  // Cards are live; the effect above is bringing one to the front.
  if (!active) {
    return (
      <Box>
        <PageHeader title="Scoring" back="/scoring" />
        <Stack alignItems="center" py={6}>
          <CircularProgress />
        </Stack>
      </Box>
    );
  }

  const holeCount = active.holesPlayed || 18;
  const backupPlayers = rounds
    .filter((r) => r.tmCardRole === 'MARKER_BACKUP')
    .map((r) => r.athleteName ?? 'A player');

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
        {/* The athlete started tracking their own round, so theirs is the
            record now. Said plainly, because a scorekeeper who keeps writing
            without knowing this would think they were feeding the leaderboard. */}
        {backupPlayers.length > 0 && (
          <Alert severity="info" icon={<InfoOutlinedIcon />}>
            {backupPlayers.length === 1
              ? `${backupPlayers[0]} is tracking their own round, so their card is now the official one.`
              : `${backupPlayers.join(', ')} are tracking their own rounds, so their cards are now the official ones.`}{' '}
            Keep scoring — your version is still saved as the marker&apos;s copy.
          </Alert>
        )}

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
            // Running score counts COMPLETED holes only, so it sits at E and
            // holds steady while a hole is being recorded — a player mid-hole
            // isn't +3 just because three shots are logged. Completion is
            // relative to the hole the GROUP is on (they walk it together),
            // which is component state here rather than each card's own
            // currentHoleIndex.
            const groupIdx = r.holes.findIndex((h) => h.holeNumber === holeNumber);
            const { score, par, completedCount } = computeCompletedTotals({
              holes: r.holes,
              currentHoleIndex: groupIdx < 0 ? 0 : groupIdx
            });
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
                  {r.tmCardRole === 'MARKER_BACKUP' && (
                    <Typography component="span" variant="caption" color="text.secondary">
                      {' '}
                      · backup
                    </Typography>
                  )}
                </Typography>
                <Typography variant="caption" color="text.secondary" className="nums">
                  {fmtVsPar(score - par, completedCount)}
                  {completedCount > 0 ? ` · thru ${completedCount}` : ''}
                  {/* This hole's strokes, kept separate from the running score
                      so the total doesn't twitch on every shot. */}
                  {hole && holeTotalScore(hole) > 0 ? ` · (${holeTotalScore(hole)})` : ''}
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
                lie and result already inferred.

                The wrapper's DEFINITE height is load-bearing, not styling:
                HoleLayoutCard is height:100%, and Mapbox needs a sized
                container. Inside an auto-height flex column that percentage
                resolves to auto and the map renders at zero height. Unlike
                HoleTrackingPage this isn't full-screen — the shot list has to
                share the screen — so it's a fixed band that still leaves room to
                tap a landing spot accurately. */}
            <Box
              sx={{
                position: 'relative',
                // Only reserve the band when there's a course to draw. The card
                // renders nothing at all without one, which would otherwise
                // leave a tall empty gap above the shot list.
                display: active.courseId ? 'block' : 'none',
                height: 'clamp(280px, 42vh, 460px)',
                borderRadius: '5px',
                overflow: 'hidden'
              }}
            >
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
            </Box>

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
                    // Tap anywhere on the row to correct it — a scorekeeper
                    // watching four players gets shots wrong, and re-entering
                    // one from scratch is the wrong penalty for a mis-tap.
                    onClick={() => {
                      setEditingShot(s);
                      setLanding(null);
                      setSheetOpen(true);
                    }}
                    sx={{
                      py: 0.5,
                      px: 0.5,
                      mx: -0.5,
                      cursor: 'pointer',
                      borderRadius: '4px',
                      '&:active': { bgcolor: 'action.selected' }
                    }}
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
                    <EditRoundedIcon sx={{ fontSize: 14, color: 'text.disabled' }} />
                    <IconButton
                      size="small"
                      aria-label={`Delete shot ${s.shotNumber}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        removeShot(s.id, !!s.syncedAt);
                      }}
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

            <AthleteBagReference
              athleteName={active.athleteName ?? 'Player'}
              bagClubs={bagClubs}
              isCatalog={isCatalogBag(bagClubs)}
              hasAccount={
                !!assignment?.players.find(
                  (p) => p.registration_id === active.tmRegistrationId
                )?.grt_athlete_id
              }
              onRefresh={refreshPlayers}
            />
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
        shotNumber={editingShot ? editingShot.shotNumber : (currentHole?.shots.length ?? 0) + 1}
        editing={
          editingShot
            ? {
                clubId: editingShot.clubId,
                distance: editingShot.distance,
                distanceUnit: editingShot.distanceUnit,
                targetType: editingShot.targetType,
                targetResult: editingShot.targetResult,
                lie: editingShot.lie,
                penaltyType: editingShot.penaltyType,
                notes: editingShot.notes,
                // Carried through so correcting a club doesn't discard where the
                // scorer marked the ball.
                startLat: editingShot.startLat,
                startLng: editingShot.startLng,
                endLat: editingShot.endLat,
                endLng: editingShot.endLng,
                calculatedDistance: editingShot.calculatedDistance
              }
            : null
        }
        holePar={currentHole?.par ?? 4}
        bagClubs={bagClubs}
        // The bag isn't the scorer's, so the yardages are what tell them which
        // club this player would have hit.
        showClubDistances
        // Pre-select the club whose typical carry is closest to the distance
        // just measured off the map. Null when the player has no recorded
        // yardages (an unlinked player on the catalog fallback), in which case
        // the picker simply opens unselected rather than guessing.
        defaultClubId={suggestedClubId}
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
          setEditingShot(null);
        }}
        onSubmit={submitShot}
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

/**
 * Shown when this tee group has no live rounds — after finishing it, after the
 * local store was cleared, or when the link was opened directly.
 *
 * Opens the group from here rather than sending the scorekeeper back to the
 * list to do the same thing. `useScorerGroupRounds` resumes any cards already
 * recorded for these players rather than starting blank ones, so re-opening a
 * group mid-round is safe and is the recovery path when a device is wiped.
 */
function ReopenGroup({
  teeGroupId,
  blockedBy
}: {
  teeGroupId: string | undefined;
  blockedBy: ActiveRound | null;
}) {
  const navigate = useNavigate();
  const { assignment, isLoading } = useScorerAssignment(teeGroupId);
  const { course, ensureCourse, isImporting } = useTournamentCourse(
    assignment?.tournament.external_course_id
  );
  const openGroup = useScorerGroupRounds();
  const [error, setError] = useState<string | null>(null);

  const open = async () => {
    setError(null);
    if (!assignment) return;
    try {
      const resolved = course ?? (await ensureCourse());
      if (!resolved) {
        setError('Could not resolve this tournament’s course.');
        return;
      }
      await openGroup.mutateAsync({ assignment, course: resolved });
    } catch (err) {
      setError(toAppError(err).message);
    }
  };

  return (
    <Box>
      <PageHeader title="Scoring" back="/scoring" />
      <Stack spacing={2} px={2}>
        {isLoading && (
          <Stack alignItems="center" py={4}>
            <CircularProgress />
          </Stack>
        )}

        {!isLoading && !assignment && (
          <>
            <Alert severity="warning">
              You aren&apos;t assigned to this tee group, or it no longer exists.
            </Alert>
            <Button variant="contained" onClick={() => navigate('/scoring')}>
              Back to my groups
            </Button>
          </>
        )}

        {assignment && (
          <>
            {/* Opening a group while a personal round is live would leave the
                scorer tracking their own round and four others at once. */}
            {blockedBy ? (
              <Alert severity="warning">
                You have a round in progress at {blockedBy.courseName}. Finish it
                before scoring this group.
              </Alert>
            ) : (
              <Alert severity="info">
                This group isn&apos;t open on this device. Opening it picks up any
                scores already recorded for these players.
              </Alert>
            )}

            <Paper elevation={0} sx={{ p: 2, borderRadius: '5px', bgcolor: 'background.paper' }}>
              <Typography variant="subtitle1">{assignment.tournament.name}</Typography>
              <Typography variant="body2" color="text.secondary">
                Round {assignment.round_number} ·{' '}
                {assignment.players.map((p) => p.first_name).join(', ')}
              </Typography>
            </Paper>

            {error && <Alert severity="error">{error}</Alert>}

            <Button
              variant="contained"
              disabled={!!blockedBy || openGroup.isPending || isImporting}
              onClick={open}
            >
              {openGroup.isPending || isImporting ? 'Opening…' : 'Open this group'}
            </Button>
            <Button variant="text" onClick={() => navigate('/scoring')}>
              Back to my groups
            </Button>
          </>
        )}
      </Stack>
    </Box>
  );
}

/**
 * What this player carries, and how far they hit it.
 *
 * A scorekeeper walking with someone else's bag has no idea what that player
 * hits 150 — so this is the reference that makes "which club was that?" a
 * question they can actually answer. Collapsed by default; the map and the shot
 * list are what they're using shot to shot.
 */
function AthleteBagReference({
  athleteName,
  bagClubs,
  isCatalog,
  hasAccount,
  onRefresh
}: {
  athleteName: string;
  bagClubs: BagClub[];
  /** Showing the standard catalog rather than a real bag. */
  isCatalog: boolean;
  /** Whether TM knows a GRT account for this player. */
  hasAccount: boolean;
  /** Re-pull the assignment and re-try every bag. */
  onRefresh: () => void;
}) {
  const [open, setOpen] = useState(false);
  const withYardage = bagClubs.filter((c) => c.typicalDistanceYards != null).length;
  const empty = bagClubs.length === 0;

  return (
    <Paper elevation={0} sx={{ borderRadius: '5px', bgcolor: 'background.paper' }}>
      <Button
        fullWidth
        size="small"
        onClick={() => setOpen((o) => !o)}
        startIcon={<GolfCourseRoundedIcon sx={{ fontSize: 16 }} />}
        sx={{ justifyContent: 'flex-start', px: 1.5, py: 1, color: 'text.secondary' }}
      >
        {empty
          ? 'Clubs not loaded'
          : isCatalog
            ? 'Standard clubs'
            : `${athleteName}'s bag`}
        {!empty && (withYardage > 0 ? ` · ${withYardage} with distances` : ' · no distances')}
      </Button>
      <Collapse in={open || empty}>
        <Box sx={{ px: 1.5, pb: 1.5 }}>
          {(isCatalog || empty) && (
            <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
              {empty
                ? `Couldn't load clubs for ${athleteName} — you may have been offline. Refresh to try again.`
                : hasAccount
                  ? // An empty read and an empty bag are indistinguishable from
                    // here (RLS filters rows rather than erroring), so name both
                    // rather than assert the wrong one.
                    `${athleteName} has a GRT account but no clubs came back — either they haven't set a bag up, or migration 035 isn't applied.`
                  : `${athleteName} hasn't opened GRT yet, so these are the standard clubs with no distances. Once they sign in, refresh to pick up their real bag.`}
            </Typography>
          )}

          <Button size="small" startIcon={<RefreshRoundedIcon sx={{ fontSize: 14 }} />} onClick={onRefresh}>
            Refresh players &amp; clubs
          </Button>

          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {[...bagClubs]
              .sort((a, b) => a.orderPosition - b.orderPosition)
              .map((c) => (
                <Chip
                  key={c.bagId}
                  size="small"
                  variant="outlined"
                  label={
                    c.typicalDistanceYards != null
                      ? `${c.customName || c.name} · ${c.typicalDistanceYards}y`
                      : c.customName || c.name
                  }
                />
              ))}
          </Box>
        </Box>
      </Collapse>
    </Paper>
  );
}

function clubLabelFor(
  clubId: string | null,
  bagClubs: BagClub[]
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

      // Hand each card to the athlete it belongs to. Server-side, because the
      // athlete id has to come from TM's registration rather than the client.
      // Players without a GRT account come back as `pending` and keep their
      // claim key — claim_marker_rounds() attaches those when they sign up.
      //
      // Best-effort: the cards are already submitted to TM and safe in the
      // scorer's account, so a failure here delays the handover rather than
      // losing anything.
      try {
        const result = await tmIntegrationRepo.transferMarkerRounds(
          rounds.map((r) => r.roundId)
        );
        if (result.errors?.length) {
          console.warn('[scorer] some cards did not transfer', result.errors);
        }
      } catch (err) {
        console.error('[scorer] transfer failed', err);
      }

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
