import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Collapse,
  LinearProgress,
  Stack,
  Tab,
  Tabs,
  Typography,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  TextField
} from '@mui/material';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import BarChartRoundedIcon from '@mui/icons-material/BarChartRounded';
import SportsGolfRoundedIcon from '@mui/icons-material/SportsGolfRounded';
import GpsFixedRoundedIcon from '@mui/icons-material/GpsFixedRounded';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import KeyboardArrowUpRoundedIcon from '@mui/icons-material/KeyboardArrowUpRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import EmojiEventsRoundedIcon from '@mui/icons-material/EmojiEventsRounded';
import MapRoundedIcon from '@mui/icons-material/MapRounded';
import { HoleLayoutCard } from '@/features/course/HoleLayoutCard';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { PageHeader } from '@/components/layout/PageHeader';
import { MarkerCardBanner } from '@/features/tournaments/MarkerCardBanner';
import { StatCard } from '@/components/ui/StatCard';
import { useRoundDetails } from '@/features/stats/useRounds';
import { detailRoundStats } from '@/features/stats/computeStats';
import { calculateDifferential, isAbsurdDifferential } from '@/utils/handicap';
import { roundRepo } from '@/services/roundRepo';
import { newId } from '@/lib/ids';
import { useRoundStore } from '@/stores/roundStore';
import { useBagStore } from '@/stores/bagStore';
import { abbreviateClubName } from '@/features/bag/abbreviateClubName';
import { useAuthStore } from '@/stores/authStore';
import { toAppError } from '@/services/errors';
import { pct, scoreVsPar, durationLabel, fullName } from '@/utils/format';
import { Scorecard } from '@/components/Scorecard';
import { AddShotSheet, type ShotEditDraft } from '@/features/round/AddShotSheet';
import { RoundSwingDetail, hasSwingDetail } from '@/features/round/RoundSwingDetail';
import {
  STROKE_PENALTY_TYPES,
  type Round,
  type RoundHole,
  type BagClub,
  type DistanceUnit,
  type Lie,
  type PenaltyType,
  type ShotResult,
  type TargetResult,
  type TargetType
} from '@/models';

/** Shape of a shot row as it flows through HolesTab. Mirrors the
 *  Supabase ShotRow but typed as plain interface so the parent doesn't
 *  need to import the DB types. */
interface HolesTabShot {
  id: string;
  hole_id: string;
  shot_number: number;
  club_id: string | null;
  target_type: string | null;
  target_result: string | null;
  lie: string | null;
  penalty_type: string | null;
  distance: number | null;
  distance_unit: string | null;
  notes: string | null;
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  calculated_distance: number | null;
  verified: boolean;
  // Motion swing data captured by the watch on auto-detected shots (migration 031).
  swing_type: string | null;
  swing_metrics: import('@/models').RoundSwingMetrics | null;
}

