import { Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import type { SwingShotResult } from '@/types/swing';

const RESULTS: SwingShotResult[] = [
  'straight',
  'left',
  'right',
  'short',
  'long',
  'thin',
  'fat',
  'toe',
  'heel',
  'bunker',
  'rough',
  'fairway',
  'green'
];

/**
 * Optional manual shot-result entry for a swing. Not required — the motion
 * metrics stand alone; this just lets the user tag where the ball went so the
 * (future) AI coach has more context.
 */
export function ShotResultPicker({
  value,
  onChange
}: {
  value?: SwingShotResult | null;
  onChange: (r: SwingShotResult) => void;
}) {
  return (
    <Stack spacing={0.5}>
      <Typography variant="caption" color="text.secondary">
        Shot result (optional)
      </Typography>
      <ToggleButtonGroup
        exclusive
        size="small"
        value={value ?? null}
        onChange={(_, v) => {
          if (v) onChange(v as SwingShotResult);
        }}
        sx={{ flexWrap: 'wrap', gap: 0.5 }}
      >
        {RESULTS.map((r) => (
          <ToggleButton key={r} value={r} sx={{ textTransform: 'capitalize', px: 1.25, py: 0.25 }}>
            {r}
          </ToggleButton>
        ))}
      </ToggleButtonGroup>
    </Stack>
  );
}
