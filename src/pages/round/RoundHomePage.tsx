import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import GolfCourseRoundedIcon from '@mui/icons-material/GolfCourseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { useRoundStore } from '@/stores/roundStore';
import { scoreVsPar } from '@/utils/format';
import { computeTotalScore } from '@/features/round/computeRoundTotals';

export function RoundHomePage() {
  const active = useRoundStore((s) => s.active);
  const navigate = useNavigate();

  return (
    <Box>
      <PageHeader title="Round" subtitle="Start a new round or resume" />
      <Stack spacing={2} px={2} pb={3}>
        {active && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper', border: '1px solid', borderColor: 'primary.main' }}>
            <CardContent>
              <Typography
                variant="caption"
                color="primary"
                sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
              >
                Active Round
              </Typography>
              <Typography variant="h5" sx={{ mt: 0.5 }}>
                {active.courseName}
              </Typography>
              <Stack direction="row" spacing={3} mt={1}>
                <Stat label="Holes" value={`${active.holesPlayed}`} />
                <Stat label="Score" value={`${computeTotalScore(active.holes)}`} />
                <Stat label="vs Par" value={scoreVsPar(computeTotalScore(active.holes), active.totalPar)} />
              </Stack>
              <Button
                variant="contained"
                size="large"
                fullWidth
                startIcon={<PlayArrowRoundedIcon />}
                sx={{ mt: 2 }}
                onClick={() => navigate('/round/play')}
              >
                Resume Round
              </Button>
            </CardContent>
          </Card>
        )}

        <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
          <CardContent>
            <Stack alignItems="center" spacing={1.5} py={2}>
              <Box
                sx={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  display: 'grid',
                  placeItems: 'center'
                }}
              >
                <GolfCourseRoundedIcon sx={{ fontSize: 36 }} />
              </Box>
              <Typography variant="h6">{active ? 'Start another round' : 'Tee it up'}</Typography>
              <Typography variant="body2" color="text.secondary" align="center">
                Pick a course, your tee box and number of holes.
              </Typography>
              <Button
                variant="contained"
                size="large"
                fullWidth
                onClick={() => navigate('/round/start')}
                sx={{ mt: 1, minHeight: 60 }}
              >
                Start New Round
              </Button>
            </Stack>
          </CardContent>
        </Card>
      </Stack>
    </Box>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: 'uppercase', letterSpacing: 0.5, display: 'block' }}
      >
        {label}
      </Typography>
      <Typography variant="h6" sx={{ lineHeight: 1.1 }}>
        {value}
      </Typography>
    </Box>
  );
}
