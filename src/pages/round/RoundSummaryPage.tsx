import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
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
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import BarChartRoundedIcon from '@mui/icons-material/BarChartRounded';
import SportsGolfRoundedIcon from '@mui/icons-material/SportsGolfRounded';
import GpsFixedRoundedIcon from '@mui/icons-material/GpsFixedRounded';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import EmojiEventsRoundedIcon from '@mui/icons-material/EmojiEventsRounded';
import MapRoundedIcon from '@mui/icons-material/MapRounded';
import { HoleLayoutCard } from '@/features/course/HoleLayoutCard';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import dayjs from 'dayjs';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { useRoundDetails } from '@/features/stats/useRounds';
import { detailRoundStats } from '@/features/stats/computeStats';
import { calculateDifferential, isAbsurdDifferential } from '@/utils/handicap';
import { roundRepo } from '@/services/roundRepo';
import { useRoundStore } from '@/stores/roundStore';
import { useBagStore } from '@/stores/bagStore';
import { useAuthStore } from '@/stores/authStore';
import { toAppError } from '@/services/errors';
import { pct, scoreVsPar, durationLabel, fullName } from '@/utils/format';
import { Scorecard } from '@/components/Scorecard';
import { AddShotSheet, type ShotEditDraft } from '@/features/round/AddShotSheet';
import {
  STROKE_PENALTY_TYPES,
  type Round,
  type RoundHole,
  type BagClub,
  type DistanceUnit,
  type Lie,
  type PenaltyType,
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
}

