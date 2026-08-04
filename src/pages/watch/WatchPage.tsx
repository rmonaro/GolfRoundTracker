import { useState } from 'react';
import { Box, Button, IconButton, Stack, Typography, Chip } from '@mui/material';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useNavigate } from 'react-router-dom';
import { useRoundStore } from '@/stores/roundStore';
import { useBagStore } from '@/stores/bagStore';
import { roundRepo } from '@/services/roundRepo';
import { newId } from '@/lib/ids';
import { computeCompletedTotals } from '@/features/round/computeRoundTotals';
import { scoreVsPar } from '@/utils/format';
import type { ClubCategory } from '@/models';

type Screen = 'home' | 'clubs';

const CATEGORY_TILES: Array<{ label: string; category: ClubCategory }> = [
  { label: 'Driver', category: 'driver' },
  { label: 'Wood', category: 'wood' },
  { label: 'Iron', category: 'iron' },
  { label: 'Wedge', category: 'wedge' },
  { label: 'Putter', category: 'putter' }
];

export function WatchPage() {
  const navigate = useNavigate();
  const active = useRoundStore((s) => s.active);
  const updateHole = useRoundStore((s) => s.updateHole);
  const setCurrentHole = useRoundStore((s) => s.setCurrentHole);
  const addShot = useRoundStore((s) => s.addShot);
  const bag = useBagStore((s) => s.clubs);
  const [screen, setScreen] = useState<Screen>('home');

  if (!active) {
    return (
      <WatchFrame>
        <Stack spacing={1} alignItems="center" justifyContent="center" sx={{ flex: 1, p: 2 }}>
          <Typography variant="body2" color="text.secondary" align="center">
            Start a round in the app to use the watch UI.
          </Typography>
          <Button onClick={() => navigate('/')} variant="text" size="small">
            Back to app
          </Button>
        </Stack>
      </WatchFrame>
    );
  }

  const idx = Math.max(0, Math.min(active.holes.length - 1, active.currentHoleIndex));
  const hole = active.holes[idx];
  // Running totals across completed holes only — matches the iOS watch
  // display ("--" until the first hole is finalized).
  const runningTotals = computeCompletedTotals(active);
  const scoreLabel =
    runningTotals.completedCount === 0
      ? '-- · --'
      : `${runningTotals.score} · ${scoreVsPar(runningTotals.score, runningTotals.par)}`;

  const onAddShotForCategory = async (category: ClubCategory) => {
    const club = bag.find((c) => c.category === category);
    const nextNum = hole.shots.length + 1;
    const shotId = newId();
    const isPutt = category === 'putter';
    const targetType = isPutt ? ('putt' as const) : ('green' as const);
    const targetResult = isPutt ? ('made' as const) : ('hit' as const);
    const shotResult = isPutt ? ('made_putt' as const) : ('green' as const);
    addShot(hole.holeNumber, {
      id: shotId,
      shotNumber: nextNum,
      clubId: club?.clubId ?? null,
      shotResult,
      targetType,
      targetResult,
      lie: 'green',
      penaltyType: null,
      distance: null,
      distanceUnit: null,
      notes: null,
      createdAt: new Date().toISOString()
    });
    updateHole(hole.holeNumber, { strokes: hole.strokes + 1 });
    setScreen('home');
    try {
      const holeId = useRoundStore.getState().active?.holes.find((h) => h.holeNumber === hole.holeNumber)?.holeId;
      if (!holeId) return;
      await roundRepo.addShot({
        id: shotId,
        round_id: active.roundId,
        hole_id: holeId,
        shot_number: nextNum,
        club_id: club?.clubId ?? null,
        shot_result: shotResult,
        target_type: targetType,
        target_result: targetResult,
        lie: 'green',
        penalty_type: null,
        distance: null,
        distance_unit: null,
        notes: null,
        start_lat: null,
        start_lng: null,
        end_lat: null,
        end_lng: null,
        calculated_distance: null
      });
      useRoundStore.getState().markShotSynced(hole.holeNumber, shotId);
    } catch (err) {
      console.error('[watch] shot save failed', err);
    }
  };

  return (
    <WatchFrame onClose={() => navigate('/')}>
      {screen === 'home' && (
        <Stack spacing={1.5} sx={{ p: 1.5, color: 'common.white' }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              Hole
            </Typography>
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              {scoreLabel}
            </Typography>
          </Stack>
          <Stack direction="row" justifyContent="space-between" alignItems="baseline">
            <Typography variant="h2" sx={{ fontWeight: 800, lineHeight: 1 }}>
              {hole.holeNumber}
            </Typography>
            <Stack alignItems="flex-end">
              <Chip label={`Par ${hole.par}`} size="small" sx={{ bgcolor: 'rgba(255,255,255,0.18)', color: 'inherit' }} />
              <Typography variant="caption" sx={{ opacity: 0.7, mt: 0.5 }}>
                {hole.yardage ?? 0} yds
              </Typography>
            </Stack>
          </Stack>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 0.75
            }}
          >
            <WatchButton label="Add Shot" onClick={() => setScreen('clubs')} primary />
            <WatchButton label="Next" onClick={() => setCurrentHole(idx + 1)} primary />
            <WatchButton label="+ Stroke" onClick={() => updateHole(hole.holeNumber, { strokes: hole.strokes + 1 })} />
            <WatchButton label="+ Putt" onClick={() => updateHole(hole.holeNumber, { putts: hole.putts + 1 })} />
          </Box>
        </Stack>
      )}

      {screen === 'clubs' && (
        <Stack spacing={0.75} sx={{ p: 1.5 }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="caption" sx={{ opacity: 0.7 }}>
              Pick a club
            </Typography>
            <Button size="small" onClick={() => setScreen('home')} sx={{ minHeight: 28, fontSize: 11 }}>
              Cancel
            </Button>
          </Stack>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr',
              gap: 0.75
            }}
          >
            {CATEGORY_TILES.map((t) => (
              <WatchButton key={t.category} label={t.label} primary onClick={() => onAddShotForCategory(t.category)} />
            ))}
          </Box>
        </Stack>
      )}
    </WatchFrame>
  );
}

