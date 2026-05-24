import { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import ArrowBackIosNewRoundedIcon from '@mui/icons-material/ArrowBackIosNewRounded';
import ArrowForwardIosRoundedIcon from '@mui/icons-material/ArrowForwardIosRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import FlagCircleRoundedIcon from '@mui/icons-material/FlagCircleRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import SportsGolfRoundedIcon from '@mui/icons-material/SportsGolfRounded';
import { useNavigate, Navigate } from 'react-router-dom';
import { useRoundStore, type LocalHole, type LocalShot } from '@/stores/roundStore';
import { useBagStore } from '@/stores/bagStore';
import { useAutosaveHole } from '@/features/round/useAutosaveHole';
import { AddShotSheet, RESULT_LABELS, type ShotEditDraft } from '@/features/round/AddShotSheet';
import { PENALTY_LABELS } from '@/features/round/ShotSelectors';
import { HoleLayoutCard } from '@/features/course/HoleLayoutCard';
import { computeTotalScore } from '@/features/round/computeRoundTotals';
import { roundRepo } from '@/services/roundRepo';
import { scoreVsPar } from '@/utils/format';
import {
  STROKE_PENALTY_TYPES,
  type BagClub,
  type FairwayResult,
  type PenaltyType
} from '@/models';

export function HoleTrackingPage() {
  const active = useRoundStore((s) => s.active);
  const updateHole = useRoundStore((s) => s.updateHole);
  const setCurrentHole = useRoundStore((s) => s.setCurrentHole);
  const addShotLocal = useRoundStore((s) => s.addShot);
  const updateShotLocal = useRoundStore((s) => s.updateShot);
  const removeShotLocal = useRoundStore((s) => s.removeShot);
  const markShotSynced = useRoundStore((s) => s.markShotSynced);
  const bagClubs = useBagStore((s) => s.clubs);
  const navigate = useNavigate();
  const [shotSheet, setShotSheet] = useState(false);
  const [editingShot, setEditingShot] = useState<LocalShot | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  if (!active) return <Navigate to="/round" replace />;

  const idx = Math.max(0, Math.min(active.holes.length - 1, active.currentHoleIndex));
  const hole = active.holes[idx];

  // Derived values — everything reads off the shot list now.
  //   strokes        = total shots logged
  //   putts          = shots whose club category is putter
  //   penaltyStrokes = shots tagged with a stroke-adding penalty (excludes Bunker)
  //   fairwayResult  = shot 1's fairway target outcome on par 4/5 (else 'na')
  //   sand           = any shot landed in / from a bunker
  //   gir            = (strokes - putts) <= (par - 2), i.e. on green in regulation
  const strokes = hole.shots.length;
  const putts = hole.shots.filter((s) => isPutterShot(s, bagClubs)).length;
  const penaltyStrokes = hole.shots.filter((s) => isStrokePenalty(s.penaltyType)).length;
  const fairwayResult = deriveFairwayResult(hole);
  const sand = hole.shots.some((s) => s.lie === 'bunker' || s.penaltyType === 'bunker');
  const gir = strokes > 0 && (strokes - putts) <= Math.max(1, hole.par - 2);

  const holeScore = strokes + penaltyStrokes;
  const totalScore = computeTotalScore(active.holes);
  const isLast = idx === active.holes.length - 1;

  // Push derived values back into the local hole so autosave persists them.
  // Without this, the round_holes columns would stay stale because the user
  // never edits them directly anymore — everything flows from the shot list.
  useEffect(() => {
    if (
      hole.strokes !== strokes ||
      hole.putts !== putts ||
      hole.penaltyStrokes !== penaltyStrokes ||
      hole.fairwayResult !== fairwayResult ||
      hole.sand !== sand ||
      hole.gir !== gir
    ) {
      updateHole(hole.holeNumber, {
        strokes,
        putts,
        penaltyStrokes,
        fairwayResult,
        sand,
        gir
      });
    }
  }, [
    strokes,
    putts,
    penaltyStrokes,
    fairwayResult,
    sand,
    gir,
    hole.strokes,
    hole.putts,
    hole.penaltyStrokes,
    hole.fairwayResult,
    hole.sand,
    hole.gir,
    hole.holeNumber,
    updateHole
  ]);

  useAutosaveHole(hole.holeNumber);

  const onSubmitShot = async ({
    clubId,
    distance,
    distanceUnit,
    targetType,
    targetResult,
    lie,
    penaltyType,
    derivedShotResult,
    notes
  }: {
    clubId: string | null;
    clubCategory: import('@/models').ClubCategory | null;
    distance: number | null;
    distanceUnit: import('@/models').DistanceUnit | null;
    targetType: import('@/models').TargetType;
    targetResult: import('@/models').TargetResult;
    lie: import('@/models').Lie | null;
    penaltyType: PenaltyType | null;
    derivedShotResult: import('@/models').ShotResult;
    notes: string | null;
  }) => {
    if (editingShot) {
      // EDIT path — update the existing shot in place.
      updateShotLocal(hole.holeNumber, editingShot.tempId, {
        clubId,
        shotResult: derivedShotResult,
        targetType,
        targetResult,
        lie,
        penaltyType,
        distance,
        distanceUnit,
        notes
      });
      setShotSheet(false);
      setEditingShot(null);

      if (editingShot.remoteId) {
        try {
          await roundRepo.updateShot(editingShot.remoteId, {
            club_id: clubId,
            shot_result: derivedShotResult,
            target_type: targetType,
            target_result: targetResult,
            lie,
            penalty_type: penaltyType,
            distance,
            distance_unit: distanceUnit,
            notes
          });
        } catch (err) {
          console.error('[shot] edit save failed', err);
        }
      }
      return;
    }

    // ADD path
    const nextNum = (hole.shots.length ?? 0) + 1;
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    addShotLocal(hole.holeNumber, {
      tempId,
      shotNumber: nextNum,
      clubId,
      shotResult: derivedShotResult,
      targetType,
      targetResult,
      lie,
      penaltyType,
      distance,
      distanceUnit,
      notes,
      createdAt: new Date().toISOString()
    });
    setShotSheet(false);

    try {
      // Ensure the hole row exists so we have a holeId to point the shot at.
      if (!hole.holeId) {
        const saved = await roundRepo.upsertHole({
          round_id: active.roundId,
          hole_number: hole.holeNumber,
          par: hole.par,
          yardage: hole.yardage,
          strokes: nextNum,
          putts,
          penalty_strokes: hole.penaltyStrokes,
          fairway_result: hole.fairwayResult,
          sand: hole.sand,
          gir: hole.gir,
          clubs_used: hole.clubsUsed
        });
        useRoundStore.getState().applyHoleIds([saved]);
      }
      const holeId = useRoundStore
        .getState()
        .active?.holes.find((h) => h.holeNumber === hole.holeNumber)?.holeId;
      if (!holeId) return;

      const persisted = await roundRepo.addShot({
        round_id: active.roundId,
        hole_id: holeId,
        shot_number: nextNum,
        club_id: clubId,
        shot_result: derivedShotResult,
        target_type: targetType,
        target_result: targetResult,
        lie,
        penalty_type: penaltyType,
        distance,
        distance_unit: distanceUnit,
        notes,
        // V2 GPS — left null until the GPS flow ships
        start_lat: null,
        start_lng: null,
        end_lat: null,
        end_lng: null,
        calculated_distance: null
      });
      markShotSynced(hole.holeNumber, tempId, persisted.id);
    } catch (err) {
      console.error('[shot] save failed', err);
    }
  };

  const onDeleteShot = async (shot: LocalShot) => {
    removeShotLocal(hole.holeNumber, shot.tempId);
    if (shot.remoteId) {
      try {
        await roundRepo.deleteShot(shot.remoteId);
      } catch (err) {
        console.error('[shot] delete failed', err);
      }
    }
  };

  const goPrev = () => setCurrentHole(Math.max(0, idx - 1));
  const goNext = () => setCurrentHole(Math.min(active.holes.length - 1, idx + 1));

  const finishRound = async () => {
    const score = computeTotalScore(active.holes);
    try {
      await roundRepo.update(active.roundId, {
        score,
        score_vs_par: score - active.totalPar,
        completed_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('[round] finish failed', err);
    }
    navigate(`/round/summary/${active.roundId}`, { replace: true });
  };

  return (
    <Box sx={{ minHeight: '100dvh', bgcolor: 'background.default' }}>
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          bgcolor: 'background.default',
          pt: 'env(safe-area-inset-top)',
          borderBottom: 1,
          borderColor: 'divider'
        }}
      >
        <Stack direction="row" alignItems="center" px={1.5} py={1} spacing={1}>
          <IconButton aria-label="exit" onClick={() => navigate('/round')}>
            <CloseRoundedIcon />
          </IconButton>
          <Box sx={{ flex: 1, textAlign: 'center' }}>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
              {active.courseName}
            </Typography>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.1 }}>
              Total {totalScore} · {scoreVsPar(totalScore, active.totalPar)}
            </Typography>
          </Box>
          <IconButton aria-label="finish" color="primary" onClick={finishRound}>
            <FlagCircleRoundedIcon />
          </IconButton>
        </Stack>
      </Box>

      <Box sx={{ px: 2, pb: 12, pt: 2 }}>
        <HoleHeader
          hole={hole}
          holeScore={holeScore}
          idx={idx}
          total={active.holes.length}
          onPrev={goPrev}
          onNext={goNext}
          onOpenDetails={() => setDetailsOpen(true)}
        />

        <Stack spacing={2} mt={2}>
          {/* Top-down hole layout (Phase 5). Renders nothing when courseId is null or the
              course has no OSM coverage; otherwise shows the SVG or a clean fallback. */}
          <Box sx={{ maxHeight: { xs: '30vh', sm: '40vh' } }}>
            <HoleLayoutCard
              courseId={active.courseId}
              holeNumber={hole.holeNumber}
              par={hole.par}
              yardage={hole.yardage}
              compact
            />
          </Box>

          {/* Derived score snapshot — all values come from the shot list. */}
          <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
            <CardContent>
              <Stack direction="row" alignItems="center" justifyContent="space-between">
                <DerivedStat label="Shots" value={strokes} />
                <DerivedStat label="Putts" value={putts} />
                <DerivedStat label="Penalty" value={penaltyStrokes} />
                <DerivedStat label="Hole" value={holeScore} accent />
              </Stack>
            </CardContent>
          </Card>

          {/* SHOTS — timeline + add button */}
          <ShotsCard
            shots={hole.shots}
            bagClubs={bagClubs}
            onAdd={() => {
              setEditingShot(null);
              setShotSheet(true);
            }}
            onEdit={(shot) => {
              setEditingShot(shot);
              setShotSheet(true);
            }}
            onDelete={onDeleteShot}
          />
        </Stack>
      </Box>

      <Box
        sx={{
          position: 'fixed',
          left: 0,
          right: 0,
          bottom: 0,
          p: 1.5,
          pb: 'calc(env(safe-area-inset-bottom) + 12px)',
          background: 'linear-gradient(to top, rgba(11,20,16,0.95) 60%, transparent)',
          display: 'flex',
          gap: 1,
          zIndex: 6
        }}
      >
        <Button
          variant="outlined"
          size="large"
          startIcon={<ArrowBackIosNewRoundedIcon />}
          onClick={goPrev}
          disabled={idx === 0}
          sx={{ minHeight: 56, flex: 1 }}
        >
          Prev
        </Button>
        {isLast ? (
          <Button
            variant="contained"
            color="primary"
            size="large"
            onClick={finishRound}
            sx={{ minHeight: 56, flex: 2 }}
          >
            Finish Round
          </Button>
        ) : (
          <Button
            variant="contained"
            size="large"
            endIcon={<ArrowForwardIosRoundedIcon />}
            onClick={goNext}
            sx={{ minHeight: 56, flex: 2 }}
          >
            Next Hole
          </Button>
        )}
      </Box>

      <AddShotSheet
        open={shotSheet}
        shotNumber={editingShot ? editingShot.shotNumber : hole.shots.length + 1}
        editing={
          editingShot
            ? ({
                clubId: editingShot.clubId,
                distance: editingShot.distance,
                distanceUnit: editingShot.distanceUnit,
                targetType: editingShot.targetType,
                targetResult: editingShot.targetResult,
                lie: editingShot.lie,
                penaltyType: editingShot.penaltyType,
                notes: editingShot.notes
              } satisfies ShotEditDraft)
            : null
        }
        holePar={hole.par}
        bagClubs={bagClubs}
        onClose={() => {
          setShotSheet(false);
          setEditingShot(null);
        }}
        onSubmit={onSubmitShot}
      />

      <HoleDetailsDialog
        open={detailsOpen}
        par={hole.par}
        yardage={hole.yardage}
        onClose={() => setDetailsOpen(false)}
        onSubmit={({ par, yardage }) => {
          updateHole(hole.holeNumber, { par, yardage });
          setDetailsOpen(false);
        }}
      />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

interface HoleHeaderProps {
  hole: LocalHole;
  holeScore: number;
  idx: number;
  total: number;
  onPrev: () => void;
  onNext: () => void;
  onOpenDetails: () => void;
}

function HoleHeader({ hole, holeScore, idx, total, onPrev, onNext, onOpenDetails }: HoleHeaderProps) {
  return (
    <Card
      elevation={0}
      sx={{
        background: 'linear-gradient(135deg, rgba(46,125,50,0.5), rgba(76,175,80,0.3))',
        color: 'common.white',
        position: 'relative'
      }}
    >
      <CardContent sx={{ py: 2.5 }}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <IconButton aria-label="prev" onClick={onPrev} disabled={idx === 0} sx={{ color: 'inherit' }}>
            <ArrowBackIosNewRoundedIcon />
          </IconButton>
          <Box sx={{ textAlign: 'center' }}>
            <Typography variant="body2" sx={{ opacity: 0.8 }}>
              Hole {idx + 1} of {total}
            </Typography>
            <Typography variant="h2" sx={{ fontWeight: 800, lineHeight: 1, my: 0.5 }}>
              {hole.holeNumber}
            </Typography>
            <Stack direction="row" spacing={1} justifyContent="center" mt={0.5}>
              <Chip
                label={`Par ${hole.par}`}
                size="small"
                onClick={onOpenDetails}
                clickable
                sx={{
                  bgcolor: 'rgba(255,255,255,0.18)',
                  color: 'inherit',
                  fontWeight: 600,
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.28)' }
                }}
              />
              <Chip
                label={`${hole.yardage ?? 0} yds`}
                size="small"
                onClick={onOpenDetails}
                clickable
                sx={{
                  bgcolor: 'rgba(255,255,255,0.18)',
                  color: 'inherit',
                  fontWeight: 600,
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'rgba(255,255,255,0.28)' }
                }}
              />
              <Chip
                label={`Score ${holeScore}`}
                size="small"
                sx={{ bgcolor: 'rgba(255,255,255,0.28)', color: 'inherit', fontWeight: 700 }}
              />
            </Stack>
            <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mt: 0.75 }}>
              Tap par or yards to edit
            </Typography>
          </Box>
          <IconButton aria-label="next" onClick={onNext} disabled={idx === total - 1} sx={{ color: 'inherit' }}>
            <ArrowForwardIosRoundedIcon />
          </IconButton>
        </Stack>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Shots card + timeline
