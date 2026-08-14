import { Box, Button, Stack, Typography } from '@mui/material';
import GolfCourseRoundedIcon from '@mui/icons-material/GolfCourseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { WASH_ROUND } from '@/theme/designTokens';

interface NextRoundHeroProps {
  eyebrow: string;
  /** Right-hand eyebrow, e.g. "14 Rounds Logged" or the active hole. */
  meta?: string;
  body: string;
  actionLabel: string;
  onAction: () => void;
}

/**
 * The green hero at the top of Home — what the player is here to do.
 *
 * Doubles as the resume surface: an active round swaps the copy and action
 * rather than adding a second card above it, so there is only ever one primary
 * thing to tap.
 */
export function NextRoundHero({
  eyebrow,
  meta,
  body,
  actionLabel,
  onAction
}: NextRoundHeroProps) {
  return (
    <Box
      sx={{
        background: WASH_ROUND,
        borderRadius: '5px',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.75
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1.5}>
        <Stack
          direction="row"
          alignItems="center"
          spacing={1}
          sx={{
            fontSize: '0.75rem',
            textTransform: 'uppercase',
            letterSpacing: '0.6px',
            color: 'text.primary',
            opacity: 0.85,
            minWidth: 0
          }}
        >
          <GolfCourseRoundedIcon sx={{ fontSize: 16 }} />
          <Box component="span" sx={{ minWidth: 0 }}>
            {eyebrow}
          </Box>
        </Stack>
        {meta && (
          <Typography
            sx={{
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.5px',
              color: 'text.primary',
              opacity: 0.7,
              flexShrink: 0
            }}
          >
            {meta}
          </Typography>
        )}
      </Stack>

      <Typography sx={{ fontSize: '0.95rem', color: 'text.primary', opacity: 0.85, maxWidth: '30ch' }}>
        {body}
      </Typography>

      <Button
        variant="contained"
        size="large"
        fullWidth
        onClick={onAction}
        startIcon={
          // The play glyph rides in its own dark disc rather than sitting bare
          // on the gradient — same treatment as the design's hero button.
          <Box
            sx={{
              display: 'grid',
              placeItems: 'center',
              width: 28,
              height: 28,
              borderRadius: '999px',
              bgcolor: 'rgba(11,15,26,0.16)'
            }}
          >
            <PlayArrowRoundedIcon sx={{ fontSize: 18 }} />
          </Box>
        }
        sx={{ minHeight: 72, fontSize: '1.15rem', fontWeight: 700, borderRadius: '5px' }}
      >
        {actionLabel}
      </Button>
    </Box>
  );
}