export function RoundSummaryPage() {
  const { roundId } = useParams<{ roundId: string }>();
  const navigate = useNavigate();
  const detail = useRoundDetails(roundId);
  const reset = useRoundStore((s) => s.reset);
  // When this summary is a "peek" at the round currently in progress (opened via
  // the flag button mid-round), the active round is still set and matches. In
  // that case Back should drop the user back into their round on the same hole
  // (navigate(-1) → the hole page, which restores currentHoleIndex from the
  // store). For a completed round — finished, or opened from the list — the
  // active round has been cleared, so Back goes to the round list instead.
  const activeRound = useRoundStore((s) => s.active);
  const isPeekingActiveRound = !!activeRound && activeRound.roundId === roundId;
  const bag = useBagStore((s) => s.clubs);
  const profile = useAuthStore((s) => s.profile);
  const userId = useAuthStore((s) => s.session?.user.id);
  const pageQueryClient = useQueryClient();
  const [editOpen, setEditOpen] = useState(false);
  const [verifyingAll, setVerifyingAll] = useState(false);
  const [tab, setTab] = useState<'overview' | 'holes' | 'game'>('overview');
  /** Anchor for re-homing the shared scroll container when the tab changes. */
  const tabBarRef = useRef<HTMLDivElement | null>(null);
  // When set (via a "needs review" hole chip), the Holes tab jumps to this hole
  // so the golfer lands right on the shots that need confirming. Reset to null
  // once consumed so tapping the same hole again re-triggers the jump.
  const [focusHoleNumber, setFocusHoleNumber] = useState<number | null>(null);

  useEffect(() => {
    if (!detail.data?.round) return;
    const { round, holes, shots } = detail.data;
    if (round.completed_at) {
      // Recompute score + par from the shots list (source of truth) — the same
      // basis the summary headline shows. Strokes = shot count + stroke
      // penalties; par is summed over PLAYED holes only. The cached
      // round_holes.strokes column and rounds.score/par can both lag (a shot
      // landing near finalize, or a course total_par that differs from the sum
      // of per-hole pars), so we treat the shots as authoritative.
      let totalScore = 0;
      let totalPar = 0;
      for (const h of holes) {
        const holeShots = shots.filter((sh) => sh.hole_id === h.id);
        // Same shots-first / cached-column fallback as the scorecard below, so a
        // hole whose shots didn't map still contributes its recorded strokes to
        // the headline total instead of counting as unplayed.
        let holeScore: number;
        if (holeShots.length > 0) {
          const livePenalty = holeShots.filter(
            (sh) =>
              sh.penalty_type != null &&
              (STROKE_PENALTY_TYPES as readonly string[]).includes(sh.penalty_type)
          ).length;
          holeScore = holeShots.length + livePenalty;
        } else {
          holeScore = (h.strokes ?? 0) + (h.penalty_strokes ?? 0);
        }
        totalScore += holeScore;
        if (holeScore > 0) totalPar += h.par;
      }
      const scoreVsPar = totalScore - totalPar;

      // Self-heal the denormalized score columns so every read site (tournament
      // card, Home/last-round, past rounds) matches what the summary displays.
      if (
        round.score !== totalScore ||
        round.par !== totalPar ||
        round.score_vs_par !== scoreVsPar
      ) {
        roundRepo
          .update(round.id, { score: totalScore, par: totalPar, score_vs_par: scoreVsPar })
          .then(() =>
            pageQueryClient.invalidateQueries({ queryKey: ['rounds', userId] })
          )
          .catch((err) => console.error('[summary] could not persist round score', err));
      }

      // Self-heal the handicap differential off the same authoritative score:
      //   1) Nothing stored → persist a fresh computed value.
      //   2) Stored value is out of the USGA-reasonable range (e.g. -226 from an
      //      earlier bug) → overwrite, or clear to null when even the fresh
      //      compute can't produce a sane number.
      const computed = calculateDifferential(totalScore, round.course_rating, round.slope_rating);
      const stored = round.handicap_differential;
      const storedIsAbsurd = isAbsurdDifferential(stored);
      if (computed != null && (stored == null || storedIsAbsurd)) {
        roundRepo
          .update(round.id, { handicap_differential: computed })
          .catch((err) =>
            console.error('[summary] could not persist differential', err)
          );
      } else if (storedIsAbsurd && computed == null) {
        roundRepo
          .update(round.id, { handicap_differential: null })
          .catch((err) =>
            console.error('[summary] could not clear bad differential', err)
          );
      }
      reset();
    }
  }, [detail.data, reset, pageQueryClient, userId]);

  if (!roundId) return <Navigate to="/round" replace />;

  if (detail.isLoading || !detail.data) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '60dvh' }}>
        <CircularProgress />
      </Box>
    );
  }

  const { round, holes: rawHoles, shots } = detail.data;

  // Round-summary verification backstop: auto-detected shots the golfer never
  // confirmed per-hole surface here. "Verify all" clears the whole round; to
  // edit/delete an individual shot they use the per-hole map / scorecard.
  const unverifiedShots = shots.filter((s) => s.verified === false);
  // Which holes have shots still needing review, and how many each — so the
  // backstop card can show the golfer exactly where to look and jump them there.
  const holeNumberById = new Map(rawHoles.map((h) => [h.id, h.hole_number]));
  const unverifiedByHole = (() => {
    const counts = new Map<number, number>();
    for (const s of unverifiedShots) {
      const n = holeNumberById.get(s.hole_id);
      if (n == null) continue;
      counts.set(n, (counts.get(n) ?? 0) + 1);
    }
    return [...counts.entries()]
      .map(([holeNumber, count]) => ({ holeNumber, count }))
      .sort((a, b) => a.holeNumber - b.holeNumber);
  })();
  const jumpToHole = (holeNumber: number) => {
    setTab('holes');
    setFocusHoleNumber(holeNumber);
  };
  const verifyAllRound = async () => {
    if (verifyingAll || unverifiedShots.length === 0) return;
    setVerifyingAll(true);
    try {
      await Promise.all(
        unverifiedShots.map((s) => roundRepo.updateShot(s.id, { verified: true }))
      );
      pageQueryClient.invalidateQueries({ queryKey: ['round-detail', roundId] });
    } catch (err) {
      console.error('[verify] round verify-all failed', err);
    } finally {
      setVerifyingAll(false);
    }
  };

  // Live-derive per-hole strokes / putts / penalty_strokes from the shot
  // list rather than trusting the round_holes.strokes column. The column
  // is a debounced cache written by the live tracking page; if a shot
  // landed close to round-finalization (or via the watch outside the
  // debounce window), the cache can be off by one or more. Shots are the
  // source of truth — every shot row is durable.
  const holes = rawHoles.map((h) => {
    const holeShots = shots.filter((s) => s.hole_id === h.id);
    // Shots are the source of truth WHEN they mapped to this hole. But a hole can
    // end up with zero attached shots even though it was played — e.g. watch
    // shots that landed with a mismatched/stale hole_id — which used to blank the
    // whole scorecard ("—" on every hole). Fall back to the cached round_holes
    // columns (written during live play) so the score still shows.
    const hasShots = holeShots.length > 0;
    const liveStrokes = hasShots ? holeShots.length : h.strokes ?? 0;
    const livePutts = hasShots
      ? holeShots.filter((s) => {
          if (!s.club_id) return false;
          const c = bag.find((b) => b.clubId === s.club_id);
          return c?.category === 'putter';
        }).length
      : h.putts ?? 0;
    const livePenalty = hasShots
      ? holeShots.filter(
          (s) =>
            s.penalty_type != null &&
            (STROKE_PENALTY_TYPES as readonly string[]).includes(s.penalty_type)
        ).length
      : h.penalty_strokes ?? 0;
    return {
      ...h,
      strokes: liveStrokes,
      putts: livePutts,
      penalty_strokes: livePenalty
    };
  });
  const stats = detailRoundStats(round, holes, shots);
  const front = holes.filter((h) => h.hole_number <= 9);
  const back = holes.filter((h) => h.hole_number > 9);
  const frontTotal = front.reduce((s, h) => s + h.strokes + h.penalty_strokes, 0);
  const frontPar = front.reduce((s, h) => s + h.par, 0);
  const backTotal = back.reduce((s, h) => s + h.strokes + h.penalty_strokes, 0);
  const backPar = back.reduce((s, h) => s + h.par, 0);

  return (
    <Box>
      <PageHeader
        title="Round Summary"
        subtitle={`${round.course_name} · ${dayjs(round.started_at).format('MMM D, YYYY')}`}
        back={isPeekingActiveRound ? true : '/round'}
      />

      {/* Somebody else kept this card — the athlete's sign-off step. */}
      <MarkerCardBanner round={round} />

      {/* Verification backstop — auto-detected shots not yet confirmed. */}
      {unverifiedShots.length > 0 && (
        <Box sx={{ px: 2, mt: 1 }}>
          <Card
            elevation={0}
            sx={{
              bgcolor: 'rgba(251,191,36,0.12)',
              border: 1,
              borderColor: 'rgba(251,191,36,0.5)',
              borderRadius: '5px'
            }}
          >
            <CardContent
              sx={{
                py: 1.5,
                '&:last-child': { pb: 1.5 }
              }}
            >
              <Stack direction="row" alignItems="center" gap={1.5}>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography sx={{ fontWeight: 800, fontSize: '0.9rem' }}>
                    {unverifiedShots.length}{' '}
                    {unverifiedShots.length === 1 ? 'shot needs' : 'shots need'} review
                  </Typography>
                  <Typography variant="caption" color="text.secondary">
                    Auto-detected from your watch. Tap a hole below to review and
                    edit, or confirm them all.
                  </Typography>
                </Box>
                <Button
                  variant="contained"
                  size="small"
                  disabled={verifyingAll}
                  onClick={() => void verifyAllRound()}
                  sx={{
                    textTransform: 'none',
                    fontWeight: 700,
                    borderRadius: '6px',
                    whiteSpace: 'nowrap'
                  }}
                >
                  {verifyingAll ? 'Verifying…' : 'Verify all'}
                </Button>
              </Stack>
              {/* The specific holes needing review — tap to jump straight to that
                  hole's shots in the Holes tab. */}
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1.25 }}>
                {unverifiedByHole.map(({ holeNumber, count }) => (
                  <Chip
                    key={holeNumber}
                    label={`Hole ${holeNumber} · ${count}`}
                    size="small"
                    clickable
                    onClick={() => jumpToHole(holeNumber)}
                    sx={{
                      fontWeight: 700,
                      bgcolor: 'rgba(251,191,36,0.18)',
                      border: 1,
                      borderColor: 'rgba(251,191,36,0.55)',
                      '&:hover': { bgcolor: 'rgba(251,191,36,0.3)' }
                    }}
                  />
                ))}
              </Box>
            </CardContent>
          </Card>
        </Box>
      )}

      {/* Tab nav — Overview (existing content) / Holes (per-hole detail) /
          Game Stats (placeholder). Sits between the header and the page
          body so the rest of the page can swap in place. */}
      <Box ref={tabBarRef} sx={{ px: 2, mt: 1, scrollMarginTop: 12 }}>
        <Tabs
          value={tab}
          onChange={(_, v) => {
            setTab(v);
            // The two tabs are very different heights and the scroll container
            // is shared (MobileShell's Box), so switching while scrolled down
            // dropped you into the middle — or, on the shorter tab, at a
            // clamped offset that read as "the page is stuck". Anchor the new
            // tab at its top.
            requestAnimationFrame(() =>
              tabBarRef.current?.scrollIntoView({ block: 'start' })
            );
          }}
          variant="fullWidth"
          sx={{
            minHeight: 40,
            bgcolor: 'background.paper',
            borderRadius: '5px',
            border: 1,
            borderColor: 'divider',
            '& .MuiTabs-indicator': { display: 'none' },
            '& .MuiTab-root': {
              minHeight: 40,
              textTransform: 'none',
              fontWeight: 700,
              borderRadius: '5px',
              color: 'text.secondary'
            },
            '& .Mui-selected': {
              bgcolor: 'rgba(22,163,74,0.18)',
              color: 'common.white'
            }
          }}
        >
          <Tab label="Overview" value="overview" />
          <Tab label="Holes" value="holes" />
        </Tabs>
      </Box>

      {tab === 'overview' && (
      <Stack spacing={2} px={2} pb={4} mt={2}>
        <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
          <CardContent>
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Final Score
              </Typography>
              <Button
                size="small"
                startIcon={<EditRoundedIcon />}
                onClick={() => setEditOpen(true)}
                sx={{ textTransform: 'none' }}
              >
                Edit
              </Button>
            </Stack>
            <Stack direction="row" alignItems="baseline" spacing={2} mt={0.5}>
              {/* Headline = score-to-par (E / +N / -N). The raw stroke
                  total is still surfaced as a secondary chip below so the
                  number isn't lost. */}
              <Typography variant="h2" color="primary" sx={{ fontWeight: 800 }}>
                {scoreVsPar(stats.totalScore, stats.totalPar)}
              </Typography>
              <Typography variant="h5" sx={{ fontWeight: 700 }}>
                {stats.totalScore}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                par {stats.totalPar}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} mt={1}>
              <Chip label={`${round.holes_played} holes`} size="small" />
              <Chip label={durationLabel(round.started_at, round.completed_at)} size="small" />
              <Chip label={`${stats.clubsUsed.size} clubs used`} size="small" />
            </Stack>
          </CardContent>
        </Card>

        <Scorecard
          playerName={fullName(profile?.first_name, profile?.last_name)}
          handicap={round.handicap_differential != null ? Math.round(round.handicap_differential) : null}
          holes={holes}
        />

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 1.5
          }}
        >
          <StatCard label="Putts" value={stats.putts} />
          <StatCard label="GIR" value={`${stats.greensInRegulation}/${round.holes_played}`} />
          <StatCard label="Fairways Hit" value={`${stats.fairwaysHitPct}%`} accent="success" />
          <StatCard label="Sand Shots" value={stats.sandShots} />
          <StatCard label="Miss Left" value={`${stats.missLeftPct}%`} />
          <StatCard label="Miss Right" value={`${stats.missRightPct}%`} />
          <StatCard label="Penalties" value={stats.penaltyCount} accent="warning" />
          <StatCard label="Round Time" value={durationLabel(round.started_at, round.completed_at)} />
        </Box>

        {stats.clubsUsed.size > 0 && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Clubs Used
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
                {[...stats.clubsUsed].map((clubId) => {
                  const club = bag.find((c) => c.clubId === clubId);
                  return (
                    <Chip key={clubId} label={club ? club.customName || club.name : 'Club'} size="small" />
                  );
                })}
              </Box>
            </CardContent>
          </Card>
        )}

        <Button
          variant="contained"
          size="large"
          startIcon={<HomeRoundedIcon />}
          onClick={() => navigate('/')}
        >
          Done
        </Button>
        <Typography variant="caption" color="text.secondary" align="center">
          Estimated handicap only. Not an official USGA handicap.
        </Typography>
      </Stack>
      )}

      {tab === 'holes' && (
        <HolesTab
          roundId={round.id}
          courseId={round.course_id}
          holes={holes}
          shots={shots}
          bag={bag}
          focusHoleNumber={focusHoleNumber}
          onFocusConsumed={() => setFocusHoleNumber(null)}
        />
      )}

      <EditRoundDialog
        open={editOpen}
        onClose={() => setEditOpen(false)}
        round={round}
        holes={holes}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// EditRoundDialog — date played + per-hole par/strokes/putts editor
// ---------------------------------------------------------------------------

interface EditRoundDialogProps {
  open: boolean;
  onClose: () => void;
  round: Round;
  holes: RoundHole[];
}

interface HoleDraft {
  holeNumber: number;
  par: string;
  strokes: string;
  putts: string;
}

