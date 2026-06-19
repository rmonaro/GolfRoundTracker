import { useState } from 'react';
import { Box, Button, Stack, Typography } from '@mui/material';
import type { SxProps, Theme } from '@mui/material';

interface TourStep {
  title: string;
  body: string;
  /** Positioned ring over the relevant control (omitted = no highlight). */
  highlight?: SxProps<Theme>;
  /** Where the explanation card sits, to avoid covering the highlight. */
  card: 'top' | 'bottom' | 'center';
}

// Highlight regions are positioned to match the real controls on RangeSessionPage.
const STEPS: TourStep[] = [
  {
    title: 'Welcome to GPS Range',
    body: 'A quick tour of how to track your shots. You can skip and replay this anytime from the “?” button.',
    card: 'center'
  },
  {
    title: 'Aim down your range',
    body: 'Drag the orange marker to point the aim line straight down your range. The map turns to match, and your carry and left/right are measured along this line.',
    highlight: { top: '46%', left: '50%', transform: 'translate(-50%, -50%)', width: 92, height: 92, borderRadius: '50%' },
    card: 'bottom'
  },
  {
    title: 'Lock your direction',
    body: 'Happy with the aim? Tap “Lock aim direction.” We remember it for this range, so next time the line points the right way automatically.',
    highlight: {
      top: 'calc(env(safe-area-inset-top) + 50px)',
      left: '50%',
      transform: 'translateX(-50%)',
      width: 210,
      height: 46,
      borderRadius: '10px'
    },
    card: 'bottom'
  },
  {
    title: 'Pick your club',
    body: 'Tap the club circle to choose what you’re hitting. Each club gets its own dot color, so you can see dispersion club-by-club.',
    highlight: {
      bottom: 'calc(env(safe-area-inset-bottom) + 8px)',
      left: 8,
      width: 76,
      height: 78,
      borderRadius: '20px'
    },
    card: 'top'
  },
  {
    title: 'Log where it landed',
    body: 'After each shot, tap the spot on the map where your ball came down. The first tap starts the session — a club must be selected first.',
    highlight: { top: '40%', left: '50%', transform: 'translate(-50%, -50%)', width: 150, height: 150, borderRadius: '50%' },
    card: 'top'
  },
  {
    title: 'Targets & live stats',
    body: 'Draw targets around greens to score proximity, and watch your shot count, last yardage, and live tempo & consistency on the right.',
    highlight: {
      top: '50%',
      right: 4,
      transform: 'translateY(-50%)',
      width: 106,
      height: 300,
      borderRadius: '10px'
    },
    card: 'bottom'
  },
  {
    title: 'End & review',
    body: 'Tap End when you’re done for a per-club summary, saved to your practice history.',
    highlight: {
      top: 'calc(env(safe-area-inset-top) + 4px)',
      right: 4,
      width: 92,
      height: 46,
      borderRadius: '10px'
    },
    card: 'bottom'
  }
];

export function RangeTour({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [i, setI] = useState(0);

  if (!open) return null;
  const step = STEPS[i];
  const isLast = i === STEPS.length - 1;

  const cardSx: SxProps<Theme> =
    step.card === 'top'
      ? { top: 'calc(env(safe-area-inset-top) + 72px)', left: 16, right: 16 }
      : step.card === 'bottom'
        ? { bottom: 'calc(env(safe-area-inset-bottom) + 24px)', left: 16, right: 16 }
        : { top: '50%', left: 16, right: 16, transform: 'translateY(-50%)' };

  const finish = () => {
    setI(0);
    onClose();
  };

  return (
    <Box sx={{ position: 'fixed', inset: 0, zIndex: 2000 }}>
      {/* Dim backdrop — captures taps so the map isn't touched during the tour. */}
      <Box sx={{ position: 'absolute', inset: 0, bgcolor: 'rgba(0,0,0,0.66)' }} onClick={() => undefined} />

      {/* Spotlight ring on the relevant control. */}
      {step.highlight && (
        <Box
          sx={{
            position: 'absolute',
            border: '2px solid',
            borderColor: 'primary.main',
            boxShadow: '0 0 0 3px rgba(248,137,48,0.35), 0 0 22px rgba(248,137,48,0.6)',
            pointerEvents: 'none',
            ...step.highlight
          }}
        />
      )}

      {/* Explanation card. */}
      <Box
        sx={{
          position: 'absolute',
          bgcolor: 'background.paper',
          color: 'text.primary',
          borderRadius: '12px',
          p: 2,
          boxShadow: 8,
          ...cardSx
        }}
      >
        <Typography sx={{ fontWeight: 800, fontSize: '1.1rem', mb: 0.5 }}>{step.title}</Typography>
        <Typography variant="body2" color="text.secondary">
          {step.body}
        </Typography>

        {/* Progress dots. */}
        <Stack direction="row" spacing={0.75} sx={{ mt: 1.5, justifyContent: 'center' }}>
          {STEPS.map((_, idx) => (
            <Box
              key={idx}
              sx={{
                width: 7,
                height: 7,
                borderRadius: '50%',
                bgcolor: idx === i ? 'primary.main' : 'action.disabled'
              }}
            />
          ))}
        </Stack>

        <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mt: 1.5 }}>
          <Button size="small" color="inherit" onClick={finish} sx={{ textTransform: 'none' }}>
            Skip
          </Button>
          <Stack direction="row" spacing={1}>
            {i > 0 && (
              <Button size="small" onClick={() => setI((v) => v - 1)} sx={{ textTransform: 'none' }}>
                Back
              </Button>
            )}
            <Button
              size="small"
              variant="contained"
              onClick={() => (isLast ? finish() : setI((v) => v + 1))}
              sx={{ borderRadius: '5px' }}
            >
              {isLast ? 'Got it' : 'Next'}
            </Button>
          </Stack>
        </Stack>
      </Box>
    </Box>
  );
}
