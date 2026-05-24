import { useMemo } from 'react';
import {
  Box,
  Card,
  CardContent,
  CircularProgress,
  Stack,
  Typography,
  Alert,
  Chip
} from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';
import { BarChart } from '@mui/x-charts/BarChart';
import InsightsRoundedIcon from '@mui/icons-material/InsightsRounded';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { EmptyState } from '@/components/ui/EmptyState';
import { useRounds } from '@/features/stats/useRounds';
import { aggregateRoundStats } from '@/features/stats/computeStats';
import { roundRepo } from '@/services/roundRepo';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useBagStore } from '@/stores/bagStore';

export function StatsPage() {
  const navigate = useNavigate();
  const { data: rounds, isLoading } = useRounds();
  const completedIds = useMemo(
    () => (rounds ?? []).filter((r) => r.completed_at).map((r) => r.id),
    [rounds]
  );

  const holesQuery = useQuery({
    queryKey: ['stats-holes', completedIds],
    enabled: completedIds.length > 0,
    queryFn: async () => {
      const all = await Promise.all(completedIds.map((id) => roundRepo.listHoles(id)));
      const map = new Map<string, typeof all[number]>();
      completedIds.forEach((id, idx) => map.set(id, all[idx]));
      return map;
    }
  });

  const shotsQuery = useQuery({
    queryKey: ['stats-shots', completedIds],
    enabled: completedIds.length > 0,
    queryFn: async () => {
      const all = await Promise.all(completedIds.map((id) => roundRepo.listShots(id)));
      return all.flat();
    }
  });

  const bag = useBagStore((s) => s.clubs);

  if (isLoading) {
    return (
      <Box>
        <PageHeader title="Stats" />
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  if (!rounds || rounds.length === 0) {
    return (
      <Box>
        <PageHeader title="Stats" />
        <EmptyState
          icon={<InsightsRoundedIcon fontSize="inherit" />}
          title="No stats yet"
          description="Play and finish a round to see your stats."
          actionLabel="Start Round"
          onAction={() => navigate('/round/start')}
        />
      </Box>
    );
  }

  const holesByRound = holesQuery.data ?? new Map();
  const stats = aggregateRoundStats(rounds, holesByRound);

  // Top used clubs across all logged shots.
  const clubUsage = new Map<string, number>();
  for (const s of shotsQuery.data ?? []) {
    if (!s.club_id) continue;
    clubUsage.set(s.club_id, (clubUsage.get(s.club_id) ?? 0) + 1);
  }
  const topClubs = [...clubUsage.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([clubId, count]) => {
      const club = bag.find((c) => c.clubId === clubId);
      return { label: club ? club.customName || club.name : 'Club', count };
    });

  return (
    <Box>
      <PageHeader
        title="Stats"
        subtitle={`Estimated handicap based on ${stats.handicap.roundsUsed} rounds`}
      />
      <Stack spacing={2} px={2} pb={4}>
        <Card
          elevation={0}
          sx={{
            background: 'linear-gradient(135deg, rgba(46,125,50,0.4), rgba(76,175,80,0.25))'
          }}
        >
          <CardContent>
            <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Estimated Handicap
            </Typography>
            <Typography variant="h2" sx={{ fontWeight: 800, mt: 0.5 }}>
              {stats.handicap.value != null ? stats.handicap.value.toFixed(1) : '—'}
            </Typography>
            {stats.handicap.message && (
              <Typography variant="body2" sx={{ opacity: 0.9 }}>
                {stats.handicap.message}
              </Typography>
            )}
            <Typography variant="caption" sx={{ opacity: 0.75, display: 'block', mt: 1 }}>
              Estimated handicap only. Not an official USGA handicap.
            </Typography>
          </CardContent>
        </Card>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 1.5
          }}
        >
          <StatCard label="Avg Score" value={stats.averageScore ?? '—'} />
          <StatCard label="Best Score" value={stats.bestScore ?? '—'} accent="success" />
          <StatCard label="Fairways %" value={stats.fairwaysHitPct != null ? `${stats.fairwaysHitPct}%` : '—'} />
          <StatCard label="GIR %" value={stats.girPct != null ? `${stats.girPct}%` : '—'} />
          <StatCard label="Putts / Rd" value={stats.puttsPerRound ?? '—'} />
          <StatCard label="Penalty Avg" value={stats.penaltyAverage ?? '—'} accent="warning" />
          <StatCard label="Miss Bias" value={stats.missBias ? capitalize(stats.missBias) : '—'} />
          <StatCard label="Avg vs Par" value={fmtVsPar(stats.averageScoreVsPar)} />
        </Box>

        {stats.recentScores.length > 0 && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Score Trend
              </Typography>
              <Box mt={1} sx={{ height: 200 }}>
                <LineChart
                  series={[{ data: stats.recentScores.map((s) => s.score), label: 'Score', color: '#4CAF50' }]}
                  xAxis={[{ scaleType: 'point', data: stats.recentScores.map((s) => s.date) }]}
                  height={200}
                  margin={{ left: 32, right: 16, top: 16, bottom: 24 }}
                />
              </Box>
            </CardContent>
          </Card>
        )}

        {stats.handicapTrend.length > 0 && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Handicap Differential Trend
              </Typography>
              <Box mt={1} sx={{ height: 180 }}>
                <LineChart
                  series={[
                    {
                      data: stats.handicapTrend.map((s) => s.differential ?? 0),
                      label: 'Differential',
                      color: '#81C784'
                    }
                  ]}
                  xAxis={[{ scaleType: 'point', data: stats.handicapTrend.map((s) => s.date) }]}
                  height={180}
                  margin={{ left: 32, right: 16, top: 16, bottom: 24 }}
                />
              </Box>
            </CardContent>
          </Card>
        )}

        {topClubs.length > 0 && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Most Used Clubs
              </Typography>
              <Box mt={1} sx={{ height: 200 }}>
                <BarChart
                  series={[{ data: topClubs.map((c) => c.count), label: 'Shots', color: '#A5D6A7' }]}
                  xAxis={[{ scaleType: 'band', data: topClubs.map((c) => c.label) }]}
                  height={200}
                  margin={{ left: 32, right: 16, top: 16, bottom: 32 }}
                />
              </Box>
            </CardContent>
          </Card>
        )}

        {stats.recentDifferentials.length > 0 && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Recent Differentials
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
                {stats.recentDifferentials.slice(0, 10).map((d, i) => (
                  <Chip key={`${d.date}-${i}`} label={`${d.date} · ${d.differential?.toFixed(1)}`} size="small" />
                ))}
              </Box>
            </CardContent>
          </Card>
        )}

        <Alert severity="info" variant="outlined">
          Estimated handicap is for tracking trends. It is not an official USGA handicap.
        </Alert>
      </Stack>
    </Box>
  );
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function fmtVsPar(n: number | null) {
  if (n == null) return '—';
  if (n === 0) return 'E';
  return n > 0 ? `+${n}` : `${n}`;
}
