import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import MyLocationRoundedIcon from '@mui/icons-material/MyLocationRounded';
import GolfCourseRoundedIcon from '@mui/icons-material/GolfCourseRounded';
import TouchAppRoundedIcon from '@mui/icons-material/TouchAppRounded';
import AdjustRoundedIcon from '@mui/icons-material/AdjustRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import FlagRoundedIcon from '@mui/icons-material/FlagRounded';
import { watchName } from '@/utils/platform';
import { practicePageSx } from '../practice/practicePageSx';

interface Step {
  icon: React.ReactNode;
  title: string;
  body: React.ReactNode;
}

// Per-club dot colors shown on the map (kept in sync with rangeStats.clubColor).
const CLUB_LEGEND: Array<{ label: string; color: string }> = [
  { label: 'Driver', color: '#f88930' },
  { label: '3 Wood', color: '#ffce5c' },
  { label: '5 Iron', color: '#34d27b' },
  { label: '7 Iron', color: '#4cc8f0' },
  { label: '9 Iron', color: '#8b9bff' },
  { label: 'PW', color: '#ff7a8a' }
];

const STEPS: Step[] = [
  {
    icon: <MyLocationRoundedIcon />,
    title: '1. Set up at your mat',
    body: (
      <>
        When the range opens it captures your <strong>mat position</strong> once via GPS and frames
        the satellite map looking down the range. The mat sits at the bottom and yardage arcs fan out
        in front of you up to 350 yds.
      </>
    )
  },
  {
    icon: <GolfCourseRoundedIcon />,
    title: '2. Pick your club',
    body: (
      <>
        Tap the <strong>club circle</strong> (bottom-left) to choose the club you're hitting. Each
        club gets its own dot color on the map, so you can see your dispersion club-by-club. Switch
        clubs any time — shots stay grouped by club.
      </>
    )
  },
  {
    icon: <TouchAppRoundedIcon />,
    title: '3. Log where the ball landed',
    body: (
      <>
        After each shot, tap the spot on the map where the ball came down. It records the{' '}
        <strong>carry</strong> (distance down the line) and how far <strong>left or right</strong> of
        your aim it finished. The first tap starts the session automatically.
      </>
    )
  },
  {
    icon: <AdjustRoundedIcon />,
    title: '4. Aim at a target',
    body: (
      <>
        Open <strong>Targets</strong> (right side) and draw a <strong>circle</strong> or freeform{' '}
        <strong>shape</strong> around a green or flag. Select it to aim there — the aim line points at
        it and every result is measured against the <strong>whole shape</strong>: a shot inside it is{' '}
        <em>On target</em>, otherwise it's tagged <em>short</em>, <em>long</em>, <em>left</em>, or{' '}
        <em>right</em> of that target. Targets are saved and reappear next time you practice at the
        same range.
      </>
    )
  },
  {
    icon: <InsightsRoundedIcon />,
    title: '5. Read your stats',
    body: (
      <>
        The cards on the right show your <strong>shot count</strong>, the <strong>yardage</strong> of
        your last shot, and live <strong>tempo &amp; consistency</strong> from your {watchName()}{' '}
        (when connected). The card at the bottom summarizes the current club's average carry and
        dispersion — tap it to see, and delete, every shot.
      </>
    )
  },
  {
    icon: <FlagRoundedIcon />,
    title: '6. End the session',
    body: (
      <>
        Tap <strong>End</strong> (top-right) when you're done. You'll get a summary with your per-club
        carry and dispersion, and the session is saved to your practice history.
      </>
    )
  }
];

export function RangeGuidePage() {
  const navigate = useNavigate();

  return (
    <Box sx={practicePageSx(560)}>
      <Typography component="h1" sx={{ fontWeight: 900, fontSize: '32px', lineHeight: 1.1 }}>
        How the range works
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
        GPS Range turns any driving range into a tracked practice session — log every shot by club,
        aim at targets you draw, and see your real dispersion on a satellite map.
      </Typography>

      <Stack spacing={1.5} sx={{ mt: 2.5 }}>
        {STEPS.map((step) => (
          <Card key={step.title} variant="outlined" sx={{ borderRadius: '5px' }}>
            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
              <Stack direction="row" spacing={1.5} alignItems="flex-start">
                <Box
                  sx={{
                    flexShrink: 0,
                    width: 40,
                    height: 40,
                    borderRadius: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'primary.main',
                    bgcolor: (theme) => alpha(theme.palette.primary.main, 0.12)
                  }}
                >
                  {step.icon}
                </Box>
                <Box>
                  <Typography fontWeight={800} sx={{ mb: 0.25 }}>
                    {step.title}
                  </Typography>
                  <Typography variant="body2" color="text.secondary">
                    {step.body}
                  </Typography>
                </Box>
              </Stack>
            </CardContent>
          </Card>
        ))}

        {/* Club color legend — matches the dots on the map. */}
        <Card variant="outlined" sx={{ borderRadius: '5px' }}>
          <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
            <Typography fontWeight={800} sx={{ mb: 1 }}>
              Shot dot colors
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, 1fr)',
                rowGap: 1,
                columnGap: 2
              }}
            >
              {CLUB_LEGEND.map((c) => (
                <Stack key={c.label} direction="row" spacing={1} alignItems="center">
                  <Box sx={{ width: 12, height: 12, borderRadius: '50%', bgcolor: c.color }} />
                  <Typography variant="body2" color="text.secondary">
                    {c.label}
                  </Typography>
                </Stack>
              ))}
            </Box>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
              Other clubs get their own distinct color automatically.
            </Typography>
          </CardContent>
        </Card>
      </Stack>

      <Button variant="contained" fullWidth sx={{ mt: 3 }} onClick={() => navigate(-1)}>
        Got it
      </Button>
    </Box>
  );
}
