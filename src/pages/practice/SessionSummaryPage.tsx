import { useMemo } from 'react';
import { Box, Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useSwingSessionStore } from '@/stores/swingSessionStore';
import { evaluateSession } from '@/services/swingFeedbackEngine';
import { MotionDisclaimer } from '@/components/practice/MotionDisclaimer';
import { practicePageSx } from './practicePageSx';
import { ClubGroups } from '@/features/practice/ClubGroups';
import { fmtPlane } from '@/utils/swingLabels';

const fatigueLabel: Record<string, string> = {
  none: 'No fatigue trend',
  possible: 'Possible fatigue',
  likely: 'Likely fatigue'
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, textAlign: 'center' }}>
      <Typography variant="h6" fontWeight={800}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Paper>
  );
}

export function SessionSummaryPage() {
  const navigate = useNavigate();
  const swings = useSwingSessionStore((s) => s.swings);
  const rollup = useSwingSessionStore((s) => s.rollup);
  const sessionFeedback = useSwingSessionStore((s) => s.sessionFeedback);
  const feedbackBySwing = useSwingSessionStore((s) => s.feedbackBySwing);
  const reset = useSwingSessionStore((s) => s.reset);

  // Live-computed fallback stats so the cards reflect the swings even if the
  // persisted rollup is missing (e.g. ended before all swings were ingested).
  const derived = useMemo(() => evaluateSession(swings).rollup, [swings]);

  const onDone = () => {
    reset();
    navigate('/');
  };

  if (swings.length === 0) {
    return (
      <Box sx={practicePageSx()}>
        <Typography variant="body2" color="text.secondary">
          No swings recorded in the last session.
        </Typography>
        <Button variant="contained" sx={{ mt: 2 }} onClick={onDone}>
          Done
        </Button>
      </Box>
    );
  }

  const levelColor = (level: string) =>
    level === 'positive' ? 'success' : level === 'attention' ? 'warning' : 'default';

  // Prefer the persisted rollup, but fall back to live computation from the
  // swings so the cards never show 0/— while swings are clearly present.
  const swingCount = rollup?.swingCount ?? swings.length;
  const avgTempo = rollup?.avgTempoRatio ?? derived.avgTempoRatio;
  const tempoConsistency = rollup?.tempoConsistencyScore ?? derived.tempoConsistencyScore;
  const planeConsistency = rollup?.planeConsistencyScore ?? derived.planeConsistencyScore;
  const fatigueTrend = rollup?.fatigueTrend ?? derived.fatigueTrend;

  return (
    <Box sx={practicePageSx()}>
      <Typography variant="h5" fontWeight={800}>
        Session Summary
      </Typography>
      <MotionDisclaimer />

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, 1fr)',
          gap: 1,
          mt: 2
        }}
      >
        <Stat label="Swings" value={String(swingCount)} />
        <Stat
          label="Avg tempo (est.)"
          value={avgTempo != null ? `${avgTempo.toFixed(1)} : 1` : '—'}
        />
        <Stat
          label="Tempo consistency"
          value={tempoConsistency != null ? `${tempoConsistency}/100` : '—'}
        />
        <Stat
          label="Pattern consistency"
          value={planeConsistency != null ? `${planeConsistency}/100` : '—'}
        />
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        {planeConsistency != null
          ? fmtPlane(planeConsistency)
          : 'Swing motion pattern consistency —'}
      </Typography>

      <Chip
        sx={{ mt: 1.5 }}
        size="small"
        color={fatigueTrend === 'none' ? 'default' : 'warning'}
        label={fatigueLabel[fatigueTrend]}
      />

      {sessionFeedback.length > 0 && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            Session feedback
          </Typography>
          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
            {sessionFeedback.map((f) => (
              <Chip key={f.code} size="small" color={levelColor(f.level)} label={f.message} />
            ))}
          </Stack>
        </>
      )}

      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
        By club
      </Typography>
      <ClubGroups swings={swings} getFeedback={(s) => feedbackBySwing[s.id] ?? []} />

      <Button
        variant="outlined"
        fullWidth
        sx={{ mt: 3 }}
        onClick={() => navigate('/practice/history')}
      >
        View past practices
      </Button>
      <Button variant="contained" fullWidth sx={{ mt: 1 }} onClick={onDone}>
        Done
      </Button>
    </Box>
  );
}
