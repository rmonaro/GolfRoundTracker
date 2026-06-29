import { useEffect, useState } from 'react';
import { Box, Button, IconButton, Stack, Typography } from '@mui/material';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import FlagCircleRoundedIcon from '@mui/icons-material/FlagCircleRounded';

interface PuttModePanelProps {
  holeNumber: number;
  /** Live feet from the player's current GPS to the (effective) pin. */
  liveFeetToPin: number | null;
  /** Putts already recorded on this hole. */
  puttsThisHole: number;
  /**
   * Record a putt. `made` holes out; `distanceFeet` is the (possibly tweaked)
   * distance to the flag captured at the stroke. Null when no GPS/pin is known.
   */
  onPutt: (made: boolean, distanceFeet: number | null) => void;
}

/**
 * On-green putting panel. The distance to the flag is read live from GPS →
 * pin, so the player just walks to their ball and the reading follows them.
 * Each tap of Missed / Made records a putt at the shown distance and the panel
 * stays up until the hole is made. A quick − / + lets the player correct the
 * reading (GPS is ~10 ft, so short putts can read high) before recording.
 */
export function PuttModePanel({
  holeNumber,
  liveFeetToPin,
  puttsThisHole,
  onPutt
}: PuttModePanelProps) {
  // Manual override of the captured distance. Null → track the live reading.
  const [override, setOverride] = useState<number | null>(null);

  // New hole → forget any manual override.
  useEffect(() => {
    setOverride(null);
  }, [holeNumber]);

  const displayed = override ?? liveFeetToPin;
  const nudge = (delta: number) =>
    setOverride((o) => Math.max(0, (o ?? liveFeetToPin ?? 0) + delta));

  const record = (made: boolean) => {
    onPutt(made, displayed);
    setOverride(null);
  };

  return (
    <Box
      sx={{
        position: 'absolute',
        bottom: 'calc(84px + env(safe-area-inset-bottom))',
        left: 16,
        right: 16,
        zIndex: 5,
        bgcolor: 'rgba(11,20,16,0.94)',
        border: '1.5px solid #fbbf24',
        borderRadius: '12px',
        boxShadow: '0 6px 20px rgba(0,0,0,0.5)',
        px: 1.75,
        py: 1.25
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between">
        <Typography
          variant="caption"
          sx={{
            color: '#fbbf24',
            fontWeight: 800,
            letterSpacing: 0.6,
            textTransform: 'uppercase',
            fontSize: '0.62rem'
          }}
        >
          {`Putting · Hole ${holeNumber}`}
        </Typography>
        <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)', fontWeight: 700 }}>
          {`Putts: ${puttsThisHole}`}
        </Typography>
      </Stack>

      {/* To-flag distance with quick − / + correction. */}
      <Stack direction="row" alignItems="center" justifyContent="center" spacing={1.5} sx={{ mt: 0.5 }}>
        <IconButton
          aria-label="decrease putt distance"
          size="small"
          onClick={() => nudge(-1)}
          sx={{ color: '#fbbf24', border: '1px solid rgba(251,191,36,0.5)' }}
        >
          <RemoveRoundedIcon fontSize="small" />
        </IconButton>
        <Box sx={{ textAlign: 'center', minWidth: 96 }}>
          <Typography sx={{ color: 'common.white', fontWeight: 900, fontSize: '1.6rem', lineHeight: 1 }}>
            {displayed != null ? `${displayed} ft` : '—'}
          </Typography>
          <Typography sx={{ color: 'rgba(255,255,255,0.6)', fontSize: '0.6rem', letterSpacing: 0.5 }}>
            TO FLAG
          </Typography>
        </Box>
        <IconButton
          aria-label="increase putt distance"
          size="small"
          onClick={() => nudge(1)}
          sx={{ color: '#fbbf24', border: '1px solid rgba(251,191,36,0.5)' }}
        >
          <AddRoundedIcon fontSize="small" />
        </IconButton>
      </Stack>

      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
        <Button
          fullWidth
          variant="outlined"
          onClick={() => record(false)}
          sx={{
            color: 'common.white',
            borderColor: 'rgba(255,255,255,0.4)',
            textTransform: 'none',
            fontWeight: 800,
            borderRadius: '8px',
            '&:hover': { borderColor: 'common.white' }
          }}
        >
          Missed
        </Button>
        <Button
          fullWidth
          variant="contained"
          startIcon={<FlagCircleRoundedIcon />}
          onClick={() => record(true)}
          sx={{
            bgcolor: '#2e7d32',
            color: 'common.white',
            textTransform: 'none',
            fontWeight: 800,
            borderRadius: '8px',
            '&:hover': { bgcolor: '#1b5e20' }
          }}
        >
          Made
        </Button>
      </Stack>
    </Box>
  );
}