function EditRoundDialog({ open, onClose, round, holes }: EditRoundDialogProps) {
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);
  const [datePlayed, setDatePlayed] = useState<string>('');
  const [drafts, setDrafts] = useState<HoleDraft[]>([]);
  const [error, setError] = useState<string | null>(null);

  // Reset form when reopened so canceling and reopening discards in-progress
  // edits cleanly. Keyed off `open` rather than `round` because the user might
  // be mid-edit when the underlying query refetches.
  useEffect(() => {
    if (!open) return;
    setDatePlayed(isoToDateInput(round.started_at));
    setDrafts(
      // Fill any missing holes (sparse round_holes rows) with blanks so the
      // editor always shows holes 1..N. We never insert blanks back unless
      // the user enters a non-zero value.
      Array.from({ length: round.holes_played }, (_, i) => {
        const num = i + 1;
        const existing = holes.find((h) => h.hole_number === num);
        return {
          holeNumber: num,
          par: existing ? String(existing.par) : '4',
          strokes: existing ? String(existing.strokes) : '0',
          putts: existing ? String(existing.putts) : '0'
        };
      })
    );
    setError(null);
  }, [open, round, holes]);

  const updateDraft = (idx: number, patch: Partial<HoleDraft>) => {
    setDrafts((prev) => prev.map((d, i) => (i === idx ? { ...d, ...patch } : d)));
  };

  const totals = useMemo(() => {
    let par = 0;
    let strokes = 0;
    for (const d of drafts) {
      par += Number(d.par) || 0;
      strokes += Number(d.strokes) || 0;
    }
    return { par, strokes };
  }, [drafts]);

  const save = useMutation({
    mutationFn: async () => {
      if (!userId) throw new Error('Not authenticated');
      // Validate. We catch the common foot-guns: putts > strokes, par out of
      // range. Backend has no constraint on these so client-side is the only
      // gate.
      for (const d of drafts) {
        const par = Number(d.par);
        const strokes = Number(d.strokes);
        const putts = Number(d.putts);
        if (!Number.isFinite(par) || par < 3 || par > 6) {
          throw new Error(`Hole ${d.holeNumber}: par must be 3–6.`);
        }
        if (!Number.isFinite(strokes) || strokes < 0 || strokes > 20) {
          throw new Error(`Hole ${d.holeNumber}: strokes must be 0–20.`);
        }
        if (!Number.isFinite(putts) || putts < 0 || putts > 10) {
          throw new Error(`Hole ${d.holeNumber}: putts must be 0–10.`);
        }
        if (putts > strokes) {
          throw new Error(`Hole ${d.holeNumber}: putts can't exceed total strokes.`);
        }
      }

      const startedAt = dateInputToIso(datePlayed);
      const totalPar = totals.par;
      const totalStrokes = totals.strokes;
      const completedAt = round.completed_at ?? startedAt;

      // Update the round row first. score_vs_par is denormalized so we keep
      // it in sync. handicap_differential is recomputed lazily on next view.
      await roundRepo.update(round.id, {
        started_at: startedAt,
        completed_at: completedAt,
        par: totalPar,
        score: totalStrokes,
        score_vs_par: totalStrokes - totalPar,
        // Invalidate the cached differential — useRoundDetails recomputes
        // it on next mount when null, which is what we want post-edit.
        handicap_differential: null
      });

      // Upsert each hole. round_id + hole_number is the conflict key. Keep
      // penalty_strokes / fairway / gir / sand / clubs_used as-is so an edit
      // doesn't blow away shot-derived stats. Preserve hole_id when present.
      const upserts = drafts.map((d) => {
        const existing = holes.find((h) => h.hole_number === d.holeNumber);
        return {
          // Conflict target is the PK now, so every row needs an id: reuse the
          // existing one, or mint one for a hole the server hasn't seen.
          id: existing?.id ?? newId(),
          round_id: round.id,
          hole_number: d.holeNumber,
          par: Number(d.par),
          strokes: Number(d.strokes),
          putts: Number(d.putts),
          penalty_strokes: existing?.penalty_strokes ?? 0,
          fairway_result: existing?.fairway_result ?? null,
          sand: existing?.sand ?? false,
          gir: existing?.gir ?? false,
          clubs_used: existing?.clubs_used ?? [],
          yardage: existing?.yardage ?? null
        };
      });
      await roundRepo.upsertHoles(upserts);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['round-detail', round.id] });
      queryClient.invalidateQueries({ queryKey: ['rounds', userId] });
      onClose();
    },
    onError: (err) => {
      setError(toAppError(err).message);
    }
  });

  const onSubmit = () => {
    setError(null);
    save.mutate();
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (save.isPending) return;
        onClose();
      }}
      fullWidth
      maxWidth="sm"
      scroll="paper"
      PaperProps={{ sx: { borderRadius: '5px' } }}
    >
      <DialogTitle sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', pr: 1 }}>
        Edit Round
        <IconButton onClick={onClose} disabled={save.isPending} size="small">
          <CloseRoundedIcon />
        </IconButton>
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            label="Date played"
            type="date"
            value={datePlayed}
            onChange={(e) => setDatePlayed(e.target.value)}
            fullWidth
            InputLabelProps={{ shrink: true }}
            inputProps={{ max: isoToDateInput(new Date().toISOString()) }}
          />

          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}
            >
              Scorecard
            </Typography>

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: '40px 1fr 1fr 1fr',
                columnGap: 1,
                rowGap: 0.5,
                alignItems: 'center',
                mt: 1
              }}
            >
              <Box />
              <Typography variant="caption" color="text.secondary" align="center">
                Par
              </Typography>
              <Typography variant="caption" color="text.secondary" align="center">
                Strokes
              </Typography>
              <Typography variant="caption" color="text.secondary" align="center">
                Putts
              </Typography>

              {drafts.map((d, idx) => (
                <HoleEditRow
                  key={d.holeNumber}
                  draft={d}
                  onChange={(patch) => updateDraft(idx, patch)}
                  disabled={save.isPending}
                />
              ))}
            </Box>

            <Stack
              direction="row"
              justifyContent="flex-end"
              spacing={2}
              sx={{ mt: 1.5, pt: 1, borderTop: 1, borderColor: 'divider' }}
            >
              <Typography variant="body2" color="text.secondary">
                Par {totals.par}
              </Typography>
              <Typography variant="body2" sx={{ fontWeight: 700 }}>
                Total {totals.strokes}
              </Typography>
              <Typography variant="body2" color="primary" sx={{ fontWeight: 700 }}>
                {scoreVsPar(totals.strokes, totals.par)}
              </Typography>
            </Stack>
          </Box>

          {error && <Alert severity="error">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={save.isPending}>
          Cancel
        </Button>
        <Button variant="contained" onClick={onSubmit} disabled={save.isPending}>
          {save.isPending ? 'Saving…' : 'Save'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

function HoleEditRow({
  draft,
  onChange,
  disabled
}: {
  draft: HoleDraft;
  onChange: (patch: Partial<HoleDraft>) => void;
  disabled: boolean;
}) {
  return (
    <>
      <Typography variant="body2" sx={{ fontWeight: 700, textAlign: 'center' }}>
        {draft.holeNumber}
      </Typography>
      <NumberCell
        value={draft.par}
        onChange={(par) => onChange({ par })}
        disabled={disabled}
        min={3}
        max={6}
      />
      <NumberCell
        value={draft.strokes}
        onChange={(strokes) => onChange({ strokes })}
        disabled={disabled}
        min={0}
        max={20}
      />
      <NumberCell
        value={draft.putts}
        onChange={(putts) => onChange({ putts })}
        disabled={disabled}
        min={0}
        max={10}
      />
    </>
  );
}

function NumberCell({
  value,
  onChange,
  disabled,
  min,
  max
}: {
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
  min: number;
  max: number;
}) {
  return (
    <TextField
      value={value}
      onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
      type="number"
      size="small"
      disabled={disabled}
      inputProps={{
        inputMode: 'numeric',
        min,
        max,
        style: { textAlign: 'center', padding: '6px 0', fontVariantNumeric: 'tabular-nums' }
      }}
    />
  );
}

/** ISO timestamp → YYYY-MM-DD using the user's local timezone. */
function isoToDateInput(iso: string): string {
  const d = new Date(iso);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/**
 * YYYY-MM-DD (local) → ISO timestamp anchored at noon local time. Noon avoids
 * day-shift in negative-UTC offsets that bit us before. Falls back to now if
 * the input is unparseable (date inputs guarantee well-formed strings, but
 * we're defensive about user-typed dates).
 */
function dateInputToIso(s: string): string {
  if (!s) return new Date().toISOString();
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return new Date().toISOString();
  return new Date(y, m - 1, d, 12, 0, 0, 0).toISOString();
}

interface ScoreCardProps {
  holes: Array<{ hole_number: number; par: number; strokes: number; penalty_strokes: number }>;
  frontTotal: number;
  frontPar: number;
  backTotal: number;
  backPar: number;
}

function ScoreCard({ holes, frontTotal, frontPar, backTotal, backPar }: ScoreCardProps) {
  const front = holes.filter((h) => h.hole_number <= 9);
  const back = holes.filter((h) => h.hole_number > 9);

  return (
    <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
      <CardContent>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Scorecard
        </Typography>
        <Box sx={{ overflowX: 'auto', mt: 1 }}>
          <NineRow label="Front 9" holes={front} totalLabel="OUT" total={frontTotal} parTotal={frontPar} />
          {back.length > 0 && (
            <NineRow label="Back 9" holes={back} totalLabel="IN" total={backTotal} parTotal={backPar} />
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

function NineRow({
  label,
  holes,
  totalLabel,
  total,
  parTotal
}: {
  label: string;
  holes: Array<{ hole_number: number; par: number; strokes: number; penalty_strokes: number }>;
  totalLabel: string;
  total: number;
  parTotal: number;
}) {
  return (
    <Box mt={1.5}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${holes.length}, minmax(36px, 1fr)) 60px`,
          gap: 0.5,
          mt: 0.5,
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {holes.map((h) => (
          <Box key={`hole-${h.hole_number}`} sx={{ textAlign: 'center', fontSize: 12, color: 'text.secondary' }}>
            {h.hole_number}
          </Box>
        ))}
        <Box sx={{ textAlign: 'center', fontSize: 12, color: 'text.secondary' }}>{totalLabel}</Box>
        {holes.map((h) => (
          <Box key={`par-${h.hole_number}`} sx={{ textAlign: 'center', fontSize: 12, color: 'text.secondary' }}>
            {h.par}
          </Box>
        ))}
        <Box sx={{ textAlign: 'center', fontSize: 12, color: 'text.secondary' }}>{parTotal}</Box>
        {holes.map((h) => {
          const holeScore = h.strokes + h.penalty_strokes;
          return (
            <Box
              key={`s-${h.hole_number}`}
              sx={{
                textAlign: 'center',
                py: 0.5,
                borderRadius: 1,
                fontWeight: 700,
                bgcolor: scoreColor(holeScore, h.par),
                color: 'common.white'
              }}
            >
              {holeScore || '-'}
            </Box>
          );
        })}
        <Box sx={{ textAlign: 'center', py: 0.5, fontWeight: 700 }}>{total || '-'}</Box>
      </Box>
      <Typography variant="caption" color="text.secondary" mt={0.5} display="block">
        Hits {pct(holes.filter((h) => h.strokes + h.penalty_strokes > 0 && h.strokes + h.penalty_strokes <= h.par).length, holes.length)}% to par
      </Typography>
    </Box>
  );
}

function scoreColor(strokes: number, par: number): string {
  if (strokes === 0) return 'rgba(255,255,255,0.08)';
  const diff = strokes - par;
  if (diff <= -2) return '#1976d2';
  if (diff === -1) return '#2e7d32';
  if (diff === 0) return '#4caf50';
  if (diff === 1) return '#ef6c00';
  return '#c62828';
}

// ---------------------------------------------------------------------------
// Holes tab — horizontal hole picker + per-hole detail card. Mirrors the
// layout from the design reference (IMG_6204): scrollable hole strip at the
// top, big "Hole N" header with the played score on the right, then a
// "Score Distribution" row (single-round semantics: the actual outcome
// shows 100%, other categories 0%), and a 4-card Hole Stats grid.
// ---------------------------------------------------------------------------

type HoleCategory = 'birdiePlus' | 'par' | 'bogey' | 'doublePlus';
const CATEGORY_COLORS: Record<HoleCategory, string> = {
  birdiePlus: '#3b82f6',
  par: '#6b7280',
  bogey: '#ef6c00',
  doublePlus: '#c62828'
};
const CATEGORY_LABELS: Record<HoleCategory, string> = {
  birdiePlus: 'Birdie+',
  par: 'Par',
  bogey: 'Bogey',
  doublePlus: 'Double+'
};

function categoryFor(score: number, par: number): HoleCategory | null {
  if (score === 0) return null;
  const diff = score - par;
  if (diff <= -1) return 'birdiePlus';
  if (diff === 0) return 'par';
  if (diff === 1) return 'bogey';
  return 'doublePlus';
}

function HolesTab({
  roundId,
  courseId,
  holes,
  shots,
  bag,
  focusHoleNumber,
  onFocusConsumed
}: {
  roundId: string;
  courseId: string | null;
  /** When set (from a "needs review" chip), select this hole. */
  focusHoleNumber?: number | null;
  /** Called after focusHoleNumber has been applied so the parent can reset it. */
  onFocusConsumed?: () => void;
  holes: Array<{
    id: string;
    hole_number: number;
    par: number;
    strokes: number;
    putts: number;
    sand: boolean;
    gir: boolean;
    penalty_strokes: number;
    fairway_result: string | null;
  }>;
  shots: Array<HolesTabShot>;
  bag: BagClub[];
}) {
  const queryClient = useQueryClient();
  const [editingShot, setEditingShot] = useState<HolesTabShot | null>(null);
  /** Shot pending delete-confirmation. null = no confirm dialog open. */
  const [deletingShot, setDeletingShot] = useState<HolesTabShot | null>(null);
  /** Open the shot sheet to ADD a shot (appended) to this hole. Use the row
   *  reorder controls to move it into position. */
  const [addContext, setAddContext] = useState<{
    holeId: string;
    holePar: number;
  } | null>(null);
  /** Currently-open map dialog (which hole's map to show). null = closed. */
  const [mapHoleNumber, setMapHoleNumber] = useState<number | null>(null);
  /** Shot ids whose watch swing detail is expanded. Collapsed by default so the
   *  hole reads as a scorecard first; the detail is opt-in per shot. */
  const [expandedSwings, setExpandedSwings] = useState<Set<string>>(new Set());
  const toggleSwingDetail = (shotId: string) =>
    setExpandedSwings((prev) => {
      const next = new Set(prev);
      if (next.has(shotId)) next.delete(shotId);
      else next.add(shotId);
      return next;
    });

  // Persist shot_number = idx+1 for a hole's shots in the given order. Only the
  // rows whose number actually changed are written. Backs insert / reorder /
  // delete so the play order survives (summary reads shot_number from remote).
  const persistHoleOrder = async (ordered: HolesTabShot[]) => {
    await Promise.all(
      ordered.map((s, idx) =>
        s.shot_number === idx + 1
          ? null
          : roundRepo
              .updateShot(s.id, { shot_number: idx + 1 })
              .catch((err) => console.error('[summary] renumber failed', err))
      )
    );
    queryClient.invalidateQueries({ queryKey: ['round-detail', roundId] });
  };

  // A hole's shots in play order, read from the current (remote) shots prop.
  const holeShotsSorted = (holeId: string) =>
    shots
      .filter((s) => s.hole_id === holeId)
      .sort((a, b) => a.shot_number - b.shot_number);

  const onConfirmDelete = async () => {
    if (!deletingShot) return;
    const holeId = deletingShot.hole_id;
    try {
      await roundRepo.deleteShot(deletingShot.id);
      // Renumber the survivors so the hole stays 1..N with no gap.
      await persistHoleOrder(
        holeShotsSorted(holeId).filter((s) => s.id !== deletingShot.id)
      );
    } catch (err) {
      console.error('[summary] shot delete failed', err);
    }
    setDeletingShot(null);
  };

  // Nudge a shot one slot earlier/later within its hole and persist the order.
  const onMoveShotSummary = async (shot: HolesTabShot, dir: -1 | 1) => {
    const list = holeShotsSorted(shot.hole_id);
    const idx = list.findIndex((s) => s.id === shot.id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= list.length) return;
    const next = [...list];
    const [moved] = next.splice(idx, 1);
    next.splice(to, 0, moved);
    await persistHoleOrder(next);
  };

  // Save a brand-new shot (append or insert-after), then bump the shots after
  // the insert point so numbering stays contiguous.
  const onSubmitAdd = async (payload: {
    clubId: string | null;
    distance: number | null;
    distanceUnit: DistanceUnit | null;
    targetType: TargetType;
    targetResult: TargetResult;
    lie: Lie | null;
    penaltyType: PenaltyType | null;
    derivedShotResult: import('@/models').ShotResult;
    notes: string | null;
    startLat: number | null;
    startLng: number | null;
    endLat: number | null;
    endLng: number | null;
    calculatedDistance: number | null;
  }) => {
    if (!addContext) return;
    const list = holeShotsSorted(addContext.holeId);
    try {
      await roundRepo.addShot({
        id: newId(),
        round_id: roundId,
        hole_id: addContext.holeId,
        // Append at the end; the reorder controls move it into position.
        shot_number: list.length + 1,
        club_id: payload.clubId,
        shot_result: payload.derivedShotResult,
        target_type: payload.targetType,
        target_result: payload.targetResult,
        lie: payload.lie,
        penalty_type: payload.penaltyType,
        distance: payload.distance,
        distance_unit: payload.distanceUnit,
        notes: payload.notes,
        start_lat: payload.startLat,
        start_lng: payload.startLng,
        end_lat: payload.endLat,
        end_lng: payload.endLng,
        calculated_distance: payload.calculatedDistance,
        verified: true
      });
      queryClient.invalidateQueries({ queryKey: ['round-detail', roundId] });
      setAddContext(null);
    } catch (err) {
      console.error('[summary] add shot failed', err);
    }
  };

  const editingDraft: ShotEditDraft | null = useMemo(() => {
    if (!editingShot) return null;
    return {
      clubId: editingShot.club_id,
      distance: editingShot.distance,
      distanceUnit: editingShot.distance_unit as DistanceUnit | null,
      targetType: editingShot.target_type as TargetType | null,
      targetResult: editingShot.target_result as TargetResult | null,
      lie: editingShot.lie as Lie | null,
      penaltyType: editingShot.penalty_type as PenaltyType | null,
      notes: editingShot.notes,
      startLat: editingShot.start_lat ?? null,
      startLng: editingShot.start_lng ?? null,
      endLat: editingShot.end_lat ?? null,
      endLng: editingShot.end_lng ?? null,
      calculatedDistance: editingShot.calculated_distance ?? null
    };
  }, [editingShot]);

  const editingHolePar = useMemo(() => {
    if (!editingShot) return 4;
    return holes.find((h) => h.id === editingShot.hole_id)?.par ?? 4;
  }, [editingShot, holes]);

  const onSubmitEdit = async (payload: {
    clubId: string | null;
    distance: number | null;
    distanceUnit: DistanceUnit | null;
    targetType: TargetType;
    targetResult: TargetResult;
    lie: Lie | null;
    penaltyType: PenaltyType | null;
    derivedShotResult: import('@/models').ShotResult;
    notes: string | null;
    startLat: number | null;
    startLng: number | null;
    endLat: number | null;
    endLng: number | null;
    calculatedDistance: number | null;
  }) => {
    if (!editingShot) return;
    try {
      await roundRepo.updateShot(editingShot.id, {
        club_id: payload.clubId,
        shot_result: payload.derivedShotResult,
        target_type: payload.targetType,
        target_result: payload.targetResult,
        lie: payload.lie,
        penalty_type: payload.penaltyType,
        distance: payload.distance,
        distance_unit: payload.distanceUnit,
        notes: payload.notes,
        start_lat: payload.startLat,
        start_lng: payload.startLng,
        end_lat: payload.endLat,
        end_lng: payload.endLng,
        calculated_distance: payload.calculatedDistance,
        // Reviewing/saving a shot here confirms it — clears the "needs review"
        // flag just like editing it on the live per-hole page does.
        verified: true
      });
      // Refresh the summary data so the edited row re-renders with the
      // new values + any downstream cards (Scorecard, stats) recompute.
      queryClient.invalidateQueries({ queryKey: ['round-detail', roundId] });
      setEditingShot(null);
    } catch (err) {
      console.error('[summary] shot edit failed', err);
    }
  };
  const sorted = useMemo(
    () => [...holes].sort((a, b) => a.hole_number - b.hole_number),
    [holes]
  );

  // Unique clubs used per hole, in the order they were first hit. Looks
  // each up in the player's bag for the display name; falls back to
  // "Club" for orphan ids (deleted from the bag after the round).
  const clubsByHole = useMemo(() => {
    const out = new Map<string, string[]>();
    for (const s of shots) {
      if (!s.club_id) continue;
      const arr = out.get(s.hole_id) ?? [];
      if (!arr.includes(s.club_id)) arr.push(s.club_id);
      out.set(s.hole_id, arr);
    }
    return out;
  }, [shots]);

  // Full shot list per hole, sorted by shot_number so the rendered list
  // mirrors the chronological order they were played in.
  const shotsByHole = useMemo(() => {
    const out = new Map<string, typeof shots>();
    for (const s of shots) {
      const arr = out.get(s.hole_id) ?? [];
      arr.push(s);
      out.set(s.hole_id, arr);
    }
    for (const arr of out.values()) {
      arr.sort((a, b) => a.shot_number - b.shot_number);
    }
    return out;
  }, [shots]);

  const nameForClubId = (id: string): string => {
    const c = bag.find((b) => b.clubId === id);
    return c ? c.customName || c.name : 'Club';
  };
  // Default to the first played hole; fall back to hole 1.
  const firstPlayedIdx = sorted.findIndex((h) => h.strokes > 0);
  const [selectedHoleNumber, setSelectedHoleNumber] = useState<number>(
    sorted[firstPlayedIdx >= 0 ? firstPlayedIdx : 0]?.hole_number ?? 1
  );

  // The Shots card, so a hole jumped to from the "needs review" chips can be
  // scrolled to. Nothing on this page scrolls itself otherwise: the scroll
  // container is MobileShell's inner Box (the document body is locked
  // `position: fixed`), so switching tabs left the viewport wherever it
  // happened to be — the shots the golfer was sent here to review sat below
  // the fold behind the hole strip, stats and clubs cards.
  const shotsCardRef = useRef<HTMLDivElement | null>(null);
  /** Pending scroll frame, so an unmount mid-animation doesn't leave it queued. */
  const scrollFrameRef = useRef<number | null>(null);

  // Jump to a hole requested from the summary's "needs review" chips, then tell
  // the parent it's been consumed so re-tapping the same hole re-triggers it.
  useEffect(() => {
    if (focusHoleNumber == null) return;
    setSelectedHoleNumber(focusHoleNumber);
    onFocusConsumed?.();
    // Two frames: one for this tab's content to mount, one for it to lay out.
    // scrollIntoView finds the real scroll container by itself.
    scrollFrameRef.current = requestAnimationFrame(() => {
      scrollFrameRef.current = requestAnimationFrame(() => {
        scrollFrameRef.current = null;
        shotsCardRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    return () => {
      if (scrollFrameRef.current != null) {
        cancelAnimationFrame(scrollFrameRef.current);
        scrollFrameRef.current = null;
      }
    };
  }, [focusHoleNumber, onFocusConsumed]);

  // Hole numbers that still have an unverified (auto-detected) shot — drives the
  // amber "needs review" dot on the hole strip and the per-shot flag below.
  const holesNeedingReview = useMemo(() => {
    const out = new Set<string>();
    for (const s of shots) if (s.verified === false) out.add(s.hole_id);
    return out;
  }, [shots]);

  // Mark a single auto-detected shot as confirmed, in place.
  const verifyShotRow = async (shot: HolesTabShot) => {
    try {
      await roundRepo.updateShot(shot.id, { verified: true });
      queryClient.invalidateQueries({ queryKey: ['round-detail', roundId] });
    } catch (err) {
      console.error('[summary] shot verify failed', err);
    }
  };

  const selected =
    sorted.find((h) => h.hole_number === selectedHoleNumber) ?? sorted[0];
  if (!selected) {
    return (
      <Box px={2} mt={2}>
        <Alert severity="info" variant="outlined">
          No holes recorded for this round.
        </Alert>
      </Box>
    );
  }

  const score = selected.strokes + selected.penalty_strokes;
  const diff = score - selected.par;
  const played = score > 0;
  const cat = categoryFor(score, selected.par);

  return (
    <Stack spacing={2} px={2} pb={4} mt={2}>
      {/* Horizontal hole strip — tap a card to switch the detail view. */}
      <Box
        sx={{
          display: 'flex',
          gap: 1,
          overflowX: 'auto',
          pb: 1,
          WebkitOverflowScrolling: 'touch'
        }}
      >
        {sorted.map((h) => {
          const hScore = h.strokes + h.penalty_strokes;
          const isSelected = h.hole_number === selectedHoleNumber;
          const needsReview = holesNeedingReview.has(h.id);
          return (
            <Box
              key={h.hole_number}
              onClick={() => setSelectedHoleNumber(h.hole_number)}
              role="button"
              sx={{
                position: 'relative',
                minWidth: 64,
                px: 1,
                py: 0.75,
                borderRadius: '5px',
                bgcolor: isSelected ? 'rgba(22,163,74,0.22)' : 'background.paper',
                border: 1,
                borderColor: isSelected
                  ? '#16a34a'
                  : needsReview
                    ? 'rgba(251,191,36,0.55)'
                    : 'divider',
                textAlign: 'center',
                cursor: 'pointer',
                flexShrink: 0
              }}
            >
              {needsReview && (
                <Box
                  aria-label="needs review"
                  sx={{
                    position: 'absolute',
                    top: 4,
                    right: 4,
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    bgcolor: '#fbbf24'
                  }}
                />
              )}
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', lineHeight: 1 }}
              >
                Hole
              </Typography>
              <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
                {h.hole_number}
              </Typography>
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', lineHeight: 1 }}
              >
                Par {h.par || '—'}
                {hScore > 0 ? ` · ${hScore}` : ''}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* Hole header — number / par on the left, score on right. Score is
          rendered as a plain integer (no decimal) since a single round
          can only yield a whole-stroke total per hole. */}
      <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
        <CardContent>
          <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
            <Box>
              <Typography variant="h5" sx={{ fontWeight: 800 }}>
                Hole {selected.hole_number}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Par {selected.par || '—'}
              </Typography>
            </Box>
            <Box textAlign="right">
              <Typography variant="h4" sx={{ fontWeight: 800 }}>
                {played ? score : '—'}
              </Typography>
              {played && (
                <Typography
                  variant="body2"
                  sx={{ fontWeight: 700 }}
                  color={diff <= 0 ? 'primary' : 'warning.main'}
                >
                  {diff === 0 ? 'E' : diff > 0 ? `+${diff}` : `${diff}`}
                </Typography>
              )}
            </Box>
          </Stack>
        </CardContent>
      </Card>

      {/* View Map — opens a dialog with the hole layout + every recorded
          shot end position rendered as a numbered dot. Read-only (no
          tap-to-record; hideAim suppresses the aim handle). Hidden when
          the round has no course id (orphaned round / pre-course-library
          import) since there's no layout to fetch. */}
      {courseId && (
        <Button
          variant="outlined"
          size="small"
          startIcon={<MapRoundedIcon />}
          onClick={() => setMapHoleNumber(selected.hole_number)}
          sx={{ borderRadius: '5px', textTransform: 'none', alignSelf: 'flex-start' }}
        >
          View map
        </Button>
      )}

      {/* Hole Stats — Putts / GIR / Fairway (3 across). The 4th slot used
          to be Score; the section below replaces it with a full-width
          Clubs Used card listing each club hit on this hole. */}
      <Stack direction="row" alignItems="center" spacing={1}>
        <FlagRoundedIcon fontSize="small" color="primary" />
        <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
          Hole Stats
        </Typography>
      </Stack>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 1.5
        }}
      >
        <HoleStatCard
          icon={<SportsGolfRoundedIcon fontSize="small" />}
          value={played ? String(selected.putts) : '—'}
          label="Putts"
        />
        <HoleStatCard
          icon={<GpsFixedRoundedIcon fontSize="small" />}
          value={played ? (selected.gir ? 'Yes' : 'No') : '—'}
          label="GIR"
        />
        <HoleStatCard
          icon={<FlagRoundedIcon fontSize="small" />}
          value={fairwayDisplay(selected.par, selected.fairway_result)}
          label="Fairway"
        />
      </Box>

      {/* Clubs Used — every distinct club that contributed a shot on this
          hole, in the order it was first hit. Pulled from the shots list
          filtered by hole_id. */}
      <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} mb={1}>
            <SportsGolfRoundedIcon fontSize="small" color="primary" />
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Clubs Used
            </Typography>
          </Stack>
          {(() => {
            const clubIds = clubsByHole.get(selected.id) ?? [];
            if (clubIds.length === 0) {
              return (
                <Typography variant="body2" color="text.secondary">
                  No clubs recorded for this hole.
                </Typography>
              );
            }
            return (
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                {clubIds.map((id) => (
                  <Chip key={id} label={nameForClubId(id)} size="small" />
                ))}
              </Box>
            );
          })()}
        </CardContent>
      </Card>

      {/* Shots — every recorded shot on this hole, in play order. Each row
          shows shot #, club, distance, outcome (target_result + lie), and
          any penalty / notes. Sourced from the shots list filtered by
          hole_id (see shotsByHole above). */}
      <Card
        ref={shotsCardRef}
        elevation={0}
        // scroll-margin keeps the card's heading clear of the top edge when a
        // "needs review" chip scrolls it into view.
        sx={{ bgcolor: 'background.paper', borderRadius: '5px', scrollMarginTop: 12 }}
      >
        <CardContent>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            spacing={1}
            mb={1}
          >
            <Stack direction="row" alignItems="center" spacing={1}>
              <FlagRoundedIcon fontSize="small" color="primary" />
              <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                Shots
              </Typography>
            </Stack>
            <Button
              size="small"
              variant="outlined"
              startIcon={<AddRoundedIcon />}
              onClick={() =>
                setAddContext({
                  holeId: selected.id,
                  holePar: selected.par || 4
                })
              }
              sx={{ borderRadius: '5px', textTransform: 'none' }}
            >
              Add shot
            </Button>
          </Stack>
          {(() => {
            const list = shotsByHole.get(selected.id) ?? [];
            if (list.length === 0) {
              return (
                <Typography variant="body2" color="text.secondary">
                  No shots recorded for this hole.
                </Typography>
              );
            }
            return (
              <Stack spacing={1}>
                {list.map((s, sIdx, sArr) => {
                  const clubLabel = s.club_id ? nameForClubId(s.club_id) : 'No club';
                  const dist = formatShotDistance(s.distance, s.distance_unit);
                  const outcome = formatShotOutcome(s.target_type, s.target_result, s.lie);
                  const penalty = formatPenalty(s.penalty_type);
                  const swingSummary = formatSwingSummary(s.swing_type, s.swing_metrics);
                  // Only offer the expander when there's actually detail behind
                  // it — manual shots carry no watch metrics.
                  const swingDetail = hasSwingDetail(s.swing_metrics);
                  const swingOpen = expandedSwings.has(s.id);
                  const canMoveUp = sIdx > 0;
                  const canMoveDown = sIdx < sArr.length - 1;
                  return (
                    <Box
                      key={s.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => setEditingShot(s)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setEditingShot(s);
                        }
                      }}
                      sx={{
                        display: 'grid',
                        // Columns: reorder (stacked up/down, LEFT of the number),
                        // shot#, body, distance, verify, delete. Add is via the
                        // header button only (append) — reorder positions it. The
                        // row body is tap-to-edit (no separate pencil). Verify
                        // only acts on unverified rows (empty spacer otherwise).
                        // Icon handlers stopPropagation so they don't bubble to
                        // the row's edit-on-tap.
                        gridTemplateColumns: '22px 30px 1fr auto 24px 24px',
                        alignItems: 'center',
                        columnGap: 1,
                        rowGap: 0.25,
                        py: 0.75,
                        px: 0.5,
                        // Amber wash + left accent flags an unverified shot.
                        bgcolor: s.verified ? undefined : 'rgba(251,191,36,0.08)',
                        borderLeft: s.verified ? undefined : '3px solid #fbbf24',
                        borderBottom: 1,
                        borderColor: 'divider',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        '&:hover': {
                          bgcolor: s.verified
                            ? 'rgba(255,255,255,0.04)'
                            : 'rgba(251,191,36,0.14)',
                          '& .shot-edit-icon': { opacity: 1 }
                        },
                        '&:active': { bgcolor: 'rgba(255,255,255,0.06)' },
                        '&:last-of-type': { borderBottom: 'none' }
                      }}
                    >
                      {/* Reorder — stacked up/down to the LEFT of the number. */}
                      <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                        <Box
                          role="button"
                          tabIndex={0}
                          aria-label={`Move shot ${s.shot_number} earlier`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (canMoveUp) void onMoveShotSummary(s, -1);
                          }}
                          sx={{
                            display: 'flex',
                            justifyContent: 'center',
                            cursor: canMoveUp ? 'pointer' : 'default',
                            opacity: canMoveUp ? 0.7 : 0.2
                          }}
                        >
                          <KeyboardArrowUpRoundedIcon sx={{ fontSize: 18 }} />
                        </Box>
                        <Box
                          role="button"
                          tabIndex={0}
                          aria-label={`Move shot ${s.shot_number} later`}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (canMoveDown) void onMoveShotSummary(s, 1);
                          }}
                          sx={{
                            display: 'flex',
                            justifyContent: 'center',
                            cursor: canMoveDown ? 'pointer' : 'default',
                            opacity: canMoveDown ? 0.7 : 0.2
                          }}
                        >
                          <KeyboardArrowDownRoundedIcon sx={{ fontSize: 18 }} />
                        </Box>
                      </Box>
                      <Typography
                        variant="caption"
                        sx={{ fontWeight: 800, color: 'text.secondary' }}
                      >
                        #{s.shot_number}
                      </Typography>
                      <Box sx={{ minWidth: 0 }}>
                        <Typography variant="body2" sx={{ fontWeight: 700 }} noWrap>
                          {clubLabel}
                        </Typography>
                        <Typography variant="caption" color="text.secondary" noWrap>
                          {[outcome, penalty].filter(Boolean).join(' · ') || '—'}
                          {s.notes ? ` · ${s.notes}` : ''}
                        </Typography>
                        {swingSummary &&
                          (swingDetail ? (
                            // Tap the swing line to open the full watch detail.
                            // stopPropagation so it doesn't bubble to the row's
                            // edit-on-tap.
                            <Typography
                              component="div"
                              role="button"
                              tabIndex={0}
                              aria-expanded={swingOpen}
                              aria-label={`${swingOpen ? 'Hide' : 'Show'} swing detail for shot ${s.shot_number}`}
                              variant="caption"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleSwingDetail(s.id);
                              }}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter' || e.key === ' ') {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  toggleSwingDetail(s.id);
                                }
                              }}
                              sx={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: 0.25,
                                color: 'primary.light',
                                fontWeight: 600,
                                fontSize: '0.66rem',
                                cursor: 'pointer',
                                '&:hover': { textDecoration: 'underline' }
                              }}
                            >
                              {/* Ellipsis lives on the text span — the parent is
                                  flex (for the caret), where noWrap can't work. */}
                              <Box
                                component="span"
                                sx={{
                                  overflow: 'hidden',
                                  textOverflow: 'ellipsis',
                                  whiteSpace: 'nowrap'
                                }}
                              >
                                {swingSummary}
                              </Box>
                              {swingOpen ? (
                                <KeyboardArrowUpRoundedIcon sx={{ fontSize: 14, flexShrink: 0 }} />
                              ) : (
                                <KeyboardArrowDownRoundedIcon
                                  sx={{ fontSize: 14, flexShrink: 0 }}
                                />
                              )}
                            </Typography>
                          ) : (
                            <Typography
                              variant="caption"
                              noWrap
                              sx={{
                                display: 'block',
                                color: 'primary.light',
                                fontWeight: 600,
                                fontSize: '0.66rem'
                              }}
                            >
                              {swingSummary}
                            </Typography>
                          ))}
                        {!s.verified && (
                          <Typography
                            variant="caption"
                            sx={{
                              display: 'block',
                              color: '#d97706',
                              fontWeight: 800,
                              textTransform: 'uppercase',
                              letterSpacing: 0.4,
                              fontSize: '0.62rem'
                            }}
                          >
                            Needs review
                          </Typography>
                        )}
                      </Box>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 700, textAlign: 'right' }}
                      >
                        {dist}
                      </Typography>
                      {/* Confirm an auto-detected shot as-is. Empty spacer on
                          already-verified rows to hold the grid column. */}
                      {s.verified ? (
                        <Box />
                      ) : (
                        <Box
                          role="button"
                          tabIndex={0}
                          aria-label={`Verify shot ${s.shot_number}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            void verifyShotRow(s);
                          }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              e.stopPropagation();
                              void verifyShotRow(s);
                            }
                          }}
                          sx={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            cursor: 'pointer'
                          }}
                        >
                          <CheckCircleRoundedIcon
                            sx={{ fontSize: 20, color: 'success.main' }}
                          />
                        </Box>
                      )}
                      <Box
                        role="button"
                        tabIndex={0}
                        aria-label={`Delete shot ${s.shot_number}`}
                        onClick={(e) => {
                          // Don't bubble to the row's tap-to-edit.
                          e.stopPropagation();
                          setDeletingShot(s);
                        }}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            e.stopPropagation();
                            setDeletingShot(s);
                          }
                        }}
                        sx={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          cursor: 'pointer',
                          opacity: 0.6,
                          transition: 'opacity 120ms ease',
                          '&:hover': { opacity: 1 }
                        }}
                      >
                        <DeleteOutlineRoundedIcon
                          sx={{ fontSize: 18, color: 'error.light' }}
                        />
                      </Box>
                      {/* Watch swing detail — spans the whole row beneath it.
                          Click is swallowed so interacting with the panel (e.g.
                          tapping a feedback chip) doesn't open the edit sheet. */}
                      {swingDetail && s.swing_metrics && (
                        <Box
                          sx={{ gridColumn: '1 / -1' }}
                          onClick={(e) => e.stopPropagation()}
                          onKeyDown={(e) => e.stopPropagation()}
                        >
                          <Collapse in={swingOpen} unmountOnExit>
                            <RoundSwingDetail
                              swingType={s.swing_type}
                              metrics={s.swing_metrics}
                            />
                          </Collapse>
                        </Box>
                      )}
                    </Box>
                  );
                })}
              </Stack>
            );
          })()}
        </CardContent>
      </Card>

      <AddShotSheet
        open={editingShot !== null || addContext !== null}
        shotNumber={
          editingShot
            ? editingShot.shot_number
            : addContext
              ? holeShotsSorted(addContext.holeId).length + 1
              : 1
        }
        editing={addContext ? null : editingDraft}
        holePar={addContext ? addContext.holePar : editingHolePar}
        bagClubs={bag}
        onClose={() => {
          setEditingShot(null);
          setAddContext(null);
        }}
        onSubmit={addContext ? onSubmitAdd : onSubmitEdit}
      />

      <Dialog
        open={deletingShot !== null}
        onClose={() => setDeletingShot(null)}
        fullWidth
        maxWidth="xs"
        PaperProps={{ sx: { borderRadius: '5px' } }}
      >
        <DialogTitle>Delete shot?</DialogTitle>
        <DialogContent>
          <Typography variant="body2">
            Remove shot #{deletingShot?.shot_number} from this hole.
            This cannot be undone.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeletingShot(null)}>Cancel</Button>
          <Button color="error" variant="contained" onClick={onConfirmDelete}>
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      <HoleMapDialog
        open={mapHoleNumber !== null}
        roundId={roundId}
        courseId={courseId}
        holeNumber={mapHoleNumber}
        shots={shots}
        holes={holes}
        bag={bag}
        onClose={() => setMapHoleNumber(null)}
      />
    </Stack>
  );
}