// ---------------------------------------------------------------------------

interface ShotsCardProps {
  shots: LocalShot[];
  bagClubs: BagClub[];
  onAdd: () => void;
  onEdit: (shot: LocalShot) => void;
  onDelete: (shot: LocalShot) => void;
}

function ShotsCard({ shots, bagClubs, onAdd, onEdit, onDelete }: ShotsCardProps) {
  return (
    <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={shots.length ? 2 : 0}>
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
            >
              Shots
            </Typography>
            <Typography variant="h6">{shots.length} logged</Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<AddRoundedIcon />}
            size="large"
            onClick={onAdd}
            sx={{ minHeight: 48 }}
          >
            Add Shot
          </Button>
        </Stack>

        {shots.length === 0 ? (
          <Stack
            alignItems="center"
            sx={{
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 2,
              py: 3,
              mt: 2
            }}
          >
            <SportsGolfRoundedIcon sx={{ color: 'text.secondary', fontSize: 32 }} />
            <Typography variant="body2" color="text.secondary" mt={1}>
              Tap "Add Shot" to log each swing.
            </Typography>
          </Stack>
        ) : (
          <Box sx={{ position: 'relative' }}>
            <Stack spacing={1.25}>
              {shots
                .slice()
                .sort((a, b) => a.shotNumber - b.shotNumber)
                .map((shot) => (
                  <ShotRow
                    key={shot.tempId}
                    shot={shot}
                    bagClubs={bagClubs}
                    onEdit={() => onEdit(shot)}
                    onDelete={() => onDelete(shot)}
                  />
                ))}
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function ShotRow({
  shot,
  bagClubs,
  onEdit,
  onDelete
}: {
  shot: LocalShot;
  bagClubs: BagClub[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const club = bagClubs.find((c) => c.clubId === shot.clubId);
  const clubLabel = club ? club.customName || club.name : 'Club';
  const distanceLabel =
    shot.distance != null
      ? `${shot.distance} ${shot.distanceUnit === 'feet' ? 'ft' : 'yds'}`
      : null;
  const resultLabel = describeShotOutcome(shot) ?? RESULT_LABELS[shot.shotResult];
  const lieLabel = shot.lie && !lieMatchesResult(shot)
    ? `→ ${capitalize(shot.lie)}`
    : null;
  const penaltyLabel = shot.penaltyType ? PENALTY_LABELS[shot.penaltyType] : null;

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      onClick={onEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit();
        }
      }}
      sx={{
        bgcolor: 'action.hover',
        borderRadius: 2,
        px: 1.25,
        py: 1,
        cursor: 'pointer',
        transition: 'background-color 120ms',
        '&:hover': { bgcolor: 'action.selected' },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: 2
        }
      }}
    >
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 800,
          fontSize: 14,
          flexShrink: 0
        }}
      >
        {shot.shotNumber}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
          {clubLabel}
          {distanceLabel && (
            <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500, ml: 0.75 }}>
              · {distanceLabel}
            </Box>
          )}
          <Box component="span" sx={{ color: 'primary.light', fontWeight: 600, ml: 0.75 }}>
            · {resultLabel}
          </Box>
          {lieLabel && (
            <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500, ml: 0.75 }}>
              {lieLabel}
            </Box>
          )}
          {penaltyLabel && (
            <Box
              component="span"
              sx={{
                color: 'warning.main',
                fontWeight: 700,
                ml: 0.75,
                fontSize: '0.8rem',
                textTransform: 'uppercase',
                letterSpacing: 0.4
              }}
            >
              · {penaltyLabel}
            </Box>
          )}
        </Typography>
        {shot.notes && (
          <Typography variant="caption" color="text.secondary" noWrap>
            {shot.notes}
          </Typography>
        )}
      </Box>
      <IconButton
        size="small"
        aria-label="delete shot"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        color="error"
      >
        <DeleteOutlineRoundedIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Derived stats row
