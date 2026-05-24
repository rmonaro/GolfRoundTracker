import dayjs from 'dayjs';
import { Box, Card, CardActionArea, CardContent, Chip, CircularProgress, Stack, Typography } from '@mui/material';
import GolfCourseRoundedIcon from '@mui/icons-material/GolfCourseRounded';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { useRounds } from '@/features/stats/useRounds';
import { scoreVsPar } from '@/utils/format';

export function PastRoundsPage() {
  const navigate = useNavigate();
  const { data, isLoading } = useRounds();

  if (isLoading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const completed = (data ?? []).filter((r) => r.completed_at);

  return (
    <Box>
      <PageHeader title="Past Rounds" back />
      {completed.length === 0 ? (
        <EmptyState
          icon={<GolfCourseRoundedIcon fontSize="inherit" />}
          title="No completed rounds yet"
          description="Finish a round to see it here."
          actionLabel="Start Round"
          onAction={() => navigate('/round/start')}
        />
      ) : (
        <Stack spacing={1.5} px={2} pb={3}>
          {completed.map((r) => (
            <Card key={r.id} elevation={0} sx={{ bgcolor: 'background.paper' }}>
              <CardActionArea onClick={() => navigate(`/round/summary/${r.id}`)} sx={{ p: 0.5 }}>
                <CardContent>
                  <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary">
                        {dayjs(r.started_at).format('ddd MMM D, YYYY')}
                      </Typography>
                      <Typography variant="h6" noWrap>
                        {r.course_name}
                      </Typography>
                      <Stack direction="row" spacing={0.75} mt={0.5}>
                        <Chip label={`${r.holes_played} holes`} size="small" />
                        {r.handicap_differential != null && (
                          <Chip
                            label={`Δ ${r.handicap_differential.toFixed(1)}`}
                            size="small"
                            color="primary"
                            variant="outlined"
                          />
                        )}
                      </Stack>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="h4" sx={{ fontWeight: 700 }}>
                        {r.score}
                      </Typography>
                      <Typography
                        variant="body2"
                        color={r.score_vs_par <= 0 ? 'primary' : 'warning.main'}
                        sx={{ fontWeight: 600 }}
                      >
                        {scoreVsPar(r.score, r.par)}
                      </Typography>
                    </Box>
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      )}
    </Box>
  );
}