/**
 * Read-only hole-map dialog launched from the Holes-tab "View map"
 * button. Renders the existing HoleLayoutCard with the per-hole shot
 * end positions as numbered dots and the aim UI suppressed.
 *
 * Defensive: any shot missing GPS coords is filtered out (the card
 * doesn't fake positions). If no shots had GPS, the map still renders
 * the hole geometry alone — useful as a refresher.
 */
function HoleMapDialog({
  open,
  roundId,
  courseId,
  holeNumber,
  shots,
  holes,
  bag,
  onClose
}: {
  open: boolean;
  roundId: string;
  courseId: string | null;
  holeNumber: number | null;
  shots: HolesTabShot[];
  holes: Array<{ id: string; hole_number: number; par: number }>;
  bag: BagClub[];
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  // When on (within edit mode), each map tap CREATES a new shot at the tapped
  // point — for logging a shot that was never recorded. Off → taps fall back to
  // assigning GPS onto existing un-mapped shots.
  const [addingShot, setAddingShot] = useState(false);
  // Leaving edit mode cancels add-shot mode.
  useEffect(() => {
    if (!editMode) setAddingShot(false);
  }, [editMode]);
  // Bumped each time the player taps "Recap" — triggers the tee → shots → pin
  // replay animation in HoleLayout. Reset when the dialog closes.
  const [recapToken, setRecapToken] = useState(0);
  // Optimistic per-shot drag positions, keyed by shot.id. Drag-end sets
  // this immediately so the dot stays at the new spot even before the
  // network round-trip completes — without it, leaving edit mode flips
  // the boolean dep, the map effect re-runs, and the marker rebuilds
  // from the prop's still-stale shotEndPoints (snap-back). Cleared on
  // dialog close.
  const [optimisticPositions, setOptimisticPositions] = useState<
    Map<string, [number, number]>
  >(new Map());
  // Reset the overrides each time the dialog opens — fresh per session.
  useEffect(() => {
    if (!open) {
      setOptimisticPositions(new Map());
      setRecapToken(0);
      setEditMode(false);
      setAddingShot(false);
    }
  }, [open]);
  const hole = holes.find((h) => h.hole_number === holeNumber) ?? null;

  // All shots for this hole in play order — used to discover the
  // "next unmapped shot" the tap-to-add flow assigns to.
  const allShotsForHole = useMemo(() => {
    if (!hole) return [] as HolesTabShot[];
    return shots
      .filter((s) => s.hole_id === hole.id)
      .sort((a, b) => a.shot_number - b.shot_number);
  }, [shots, hole]);

  // Ordered list of shots-with-GPS for this hole. Kept aligned with
  // shotEndPoints so the dot's index in the array maps back to the
  // shot row that needs updating on drag-end.
  const orderedShots = useMemo(
    () => allShotsForHole.filter((s) => s.end_lat != null && s.end_lng != null),
    [allShotsForHole]
  );

  // Shots on this hole missing GPS coords. Next-tap-while-editing
  // pins a position onto the FIRST of these in shot-number order.
  const unmappedShots = useMemo(
    () => allShotsForHole.filter((s) => s.end_lat == null || s.end_lng == null),
    [allShotsForHole]
  );

  const shotEndPoints = useMemo<Array<[number, number]>>(
    () =>
      orderedShots.map((s) => {
        const opt = optimisticPositions.get(s.id);
        if (opt) return opt;
        return [s.end_lng as number, s.end_lat as number];
      }),
    [orderedShots, optimisticPositions]
  );

  // Per-dot info-box labels (# / club / distance), aligned 1:1 with
  // shotEndPoints (built from the same orderedShots list).
  const shotLabels = useMemo(
    () =>
      orderedShots.map((s) => {
        const club = s.club_id ? bag.find((c) => c.clubId === s.club_id) ?? null : null;
        const clubName = club
          ? abbreviateClubName(club.customName?.trim() || club.name, club.category)
          : null;
        const distance =
          s.distance == null
            ? null
            : s.distance_unit === 'feet'
              ? `${Math.round(s.distance)}ft`
              : `${Math.round(s.distance)}y`;
        return { club: clubName, distance };
      }),
    [orderedShots, bag]
  );

  // Drag-end handler. Looks up the shot by index, recomputes the
  // GPS-calculated distance (haversine from start to the new end), and
  // patches the row in Supabase. Round-detail query invalidates so
  // every consumer (Scorecard, Shots list, dispersion stats) picks up
  // the corrected position.
  const onShotEndPointMoved = useMemo(() => {
    if (!editMode) return undefined;
    return async (index: number, newPos: [number, number]) => {
      const s = orderedShots[index];
      if (!s) return;
      const [lng, lat] = newPos;
      // Optimistically pin the dot to the dragged position so it
      // doesn't snap back when edit mode toggles off or the map
      // effect re-runs before the network round-trip finishes.
      setOptimisticPositions((prev) => {
        const next = new Map(prev);
        next.set(s.id, [lng, lat]);
        return next;
      });
      let calculated: number | null = null;
      if (s.start_lat != null && s.start_lng != null) {
        // Haversine in meters — same formula HoleLayout uses internally.
        const toRad = (d: number) => (d * Math.PI) / 180;
        const R = 6371000;
        const dLat = toRad(lat - s.start_lat);
        const dLng = toRad(lng - s.start_lng);
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(s.start_lat)) *
            Math.cos(toRad(lat)) *
            Math.sin(dLng / 2) ** 2;
        calculated = 2 * R * Math.asin(Math.sqrt(a));
      }
      try {
        await roundRepo.updateShot(s.id, {
          end_lat: lat,
          end_lng: lng,
          calculated_distance: calculated
        });
        queryClient.invalidateQueries({ queryKey: ['round-detail', roundId] });
      } catch (err) {
        console.error('[summary] shot reposition failed', err);
      }
    };
  }, [editMode, orderedShots, queryClient, roundId]);

  /// In edit mode, a map tap does one of two things:
  ///   • Add-shot mode ON  → CREATE a new shot at the tapped point (appended as
  ///     the next shot number), for logging a shot that was never recorded.
  ///   • Add-shot mode OFF → assign the position to the next shot missing GPS
  ///     coords (shot-number order), retro-populating shots logged without a
  ///     landing point.
  /// The callback is undefined (no-op tap) when neither applies.
  const onShotLanded = useMemo(() => {
    if (!editMode) return undefined;
    if (!addingShot && unmappedShots.length === 0) return undefined;
    return async (data: {
      start: [number, number];
      end: [number, number];
      calculatedDistanceM: number;
      inferredLie: Lie | null;
      inferredTargetResult: TargetResult | null;
    }) => {
      if (addingShot) {
        if (!hole) return;
        // Map the inferred lie onto a shot_result bucket; default to fairway.
        const lieResult: Record<string, ShotResult> = {
          fairway: 'fairway',
          rough: 'rough',
          sand: 'sand',
          green: 'green',
          recovery: 'recovery',
          penalty: 'penalty'
        };
        const shotResult: ShotResult =
          (data.inferredLie && lieResult[data.inferredLie]) || 'fairway';
        // Yardage of the new shot = GPS distance from the previous shot's
        // landing (the tap's `start`) to the tapped point.
        const yards = Math.round(data.calculatedDistanceM * 1.0936133);
        try {
          await roundRepo.addShot({
            id: newId(),
            round_id: roundId,
            hole_id: hole.id,
            // Append at the end; reorder in the shot list to fix the sequence.
            shot_number: allShotsForHole.length + 1,
            club_id: null,
            shot_result: shotResult,
            target_type: null,
            target_result: data.inferredTargetResult,
            lie: data.inferredLie,
            penalty_type: null,
            distance: yards,
            distance_unit: 'yards',
            notes: null,
            start_lat: data.start[1],
            start_lng: data.start[0],
            end_lat: data.end[1],
            end_lng: data.end[0],
            calculated_distance: data.calculatedDistanceM,
            verified: true
          });
          queryClient.invalidateQueries({ queryKey: ['round-detail', roundId] });
        } catch (err) {
          console.error('[summary] add new shot failed', err);
        }
        return;
      }
      const target = unmappedShots[0];
      if (!target) return;
      try {
        await roundRepo.updateShot(target.id, {
          end_lat: data.end[1],
          end_lng: data.end[0],
          calculated_distance: data.calculatedDistanceM
        });
        queryClient.invalidateQueries({ queryKey: ['round-detail', roundId] });
      } catch (err) {
        console.error('[summary] add shot position failed', err);
      }
    };
  }, [editMode, addingShot, unmappedShots, allShotsForHole, hole, queryClient, roundId]);

  // Reorder / delete for the map's Edit-mode shot list. Both renumber the hole
  // to keep it 1..N and refetch so the dots relabel.
  const persistMapOrder = async (ordered: HolesTabShot[]) => {
    await Promise.all(
      ordered.map((s, idx) =>
        s.shot_number === idx + 1
          ? null
          : roundRepo
              .updateShot(s.id, { shot_number: idx + 1 })
              .catch((err) => console.error('[summary] map renumber failed', err))
      )
    );
    queryClient.invalidateQueries({ queryKey: ['round-detail', roundId] });
  };

  const moveShotOnMap = async (shot: HolesTabShot, dir: -1 | 1) => {
    const idx = allShotsForHole.findIndex((s) => s.id === shot.id);
    const to = idx + dir;
    if (idx < 0 || to < 0 || to >= allShotsForHole.length) return;
    const next = [...allShotsForHole];
    const [moved] = next.splice(idx, 1);
    next.splice(to, 0, moved);
    await persistMapOrder(next);
  };

  const deleteShotOnMap = async (shot: HolesTabShot) => {
    try {
      await roundRepo.deleteShot(shot.id);
      await persistMapOrder(allShotsForHole.filter((s) => s.id !== shot.id));
    } catch (err) {
      console.error('[summary] map shot delete failed', err);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen
      PaperProps={{ sx: { bgcolor: 'background.default' } }}
    >
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{
          // Clear the iOS status bar / time the same way PageHeader does.
          pt: 'calc(env(safe-area-inset-top) + 8px)',
          px: 2,
          pb: 1
        }}
      >
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 800 }}>
            Hole {holeNumber ?? '—'} map
          </Typography>
          {hole && (
            <Typography variant="caption" color="text.secondary">
              Par {hole.par} · {shotEndPoints.length}{' '}
              {shotEndPoints.length === 1 ? 'tracked shot' : 'tracked shots'}
              {unmappedShots.length > 0
                ? ` · ${unmappedShots.length} untracked`
                : ''}
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          {/* Recap — replays the shots as a growing tee → landings → pin
              line with the numbered dots popping in one by one. Hidden in
              edit mode (drag + animation would fight) and when the hole has
              no GPS-tracked shots to replay. */}
          {!editMode && shotEndPoints.length > 0 && (
            <Button
              variant="outlined"
              size="small"
              startIcon={<PlayArrowRoundedIcon />}
              onClick={() => setRecapToken((t) => t + 1)}
              sx={{
                borderRadius: '5px',
                textTransform: 'none',
                minWidth: 64
              }}
            >
              Recap
            </Button>
          )}
          {/* Edit toggle — makes the numbered shot dots draggable so
              the user can correct mis-recorded positions, AND lets
              taps on the map assign positions to shots that don't
              have GPS yet. Shows whenever the hole has ANY shots
              (mapped or unmapped) so a hole with all-untracked shots
              still gets the tap-to-add affordance. */}
          {/* Add shot — only in edit mode. Toggles "tap the map to drop a new
              shot" for a stroke that was never logged. */}
          {editMode && (
            <Button
              variant={addingShot ? 'contained' : 'outlined'}
              size="small"
              color={addingShot ? 'success' : 'primary'}
              startIcon={<AddRoundedIcon />}
              onClick={() => setAddingShot((v) => !v)}
              sx={{
                borderRadius: '5px',
                textTransform: 'none',
                minWidth: 64
              }}
            >
              {addingShot ? 'Tap map' : 'Add shot'}
            </Button>
          )}
          {hole != null && (
            <Button
              variant={editMode ? 'contained' : 'outlined'}
              size="small"
              onClick={() => setEditMode((v) => !v)}
              sx={{
                borderRadius: '5px',
                textTransform: 'none',
                minWidth: 64
              }}
            >
              {editMode ? 'Done' : 'Edit'}
            </Button>
          )}
          <IconButton onClick={onClose} aria-label="close map">
            <CloseRoundedIcon />
          </IconButton>
        </Stack>
      </Stack>
      {editMode && (
        <Box sx={{ px: 2, pb: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            {addingShot ? (
              <>Tap the map to drop a new shot for this hole.</>
            ) : (
              <>
                Drag any numbered dot to move it.
                {unmappedShots.length > 0 && (
                  <> Tap the map to set the position for shot #
                    {unmappedShots[0].shot_number}
                    {unmappedShots.length > 1 ? ` (+${unmappedShots.length - 1} more)` : ''}.
                  </>
                )}{' '}
                Use <b>Add shot</b> to log a missed shot.
              </>
            )}
          </Typography>
        </Box>
      )}
      {/* Edit-mode shot list — reorder (up/down, left of the number) and delete
          right on the map. Add is via the header button (append); reorder moves
          a shot into position. Height-capped so the map stays visible. */}
      {editMode && allShotsForHole.length > 0 && (
        <Box sx={{ px: 2, pb: 1, maxHeight: '30vh', overflowY: 'auto' }}>
          <Stack spacing={0.5}>
            {allShotsForHole.map((s, i, arr) => {
              const club = s.club_id ? bag.find((c) => c.clubId === s.club_id) : null;
              const clubLabel = club ? club.customName || club.name : 'No club';
              const distLabel =
                s.distance != null
                  ? `${s.distance}${s.distance_unit === 'feet' ? 'ft' : 'y'}`
                  : '';
              const up = i > 0;
              const down = i < arr.length - 1;
              return (
                <Box
                  key={s.id}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: '22px 26px 1fr 24px',
                    alignItems: 'center',
                    columnGap: 0.75,
                    py: 0.25,
                    px: 0.5,
                    borderRadius: '5px',
                    bgcolor: 'action.hover'
                  }}
                >
                  <Box sx={{ display: 'flex', flexDirection: 'column' }}>
                    <Box
                      role="button"
                      aria-label={`Move shot ${s.shot_number} earlier`}
                      onClick={() => {
                        if (up) void moveShotOnMap(s, -1);
                      }}
                      sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        cursor: up ? 'pointer' : 'default',
                        opacity: up ? 0.7 : 0.2
                      }}
                    >
                      <KeyboardArrowUpRoundedIcon sx={{ fontSize: 16 }} />
                    </Box>
                    <Box
                      role="button"
                      aria-label={`Move shot ${s.shot_number} later`}
                      onClick={() => {
                        if (down) void moveShotOnMap(s, 1);
                      }}
                      sx={{
                        display: 'flex',
                        justifyContent: 'center',
                        cursor: down ? 'pointer' : 'default',
                        opacity: down ? 0.7 : 0.2
                      }}
                    >
                      <KeyboardArrowDownRoundedIcon sx={{ fontSize: 16 }} />
                    </Box>
                  </Box>
                  <Typography
                    variant="caption"
                    sx={{ fontWeight: 800, color: 'text.secondary' }}
                  >
                    #{s.shot_number}
                  </Typography>
                  <Typography variant="caption" noWrap sx={{ fontWeight: 600 }}>
                    {clubLabel}
                    {distLabel ? ` · ${distLabel}` : ''}
                  </Typography>
                  <Box
                    role="button"
                    aria-label={`Delete shot ${s.shot_number}`}
                    onClick={() => void deleteShotOnMap(s)}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      cursor: 'pointer',
                      color: 'error.main',
                      opacity: 0.8
                    }}
                  >
                    <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
                  </Box>
                </Box>
              );
            })}
          </Stack>
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0, px: 1, pb: 1 }}>
        {holeNumber != null && (
          <HoleLayoutCard
            courseId={courseId}
            holeNumber={holeNumber}
            par={hole?.par ?? null}
            shotEndPoints={shotEndPoints}
            shotLabels={shotLabels}
            bagClubs={bag}
            // Let the user pan + pinch-zoom to inspect / precisely place shots.
            // Dot-drag and tap-to-add are independent of this (gated on the
            // edit callbacks below), so both still work in Edit mode.
            interactive
            // Read-only view by default; opt into drag with the Edit
            // toggle above. hideAim keeps the aim handle / yardage
            // markers off so the map reads as visualization.
            hideAim
            onShotEndPointMoved={onShotEndPointMoved}
            // Edit-mode tap-to-add: assigns each tap to the next
            // unmapped shot in shot-number order. Disabled (undefined)
            // when not editing or when all shots already have GPS.
            onShotLanded={onShotLanded}
            // Shot replay — bumped by the Recap button above.
            recapToken={recapToken}
          />
        )}
      </Box>
    </Dialog>
  );
}

