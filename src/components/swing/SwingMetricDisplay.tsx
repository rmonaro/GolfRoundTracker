// Shared presentation for motion-derived swing metrics.
//
// Both practice swings (`swing_metrics` rows, every score required) and round
// shots (`shots.swing_metrics` jsonb, every score optional — older watch builds
// omit fields) render the same way, so the score grid + vitals row live here
// rather than being duplicated per surface. Everything takes optional values and
// omits what's missing.
//
// All values are RELATIVE / MOTION-BASED estimates — never launch-monitor
// measurements. Heart rate is the exception: a real HealthKit sensor reading.

import { Box, Stack, Typography } from '@mui/material';
import { fmtHandSpeed } from '@/utils/swingLabels';

/** Wrist rotation amount (radians) → relative length category. */
export function backswingLengthLabel(rotationRad: number): string {
  if (rotationRad < 1.6) return 'Short';
  if (rotationRad > 2.6) return 'Long';
  return 'Normal';
}

export function ScorePill({ label, value }: { label: string; value: number }) {
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

/** The 0-100 relative quality scores the watch derives from wrist motion. */
export interface SwingScores {
  transitionScore?: number | null;
  finishStabilityScore?: number | null;
  wristRotationScore?: number | null;
  swingConsistencyScore?: number | null;
  releaseTimingScore?: number | null;
  decelerationScore?: number | null;
  transitionDirectionScore?: number | null;
}

/**
 * Grid of score pills. Renders nothing when no score is present at all (a shot
 * recorded manually, or by a watch build predating these metrics).
 */
export function SwingScoreGrid({ scores }: { scores: SwingScores }) {
  const pills: Array<[string, number]> = [];
  const push = (label: string, v: number | null | undefined) => {
    if (v != null) pills.push([label, v]);
  };
  push('Transition', scores.transitionScore);
  push('Finish', scores.finishStabilityScore);
  push('Wrist', scores.wristRotationScore);
  push('Consistency', scores.swingConsistencyScore);
  push('Release', scores.releaseTimingScore);
  push('Thru impact', scores.decelerationScore);
  push('Direction', scores.transitionDirectionScore);

  if (pills.length === 0) return null;

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: 'repeat(4, 1fr)',
        gap: 1,
        mb: 1.5
      }}
    >
      {pills.map(([label, value]) => (
        <ScorePill key={label} label={label} value={value} />
      ))}
    </Box>
  );
}

/**
 * Secondary readouts — estimated effort, relative backswing length, and the one
 * genuinely measured value, heart rate.
 */
export function SwingVitalsRow({
  estimatedHandSpeed,
  backswingRotation,
  heartRate,
  sx
}: {
  estimatedHandSpeed?: number | null;
  backswingRotation?: number | null;
  heartRate?: number | null;
  sx?: object;
}) {
  if (estimatedHandSpeed == null && backswingRotation == null && heartRate == null) {
    return null;
  }
  return (
    <Stack direction="row" spacing={2} sx={{ mb: 1, ...sx }} flexWrap="wrap" useFlexGap>
      {estimatedHandSpeed != null && (
        <Typography variant="caption" color="text.secondary">
          {fmtHandSpeed(estimatedHandSpeed)}
        </Typography>
      )}
      {backswingRotation != null && (
        <Typography variant="caption" color="text.secondary">
          Backswing length: {backswingLengthLabel(backswingRotation)}
        </Typography>
      )}
      {heartRate != null && (
        <Typography variant="caption" color="error">
          ♥ {heartRate} bpm
        </Typography>
      )}
    </Stack>
  );
}
