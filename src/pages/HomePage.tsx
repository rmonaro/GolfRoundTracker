import { Box, Button, Card, CardActionArea, CardContent, IconButton, Stack, Typography } from '@mui/material';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { HomeTournamentCard } from '@/components/home/HomeTournamentCard';
import { useAuthStore } from '@/stores/authStore';
import { useRounds } from '@/features/stats/useRounds';
import { useBag } from '@/features/bag/useBag';
import { useMyTournaments, useCachedTournaments } from '@/features/tournaments/useMyTournaments';
import { selectHomeTournament } from '@/features/tournaments/selectHomeTournament';
import { useRoundStore } from '@/stores/roundStore';
import { fullName, scoreVsPar } from '@/utils/format';
import { estimateHandicap } from '@/utils/handicap';

export function HomePage() {
  const navigate = useNavigate();
  const profile = useAuthStore((s) => s.profile);
  const active = useRoundStore((s) => s.active);
  const { data: rounds } = useRounds();
  useBag(); // hydrate bag store

  // Surface a live/upcoming tournament in place of "Start a Round". Prefer live
  // entitlements; fall back to the cached snapshot so the banner paints offline
  // / on the first frame instead of flashing the start button.
  const { data: tournaments } = useMyTournaments();
  const { data: cachedTournaments } = useCachedTournaments();
  const homeTournament = selectHomeTournament(
    tournaments?.tournaments ?? cachedTournaments,
    rounds
  );

  const completed = (rounds ?? []).filter((r) => r.completed_at);
  const lastRound = completed[0];
  const handicap = estimateHandicap(completed.slice(0, 20).map((r) => r.handicap_differential));

  return (
    <Box>
      <PageHeader
        title={`Hi, ${fullName(profile?.first_name, profile?.last_name)}`}
        subtitle="Ready to play?"
        action={
          <IconButton aria-label="Settings" onClick={() => navigate('/settings')}>
            <SettingsRoundedIcon />
          </IconButton>
        }
      />
      <Stack spacing={2} px={2} pb={4}>
        {active ? (
          <Card
            elevation={0}
            sx={{
              background: 'linear-gradient(135deg, rgba(46,125,50,0.55), rgba(76,175,80,0.35))',
              borderRadius: '5px'
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
        ) : homeTournament ? (
          <HomeTournamentCard
            selection={homeTournament}
            localRounds={rounds}
            onClick={() => navigate('/tournaments')}
          />
        ) : (
          <Button
            variant="contained"
            size="large"
            startIcon={<PlayArrowRoundedIcon />}
            sx={{ minHeight: 72, fontSize: '1.15rem', borderRadius: '5px' }}
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
          <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
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
                    {/* Headline = score-to-par (E / +N / -N). Raw stroke
                        total drops to the secondary line — matches the
                        Round Summary final-score treatment. */}
                    <Typography
                      variant="h4"
                      sx={{ fontWeight: 700 }}
                      color={lastRound.score_vs_par <= 0 ? 'primary' : 'warning.main'}
                    >
                      {scoreVsPar(lastRound.score, lastRound.par)}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ fontWeight: 600 }}
                    >
                      {lastRound.score} strokes
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </CardActionArea>
          </Card>
        )}
      </Stack>
    </Box>
  );
}