// Pretty-prints distance + unit; returns "—" when distance isn't set.
function formatShotDistance(
  distance: number | null,
  unit: string | null | undefined
): string {
  if (distance == null) return '—';
  const u = unit === 'feet' ? 'ft' : 'yds';
  return `${distance} ${u}`;
}

// Human label for the shot outcome combining target + result + lie. Keeps
// the result-driven phrasing front-of-mind (Hit fairway / Missed left)
// and only mentions the lie when it adds info (penalty / sand / fringe).
function formatShotOutcome(
  targetType: string | null,
  targetResult: string | null,
  lie: string | null
): string {
  // Putts use their own vocabulary — "Made", "Missed", or directional miss.
  if (targetType === 'putt') {
    if (targetResult === 'made') return 'Made putt';
    if (!targetResult) return 'Putt';
    return `Putt ${capitalize(targetResult)}`;
  }
  // Non-putts: hit/miss vs the target, with the lie tacked on if it's
  // something noteworthy.
  let outcome = '';
  if (targetResult === 'hit') {
    outcome = targetType === 'green' ? 'Green' : targetType === 'fairway' ? 'Fairway' : 'Hit';
  } else if (targetResult) {
    outcome = `Missed ${targetResult}`;
  }
  // Lie suffix: only call it out if it diverges from "the obvious"
  // (green/fairway for a hit shot — already implied above).
  const liesToCallOut: Record<string, string> = {
    rough: 'rough',
    bunker: 'bunker',
    fringe: 'fringe',
    penalty: 'penalty',
    green: 'green'
  };
  const lieLabel = lie ? liesToCallOut[lie] : null;
  if (lieLabel && lieLabel !== outcome.toLowerCase()) {
    outcome = outcome ? `${outcome} (${lieLabel})` : capitalize(lieLabel);
  }
  return outcome || '—';
}