function WatchFrame({ children, onClose }: { children: React.ReactNode; onClose?: () => void }) {
  return (
    <Box
      sx={{
        minHeight: '100dvh',
        display: 'grid',
        placeItems: 'center',
        bgcolor: 'background.default',
        p: 2
      }}
    >
      <Box
        sx={{
          width: 'min(280px, 90vw)',
          aspectRatio: '1 / 1.18',
          borderRadius: 12,
          bgcolor: '#000',
          color: 'common.white',
          boxShadow: '0 16px 60px rgba(0,0,0,0.5)',
          border: '6px solid #1a1a1a',
          position: 'relative',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {onClose && (
          <IconButton
            aria-label="close"
            size="small"
            onClick={onClose}
            sx={{
              position: 'absolute',
              top: 4,
              right: 4,
              color: 'rgba(255,255,255,0.6)',
              zIndex: 2
            }}
          >
            <CloseRoundedIcon fontSize="small" />
          </IconButton>
        )}
        {children}
      </Box>
    </Box>
  );
}

function WatchButton({
  label,
  onClick,
  primary = false
}: {
  label: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <Button
      variant="contained"
      onClick={onClick}
      sx={{
        bgcolor: primary ? 'primary.main' : 'rgba(255,255,255,0.12)',
        color: 'common.white',
        minHeight: 48,
        fontSize: 13,
        fontWeight: 700,
        borderRadius: 2,
        '&:hover': {
          bgcolor: primary ? 'primary.dark' : 'rgba(255,255,255,0.2)'
        }
      }}
    >
      {label}
    </Button>
  );
}
