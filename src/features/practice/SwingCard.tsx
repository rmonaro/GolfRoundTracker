import { useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Collapse,
  Divider,
  Paper,
  Stack,
  Typography
} from '@mui/material';
import type { SwingFeedback, SwingMetric } from '@/types/swing';
import { fmtHandSpeed } from '@/utils/swingLabels';
import { ShotResultPicker } from './ShotResultPicker';
import { practiceController } from './practiceController';

const levelColor = (level: SwingFeedback['level']) =>
  level === 'positive' ? 'success' : level === 'attention' ? 'warning' : 'default';

function ScorePill({ label, value }: { label: string; value: number }) {
  return (
    <Stack alignItems="center" sx={{ minWidth: 64 }}>
      <Typography variant="subtitle2" fontWeight={700}>
        {Math.round(value)}
      </Typography>
      <Typography variant="caption" color="text.secondary" align="center">
        {label}
      </Typography>
    </Stack>
  );
}

export function SwingCard({
  swing,
  feedback
}: {
  swing: SwingMetric;
  feedback: SwingFeedback[];
}) {
  const [open, setOpen] = useState(false);

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Stack direction="row" alignItems="baseline" spacing={1}>
          <Typography variant="h5" fontWeight={800}>
            {swing.tempoRatio.toFixed(1)} : 1
          </Typography>
          <Typography variant="caption" color="text.secondary">
            tempo · estimated
          </Typography>
        </Stack>
        <Chip size="small" label={`#${swing.swingIndex + 1}`} />
      </Stack>

      <Stack direction="row" spacing={2} sx={{ mt: 1 }}>
        <Typography variant="caption" color="text.secondary">
          Back {swing.backswingTimeMs} ms
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Down {swing.downswingTimeMs} ms
        </Typography>
      </Stack>

      {feedback.length > 0 && (
        <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
          {feedback.map((f) => (
            <Chip key={f.code} size="small" color={levelColor(f.level)} label={f.message} />
          ))}
        </Stack>
      )}

      <Button
        size="small"
        onClick={() => setOpen((v) => !v)}
        sx={{ mt: 1, px: 0, minWidth: 0 }}
      >
        {open ? 'Hide details' : 'Details & result'}
      </Button>

      <Collapse in={open} unmountOnExit>
        <Divider sx={{ my: 1 }} />
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 1,
            mb: 1.5
          }}
        >
          <ScorePill label="Transition" value={swing.transitionScore} />
          <ScorePill label="Finish" value={swing.finishStabilityScore} />
          <ScorePill label="Wrist" value={swing.wristRotationScore} />
          {swing.swingConsistencyScore != null && (
            <ScorePill label="Consistency" value={swing.swingConsistencyScore} />
          )}
        </Box>
        <Typography variant="caption" color="text.secondary" display="block" sx={{ mb: 1 }}>
          {fmtHandSpeed(swing.estimatedHandSpeed)}
        </Typography>
        <ShotResultPicker
          value={swing.shotResult}
          onChange={(r) => void practiceController.setShotResult(swing.id, r)}
        />
      </Collapse>
    </Paper>
  );
}