function formatPenalty(penalty: string | null): string {
  if (!penalty) return '';
  const labels: Record<string, string> = {
    ob: 'OB',
    water: 'Water',
    lost_ball: 'Lost ball',
    unplayable: 'Unplayable',
    wrong_ball: 'Wrong ball',
    bunker: 'Bunker'
  };
  return labels[penalty] ?? penalty;
}

function capitalize(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s;
}

/**
 * Compact swing-metrics line for a shot the watch auto-detected (migration 031).
 * Returns '' when there's no motion data (manual/historical shots). RELATIVE
 * motion estimates — not launch-monitor numbers.
 */
function formatSwingSummary(
  swingType: string | null,
  metrics: import('@/models').RoundSwingMetrics | null
): string {
  if (!metrics) return '';
  const parts: string[] = [];
  if (swingType && swingType !== 'air') parts.push(capitalize(swingType));
  if (metrics.tempoRatio != null) parts.push(`Tempo ${metrics.tempoRatio.toFixed(1)}`);
  if (metrics.estimatedHandSpeed != null) parts.push(`Speed ${metrics.estimatedHandSpeed}`);
  return parts.join(' · ');
}

function fairwayDisplay(par: number, result: string | null): string {
  if (par < 4) return '—';
  if (result === 'hit') return '100%';
  if (result === 'left' || result === 'right' || result === 'short' || result === 'long') {
    return '0%';
  }
  return '—';
}

