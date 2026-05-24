import { Box, Button, Card, CardActionArea, CardContent, Stack, Typography } from '@mui/material';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import SportsGolfRoundedIcon from '@mui/icons-material/SportsGolfRounded';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { useAuthStore } from '@/stores/authStore';
import { useRounds } from '@/features/stats/useRounds';
import { useBag } from '@/features/bag/useBag';
import { useRoundStore } from '@/stores/roundStore';
import { fullName, scoreVsPar } from '@/utils/format';
import { estimateHandicap } from '@/utils/handicap';

export function HomePage() {
  const navigate = useNavigate();
  const profile = useAuthStore((s) => s.profile);
  const active = useRoundStore((s) => s.active);
  const { data: rounds } = useRounds();
  useBag(); // hydrate bag store

  const completed = (rounds ?? []).filter((r) => r.completed_at);
  const lastRound = completed[0];
  const handicap = estimateHandicap(completed.slice(0, 20).map((r) => r.handicap_differential));

  return (
    <Box>
      <PageHeader
        title={`Hi, ${fullName(profile?.first_name, profile?.last_name)}`}
        subtitle="Ready to play?"
      />
      <Stack spacing={2} px={2} pb={4}>
        {active ? (
          <Card
            elevation={0}
            sx={{
              background: 'linear-gradient(135deg, rgba(46,125,50,0.55), rgba(76,175,80,0.35))'
            }}
          >
            <CardActionArea onClick={() => navigate('/round/play')}>
              <CardContent>
                <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                  Active round
                </Typography>
                <Typography variant="h5">{active.courseName}</Typography>
                <Typography variant="body2" sx={{ opacity: 0.85, mt: 0.5 }}>
                  Hole {active.currentHoleIndex + 1} of {active.holesPlayed} · tap to resume
                </Typography>
              </CardContent>
            </CardActionArea>
          </Card>
        ) : (
          <Button
            variant="contained"
            size="large"
            startIcon={<PlayArrowRoundedIcon />}
            sx={{ minHeight: 72, fontSize: '1.15rem', borderRadius: 4 }}
            onClick={() => navigate('/round/start')}
          >
            Start a Round
          </Button>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1.5 }}>
          <StatCard
            label="Estimated Handicap"
            value={handicap.value != null ? handicap.value.toFixed(1) : '—'}
            hint={handicap.message ?? `Last ${handicap.roundsUsed} rounds`}
            accent="primary"
          />
          <StatCard
            label="Rounds Logged"
            value={completed.length}
            hint={completed.length === 1 ? '1 round' : `${completed.length} rounds`}
          />
        </Box>

        {lastRound && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
            <CardActionArea onClick={() => navigate(`/round/summary/${lastRound.id}`)}>
              <CardContent>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
                >
                  Last Round
                </Typography>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-end" mt={0.5}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" noWrap>
                      {lastRound.course_name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {dayjs(lastRound.started_at).format('MMM D, YYYY')}
                    </Typography>
                  </Box>
                  <Box textAlign="right">
                    <Typography variant="h4" sx={{ fontWeight: 700 }}>
                      {lastRound.score}
                    </Typography>
                    <Typography
                      variant="body2"
                      sx={{ fontWeight: 600 }}
                      color={lastRound.score_vs_par <= 0 ? 'primary' : 'warning.main'}
                    >
                      {scoreVsPar(lastRound.score, lastRound.par)}
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </CardActionArea>
          </Card>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1.5 }}>
          <QuickAction icon={<HistoryRoundedIcon />} label="Past" onClick={() => navigate('/round/history')} />
          <QuickAction icon={<InsightsRoundedIcon />} label="Stats" onClick={() => navigate('/stats')} />
          <QuickAction icon={<SportsGolfRoundedIcon />} label="Bag" onClick={() => navigate('/bag')} />
        </Box>
      </Stack>
    </Box>
  );
}

function QuickAction({
  icon,
  label,
  onClick
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
      <CardActionArea onClick={onClick} sx={{ p: 1.5 }}>
        <Stack alignItems="center" spacing={0.5}>
          <Box sx={{ color: 'primary.main', display: 'flex' }}>{icon}</Box>
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {label}
          </Typography>
        </Stack>
      </CardActionArea>
    </Card>
  );
}
