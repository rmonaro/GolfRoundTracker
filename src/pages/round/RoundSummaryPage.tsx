import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  CircularProgress,
  Stack,
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
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { useRoundDetails } from '@/features/stats/useRounds';
import { detailRoundStats } from '@/features/stats/computeStats';
import { calculateDifferential } from '@/utils/handicap';
import { roundRepo } from '@/services/roundRepo';
import { useRoundStore } from '@/stores/roundStore';
import { useBagStore } from '@/stores/bagStore';
import { useAuthStore } from '@/stores/authStore';
import { toAppError } from '@/services/errors';
import { pct, scoreVsPar, durationLabel } from '@/utils/format';
import type { Round, RoundHole } from '@/models';

export function RoundSummaryPage() {
  const { roundId } = useParams<{ roundId: string }>();
  const navigate = useNavigate();
  const detail = useRoundDetails(roundId);
  const reset = useRoundStore((s) => s.reset);
  const bag = useBagStore((s) => s.clubs);
  const [editOpen, setEditOpen] = useState(false);

  useEffect(() => {
    if (!detail.data?.round) return;
    const { round, holes } = detail.data;
    if (round.completed_at) {
      // Compute differential once and persist if missing.
      // strokes already counts every logged shot (incl. putts); add penalty strokes on top.
      const score = holes.reduce((s, h) => s + h.strokes + h.penalty_strokes, 0);
      const diff = calculateDifferential(score, round.course_rating, round.slope_rating);
      if (diff != null && round.handicap_differential == null) {
        roundRepo.update(round.id, { handicap_differential: diff }).catch((err) => {
          console.error('[summary] could not persist differential', err);
        });
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

  const { round, holes, shots } = detail.data;
  const stats = detailRoundStats(round, holes, shots);
  const front = holes.filter((h) => h.hole_number <= 9);
  const back = holes.filter((h) => h.hole_number > 9);
  const frontTotal = front.reduce((s, h) => s + h.strokes + h.penalty_strokes, 0);
  const frontPar = front.reduce((s, h) => s + h.par, 0);
  const backTotal = back.reduce((s, h) => s + h.strokes + h.penalty_strokes, 0);
  const backPar = back.reduce((s, h) => s + h.par, 0);

  return (
    <Box
      sx={{
        // 20px below the iOS status bar / device top (the route renders
        // outside MobileShell, so the page has to handle safe-area-inset
        // itself). PageHeader contributes its own 16px (pt: 2); the
        // remaining 4px comes from this wrapper.
        pt: 'calc(env(safe-area-inset-top) + 4px)'
      }}
    >
      <PageHeader title="Round Summary" subtitle={round.course_name} back="/round" />
      <Stack spacing={2} px={2} pb={4}>
        <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
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

        <ScoreCard
          holes={holes}
          frontTotal={frontTotal}
          frontPar={frontPar}
          backTotal={backTotal}
          backPar={backPar}
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
          <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
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
    <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
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