export function RoundSummaryPage() {
  const { roundId } = useParams<{ roundId: string }>();
  const navigate = useNavigate();
  const detail = useRoundDetails(roundId);
  const reset = useRoundStore((s) => s.reset);
  const bag = useBagStore((s) => s.clubs);
  const profile = useAuthStore((s) => s.profile);
  const [editOpen, setEditOpen] = useState(false);
  const [tab, setTab] = useState<'overview' | 'holes' | 'game'>('overview');

  useEffect(() => {
    if (!detail.data?.round) return;
    const { round, holes, shots } = detail.data;
    if (round.completed_at) {
      // Compute differential from the shots list (source of truth)
      // per hole, NOT the cached round_holes.strokes column — that
      // column can lag by a shot or two if the autosave debounce
      // was clipped at round-finalize.
      const score = holes.reduce((s, h) => {
        const liveStrokes = shots.filter((sh) => sh.hole_id === h.id).length;
        return s + liveStrokes + h.penalty_strokes;
      }, 0);
      const computed = calculateDifferential(score, round.course_rating, round.slope_rating);
      const stored = round.handicap_differential;
      const storedIsAbsurd = isAbsurdDifferential(stored);

      // Self-heal cases:
      //   1) Nothing stored → persist a fresh computed value.
      //   2) Stored value is out of the USGA-reasonable range (e.g.
      //      -226 from an earlier bug) → overwrite with the fresh
      //      computed value, or clear to null when even the fresh
      //      compute can't produce a sane number.
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
  }, [detail.data, reset]);

  if (!roundId) return <Navigate to="/round" replace />;

  if (detail.isLoading || !detail.data) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '60dvh' }}>
        <CircularProgress />
      </Box>
    );
  }

  const { round, holes: rawHoles, shots } = detail.data;

  // Live-derive per-hole strokes / putts / penalty_strokes from the shot
  // list rather than trusting the round_holes.strokes column. The column
  // is a debounced cache written by the live tracking page; if a shot
  // landed close to round-finalization (or via the watch outside the
  // debounce window), the cache can be off by one or more. Shots are the
  // source of truth — every shot row is durable.
  const holes = rawHoles.map((h) => {
    const holeShots = shots.filter((s) => s.hole_id === h.id);
    const liveStrokes = holeShots.length;
    const livePutts = holeShots.filter((s) => {
      if (!s.club_id) return false;
      const c = bag.find((b) => b.clubId === s.club_id);
      return c?.category === 'putter';
    }).length;
    const livePenalty = holeShots.filter(
      (s) =>
        s.penalty_type != null &&
        (STROKE_PENALTY_TYPES as readonly string[]).includes(s.penalty_type)
    ).length;
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
        back="/round"
      />

      {/* Tab nav — Overview (existing content) / Holes (per-hole detail) /
          Game Stats (placeholder). Sits between the header and the page
          body so the rest of the page can swap in place. */}
      <Box sx={{ px: 2, mt: 1 }}>
        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v)}
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
          ...(existing ? { id: existing.id } : {}),
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
  bag
}: {
  roundId: string;
  courseId: string | null;
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
  /** Currently-open map dialog (which hole's map to show). null = closed. */
  const [mapHoleNumber, setMapHoleNumber] = useState<number | null>(null);

  const onConfirmDelete = async () => {
    if (!deletingShot) return;
    try {
      await roundRepo.deleteShot(deletingShot.id);
      queryClient.invalidateQueries({ queryKey: ['round-detail', roundId] });
    } catch (err) {
      console.error('[summary] shot delete failed', err);
    }
    setDeletingShot(null);
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
        calculated_distance: payload.calculatedDistance
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
          return (
            <Box
              key={h.hole_number}
              onClick={() => setSelectedHoleNumber(h.hole_number)}
              role="button"
              sx={{
                minWidth: 64,
                px: 1,
                py: 0.75,
                borderRadius: '5px',
                bgcolor: isSelected ? 'rgba(22,163,74,0.22)' : 'background.paper',
                border: 1,
                borderColor: isSelected ? '#16a34a' : 'divider',
                textAlign: 'center',
                cursor: 'pointer',
                flexShrink: 0
              }}
            >
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
      <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
        <CardContent>
          <Stack direction="row" alignItems="center" spacing={1} mb={1}>
            <FlagRoundedIcon fontSize="small" color="primary" />
            <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
              Shots
            </Typography>
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
                {list.map((s) => {
                  const clubLabel = s.club_id ? nameForClubId(s.club_id) : 'No club';
                  const dist = formatShotDistance(s.distance, s.distance_unit);
                  const outcome = formatShotOutcome(s.target_type, s.target_result, s.lie);
                  const penalty = formatPenalty(s.penalty_type);
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
                        // 5 columns: shot#, body, distance, edit icon,
                        // delete icon. Edit + delete are visible
                        // affordances; the row's body still triggers
                        // edit-on-tap. The trash icon has its own
                        // click handler with stopPropagation so it
                        // doesn't bubble to the row click.
                        gridTemplateColumns: '32px 1fr auto 24px 24px',
                        alignItems: 'center',
                        columnGap: 1,
                        rowGap: 0.25,
                        py: 0.75,
                        px: 0.5,
                        borderBottom: 1,
                        borderColor: 'divider',
                        borderRadius: '5px',
                        cursor: 'pointer',
                        '&:hover': {
                          bgcolor: 'rgba(255,255,255,0.04)',
                          '& .shot-edit-icon': { opacity: 1 }
                        },
                        '&:active': { bgcolor: 'rgba(255,255,255,0.06)' },
                        '&:last-of-type': { borderBottom: 'none' }
                      }}
                    >
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
                      </Box>
                      <Typography
                        variant="body2"
                        sx={{ fontWeight: 700, textAlign: 'right' }}
                      >
                        {dist}
                      </Typography>
                      <EditRoundedIcon
                        className="shot-edit-icon"
                        sx={{
                          fontSize: 18,
                          color: 'text.secondary',
                          // 60% opacity baseline so the affordance is
                          // visible at a glance on phone (no hover) but
                          // not loud enough to compete with the shot
                          // content. Lifts to full on hover.
                          opacity: 0.6,
                          transition: 'opacity 120ms ease'
                        }}
                      />
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
                    </Box>
                  );
                })}
              </Stack>
            );
          })()}
        </CardContent>
      </Card>

      <AddShotSheet
        open={editingShot !== null}
        shotNumber={editingShot?.shot_number ?? 1}
        editing={editingDraft}
        holePar={editingHolePar}
        bagClubs={bag}
        onClose={() => setEditingShot(null)}
        onSubmit={onSubmitEdit}
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

  /// In edit mode, tapping the map assigns the position to the next
  /// shot that's missing GPS coords (shot-number order). Lets the
  /// player retro-populate shots they logged without tapping a
  /// landing point. Each tap consumes one shot from `unmappedShots`;
  /// once empty the callback is undefined (no-op tap).
  const onShotLanded = useMemo(() => {
    if (!editMode || unmappedShots.length === 0) return undefined;
    return async (data: {
      start: [number, number];
      end: [number, number];
      calculatedDistanceM: number;
    }) => {
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
  }, [editMode, unmappedShots, queryClient, roundId]);

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
          {(orderedShots.length > 0 || unmappedShots.length > 0) && (
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
            Drag any numbered dot to move it.
            {unmappedShots.length > 0 && (
              <> Tap anywhere on the map to set the position for shot #
                {unmappedShots[0].shot_number}
                {unmappedShots.length > 1 ? ` (+${unmappedShots.length - 1} more)` : ''}.
              </>
            )}
          </Typography>
        </Box>
      )}
      <Box sx={{ flex: 1, minHeight: 0, px: 1, pb: 1 }}>
        {holeNumber != null && (
          <HoleLayoutCard
            courseId={courseId}
            holeNumber={holeNumber}
            par={hole?.par ?? null}
            shotEndPoints={shotEndPoints}
            bagClubs={bag}
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