// ---------------------------------------------------------------------------

function DerivedStat({
  label,
  value,
  accent = false
}: {
  label: string;
  value: number;
  accent?: boolean;
}) {
  return (
    <Box sx={{ textAlign: 'center', flex: 1 }}>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: 'uppercase', letterSpacing: 0.6, display: 'block' }}
      >
        {label}
      </Typography>
      <Typography
        variant={accent ? 'h4' : 'h5'}
        sx={{
          fontWeight: 800,
          lineHeight: 1.1,
          color: accent ? 'primary.main' : 'text.primary'
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Hole details dialog
// ---------------------------------------------------------------------------

interface HoleDetailsDialogProps {
  open: boolean;
  par: number;
  yardage: number | null;
  onClose: () => void;
  onSubmit: (values: { par: number; yardage: number | null }) => void;
}

function HoleDetailsDialog({ open, par, yardage, onClose, onSubmit }: HoleDetailsDialogProps) {
  const [parValue, setParValue] = useState<number>(par);
  const [yardsValue, setYardsValue] = useState<string>(yardage != null ? String(yardage) : '');

  useEffect(() => {
    if (!open) return;
    setParValue(par);
    setYardsValue(yardage != null ? String(yardage) : '');
  }, [open, par, yardage]);

  const yardsTrimmed = yardsValue.trim();
  const yardsNum = yardsTrimmed === '' ? null : Number(yardsTrimmed);
  const yardsValid = yardsNum == null || (Number.isFinite(yardsNum) && yardsNum >= 0 && yardsNum <= 999);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Hole details</DialogTitle>
      <DialogContent>
        <Stack spacing={3} mt={1}>
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.6, display: 'block', mb: 1 }}
            >
              Par
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
              {[3, 4, 5].map((n) => {
                const active = parValue === n;
                return (
                  <Button
                    key={n}
                    onClick={() => setParValue(n)}
                    variant={active ? 'contained' : 'outlined'}
                    sx={{
                      minHeight: 72,
                      fontSize: '1.75rem',
                      fontWeight: 800,
                      borderRadius: 2
                    }}
                  >
                    {n}
                  </Button>
                );
              })}
            </Box>
          </Box>
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.6, display: 'block', mb: 1 }}
            >
              Yardage
            </Typography>
            <TextField
              value={yardsValue}
              onChange={(e) => setYardsValue(e.target.value)}
              placeholder="385"
              type="number"
              autoFocus
              inputProps={{ inputMode: 'numeric', min: 0, max: 999, step: 5 }}
              error={!yardsValid}
              helperText={!yardsValid ? 'Enter a value between 0 and 999.' : ' '}
              InputProps={{
                endAdornment: <InputAdornment position="end">yds</InputAdornment>
              }}
            />
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!yardsValid}
          onClick={() =>
            onSubmit({
              par: parValue,
              yardage: yardsNum
            })
          }
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPutterShot(shot: LocalShot, bagClubs: BagClub[]): boolean {
  if (!shot.clubId) return false;
  const club = bagClubs.find((c) => c.clubId === shot.clubId);
  return club?.category === 'putter';
}

