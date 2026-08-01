// Per-shot swing detail for a ROUND shot, shown under the shot row on the
// round summary's Holes tab.
//
// The watch runs the SAME motion detector during a round as it does in practice
// (`RoundShotController` → `SwingMotionService`), so an auto-tracked shot
// carries the full metric bundle in `shots.swing_metrics` (migration 031). This
// renders it with the same score grid / vitals / feedback chips practice uses
// (`SwingCard`), differing only in that every field here is optional — manual
// shots have no swing data, and older watch builds omit individual fields.

import { Box, Chip, Divider, Stack, Typography } from '@mui/material';
import type { RoundSwingMetrics, SwingTypeValue } from '@/models';
import { SwingScoreGrid, SwingVitalsRow } from '@/components/swing/SwingMetricDisplay';
import { FeedbackChips } from '@/features/practice/FeedbackChips';
import { evaluateSwingMetrics } from '@/services/swingFeedbackEngine';
import { SWING_DISCLAIMER } from '@/utils/swingLabels';

const SWING_TYPE_LABEL: Record<string, string> = {
  full: 'Full swing',
  pitch: 'Pitch',
  chip: 'Chip',
  putt: 'Putt',
  air: 'Rehearsal'
};

/**
 * True when there's at least one metric this panel actually RENDERS. Checked
 * field-by-field rather than "any non-null value" on purpose: `planeAxis` and
 * `addressGravity` are raw vectors nothing displays, so a bundle carrying only
 * those would otherwise offer an expander that opens to just the disclaimer.
 */
const DISPLAYED_FIELDS = [
  'tempoRatio',
  'backswingTimeMs',
  'downswingTimeMs',
  'transitionScore',
  'finishStabilityScore',
  'wristRotationScore',
  'releaseTimingScore',
  'decelerationScore',
  'transitionDirectionScore',
  'estimatedHandSpeed',
  'backswingRotation',
  'heartRate'
] as const satisfies readonly (keyof RoundSwingMetrics)[];

export function hasSwingDetail(metrics: RoundSwingMetrics | null | undefined): boolean {
  if (!metrics) return false;
  return DISPLAYED_FIELDS.some((k) => metrics[k] != null);
}

export function RoundSwingDetail({
  swingType,
  metrics
}: {
  swingType: SwingTypeValue | string | null;
  metrics: RoundSwingMetrics;
}) {
  // Feedback rules tolerate missing inputs — a shot with only tempo still gets
  // its tempo verdict, and nothing else fires.
  const feedback = evaluateSwingMetrics(metrics);
  const typeLabel = swingType ? SWING_TYPE_LABEL[swingType] ?? swingType : null;

  return (
    <Box sx={{ mt: 0.75, pb: 0.5 }}>
      <Divider sx={{ mb: 1 }} />

      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
        <Stack direction="row" alignItems="baseline" spacing={1}>
          {metrics.tempoRatio != null ? (
            <>
              <Typography variant="h6" fontWeight={800}>
                {metrics.tempoRatio.toFixed(1)} : 1
              </Typography>
              <Typography variant="caption" color="text.secondary">
                tempo · estimated
              </Typography>
            </>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Swing detail
            </Typography>
          )}
        </Stack>
        {typeLabel && <Chip size="small" variant="outlined" label={typeLabel} />}
      </Stack>

      {(metrics.backswingTimeMs != null || metrics.downswingTimeMs != null) && (
        <Stack direction="row" spacing={2} sx={{ mb: 1 }}>
          {metrics.backswingTimeMs != null && (
            <Typography variant="caption" color="text.secondary">
              Back {metrics.backswingTimeMs} ms
            </Typography>
          )}
          {metrics.downswingTimeMs != null && (
            <Typography variant="caption" color="text.secondary">
              Down {metrics.downswingTimeMs} ms
            </Typography>
          )}
        </Stack>
      )}

      {feedback.length > 0 && (
        <Box sx={{ mb: 1 }}>
          <FeedbackChips items={feedback} />
        </Box>
      )}

      <SwingScoreGrid scores={metrics} />

      <SwingVitalsRow
        estimatedHandSpeed={metrics.estimatedHandSpeed}
        backswingRotation={metrics.backswingRotation}
        heartRate={metrics.heartRate}
      />

      <Typography variant="caption" color="text.disabled">
        {SWING_DISCLAIMER}
      </Typography>
    </Box>
  );
}
