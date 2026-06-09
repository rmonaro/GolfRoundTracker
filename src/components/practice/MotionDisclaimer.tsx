import { Chip, Stack } from '@mui/material';
import { MOTION_CHIPS } from '@/utils/swingLabels';

/**
 * Compliance chip row shown on every practice screen. Keeps the
 * "motion-based / estimated / not a launch monitor" framing front-and-centre
 * so the feature never reads as absolute ball/club measurement.
 */
export function MotionDisclaimer() {
  return (
    <Stack direction="row" spacing={0.75} useFlexGap flexWrap="wrap" sx={{ mt: 1 }}>
      {MOTION_CHIPS.map((label, i) => (
        <Chip
          key={label}
          size="small"
          label={label}
          variant={i === MOTION_CHIPS.length - 1 ? 'outlined' : 'filled'}
          color={i === 0 ? 'primary' : 'default'}
        />
      ))}
    </Stack>
  );
}
