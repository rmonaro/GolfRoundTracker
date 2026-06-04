import { Box, Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { useSwingSessionStore } from '@/stores/swingSessionStore';
import { MotionDisclaimer } from '@/components/practice/MotionDisclaimer';
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
  const reset = useSwingSessionStore((s) => s.reset);

  const onDone = () => {
    reset();
    navigate('/');
  };

  if (swings.length === 0) {
    return (
      <Box sx={{ p: 2, maxWidth: 520, mx: 'auto' }}>
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

  return (
    <Box sx={{ p: 2, maxWidth: 520, mx: 'auto' }}>
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
        <Stat label="Swings" value={String(rollup?.swingCount ?? swings.length)} />
        <Stat
          label="Avg tempo (est.)"
          value={rollup?.avgTempoRatio != null ? `${rollup.avgTempoRatio.toFixed(1)} : 1` : '—'}
        />
        <Stat
          label="Tempo consistency"
          value={
            rollup?.tempoConsistencyScore != null ? `${rollup.tempoConsistencyScore}/100` : '—'
          }
        />
        <Stat
          label="Pattern consistency"
          value={
            rollup?.planeConsistencyScore != null ? `${rollup.planeConsistencyScore}/100` : '—'
          }
        />
      </Box>

      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
        {rollup?.planeConsistencyScore != null
          ? fmtPlane(rollup.planeConsistencyScore)
          : 'Swing motion pattern consistency —'}
      </Typography>

      <Chip
        sx={{ mt: 1.5 }}
        size="small"
        color={rollup?.fatigueTrend === 'none' ? 'default' : 'warning'}
        label={fatigueLabel[rollup?.fatigueTrend ?? 'none']}
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