/** True for penalty types that ADD a stroke (OB, Water, Lost Ball, Unplayable, Wrong Ball). */
function isStrokePenalty(penaltyType: PenaltyType | null | undefined): boolean {
  if (!penaltyType) return false;
  return (STROKE_PENALTY_TYPES as readonly string[]).includes(penaltyType);
}

/**
 * Derive the legacy fairway_result enum value from the first shot of the hole.
 * Par 3 holes don't have a fairway → always 'na'.
 * If the user hasn't taken the tee shot yet, return null.
 */
function deriveFairwayResult(hole: LocalHole): FairwayResult | null {
  if (hole.par === 3) return 'na';
  const tee = hole.shots.find((s) => s.shotNumber === 1);
  if (!tee) return null;
  if (tee.targetType !== 'fairway') return null;
  switch (tee.targetResult) {
    case 'hit':
      return 'hit';
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'short':
      return 'short';
    case 'long':
      return 'long';
    default:
      return null;
  }
}

/** Human-readable outcome built from target_type + target_result. Falls back to RESULT_LABELS. */
function describeShotOutcome(shot: LocalShot): string | null {
  if (!shot.targetType || !shot.targetResult) return null;
  if (shot.targetType === 'putt') {
    if (shot.targetResult === 'made') return 'Made';
    return `Missed ${capitalize(shot.targetResult)}`;
  }
  if (shot.targetType === 'green') {
    return shot.targetResult === 'hit' ? 'Hit Green' : capitalize(shot.targetResult);
  }
  // fairway
  return shot.targetResult === 'hit' ? 'Fairway' : capitalize(shot.targetResult);
}

/** Skip showing the lie chip when it's the obvious consequence of hitting the target. */
function lieMatchesResult(shot: LocalShot): boolean {
  if (!shot.lie || !shot.targetResult) return false;
  if (shot.targetResult === 'hit' && shot.targetType === 'green' && shot.lie === 'green') return true;
  if (shot.targetResult === 'hit' && shot.targetType === 'fairway' && shot.lie === 'fairway') return true;
  if (shot.targetResult === 'made' && shot.lie === 'green') return true;
  return false;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
