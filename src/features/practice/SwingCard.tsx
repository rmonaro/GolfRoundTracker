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

/** Wrist rotation amount (radians) → relative length category. */
function backswingLengthLabel(rotationRad: number): string {
  if (rotationRad < 1.6) return 'Short';
  if (rotationRad > 2.6) return 'Long';
  return 'Normal';
}

function ScorePill({ label, value }: { label: string; value: number }) {
  return (
    <Stack alignItems="center" sx={{ minWidth: 64 }}>
      <Typography fontWeight={700} sx={{ fontSize: '1.25rem', lineHeight: 1.1 }}>
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
          {swing.releaseTimingScore != null && (
            <ScorePill label="Release" value={swing.releaseTimingScore} />
          )}
          {swing.decelerationScore != null && (
            <ScorePill label="Thru impact" value={swing.decelerationScore} />
          )}
          {swing.transitionDirectionScore != null && (
            <ScorePill label="Direction" value={swing.transitionDirectionScore} />
          )}
        </Box>
        <Stack direction="row" spacing={2} sx={{ mb: 1 }} flexWrap="wrap" useFlexGap>
          <Typography variant="caption" color="text.secondary">
            {fmtHandSpeed(swing.estimatedHandSpeed)}
          </Typography>
          {swing.backswingRotation != null && (
            <Typography variant="caption" color="text.secondary">
              Backswing length: {backswingLengthLabel(swing.backswingRotation)}
            </Typography>
          )}
          {swing.heartRate != null && (
            <Typography variant="caption" color="error">
              ♥ {swing.heartRate} bpm
            </Typography>
          )}
        </Stack>
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