function DistributionRow({
  label,
  color,
  pct,
  count
}: {
  label: string;
  color: string;
  pct: number;
  count: number;
}) {
  return (
    <Stack direction="row" alignItems="center" spacing={1}>
      <Box
        sx={{
          width: 10,
          height: 10,
          borderRadius: '50%',
          bgcolor: color,
          flexShrink: 0
        }}
      />
      <Typography variant="body2" sx={{ width: 70, color: 'text.secondary' }}>
        {label}
      </Typography>
      <LinearProgress
        variant="determinate"
        value={pct}
        sx={{
          flex: 1,
          height: 6,
          borderRadius: '5px',
          bgcolor: 'rgba(255,255,255,0.08)',
          '& .MuiLinearProgress-bar': { bgcolor: color, borderRadius: '5px' }
        }}
      />
      <Typography
        variant="body2"
        sx={{ width: 36, textAlign: 'right', fontWeight: 700 }}
      >
        {count}
      </Typography>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ width: 46, textAlign: 'right' }}
      >
        {pct.toFixed(1)}%
      </Typography>
    </Stack>
  );
}

function HoleStatCard({
  icon,
  value,
  label
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
      <CardContent sx={{ py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Stack direction="row" alignItems="center" spacing={1.25}>
          <Box
            sx={{
              width: 32,
              height: 32,
              borderRadius: '50%',
              display: 'grid',
              placeItems: 'center',
              bgcolor: 'rgba(22,163,74,0.18)',
              color: '#16a34a'
            }}
          >
            {icon}
          </Box>
          <Box>
            <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1 }}>
              {value}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {label}
            </Typography>
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
}
