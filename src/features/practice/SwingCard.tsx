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
import { SwingScoreGrid, SwingVitalsRow } from '@/components/swing/SwingMetricDisplay';
import { ShotResultPicker } from './ShotResultPicker';
import { FeedbackChips } from './FeedbackChips';
import { practiceController } from './practiceController';
import { useClubNameLookup } from './useClubName';

const SWING_TYPE_LABEL: Record<string, string> = {
  full: 'Full swing',
  pitch: 'Pitch',
  chip: 'Chip',
  putt: 'Putt',
  air: 'Rehearsal'
};

export function SwingCard({
  swing,
  feedback,
  editable = true,
  square = false
}: {
  swing: SwingMetric;
  feedback: SwingFeedback[];
  /** Live feed allows tagging a shot result; history view is read-only. */
  editable?: boolean;
  /** Square (0 radius) corners — used on the session overview. */
  square?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const clubNameOf = useClubNameLookup();

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: square ? 0 : 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Stack direction="row" alignItems="baseline" spacing={1}>
          <Typography variant="h5" fontWeight={800}>
            {swing.tempoRatio.toFixed(1)} : 1
          </Typography>
          <Typography variant="caption" color="text.secondary">
            tempo · estimated
          </Typography>
        </Stack>
        <Stack direction="row" spacing={0.5} alignItems="center">
          {swing.isAirSwing ? (
            <Chip size="small" variant="outlined" label="Rehearsal" />
          ) : (
            swing.swingType && (
              <Chip size="small" variant="outlined" label={SWING_TYPE_LABEL[swing.swingType]} />
            )
          )}
          <Chip size="small" color="primary" label={clubNameOf(swing.clubId)} />
          <Chip size="small" variant="outlined" label={`#${swing.swingIndex + 1}`} />
        </Stack>
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
        <Box sx={{ mt: 1 }}>
          <FeedbackChips items={feedback} />
        </Box>
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
        <SwingScoreGrid scores={swing} />
        <SwingVitalsRow
          estimatedHandSpeed={swing.estimatedHandSpeed}
          backswingRotation={swing.backswingRotation}
          heartRate={swing.heartRate}
        />
        {editable ? (
          <ShotResultPicker
            value={swing.shotResult}
            onChange={(r) => void practiceController.setShotResult(swing.id, r)}
          />
        ) : (
          swing.shotResult && (
            <Chip
              size="small"
              label={`Result: ${swing.shotResult}`}
              sx={{ textTransform: 'capitalize' }}
            />
          )
        )}
      </Collapse>
    </Paper>
  );
}
