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
import { useRoundHoles } from '@/features/stats/useRoundHoles';
import {
  computeClubDispersion,
  type AimTargetByHole
} from '@/features/stats/computeDispersion';
import { ClubDispersionCard } from '@/features/stats/ClubDispersionCard';
import {
  computeStrokesGained,
  aggregateStrokesGained,
  aggregateStrokesGainedByClub,
  aggregateStrokesGainedByRound,
  derivePinsFromMadePutts,
  type RoundHoleRef
} from '@/features/stats/computeStrokesGained';
import {
  StrokesGainedCard,
  MIN_ROUNDS_FOR_SG
} from '@/features/stats/StrokesGainedCard';
import { roundRepo } from '@/services/roundRepo';
import { supabase } from '@/lib/supabase';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { useBagStore } from '@/stores/bagStore';
import { useAuthStore } from '@/stores/authStore';

export function StatsPage() {
  const navigate = useNavigate();
  const { data: rounds, isLoading } = useRounds();
  const completedIds = useMemo(
    () => (rounds ?? []).filter((r) => r.completed_at).map((r) => r.id),
    [rounds]
  );

  // Same hook (and cache entry) the Home screen's stats panel uses.
  const holesQuery = useRoundHoles(completedIds);

  const shotsQuery = useQuery({
    queryKey: ['stats-shots', completedIds],
    enabled: completedIds.length > 0,
    queryFn: async () => {
      const all = await Promise.all(completedIds.map((id) => roundRepo.listShots(id)));
      return all.flat();
    }
  });

  // Pull all course-level holes for the courses the user has played.
  // We only need (course_id, hole_number, green_lat, green_lng, pin_lat,
  // pin_lng) to compute aim-target lookups for the dispersion chart —
  // each row is small so a single batch query is cheaper than fetching
  // per-hole on demand.
  const uniqueCourseIds = useMemo(
    () => Array.from(new Set((rounds ?? []).map((r) => r.course_id))),
    [rounds]
  );
  const courseHolesQuery = useQuery({
    queryKey: ['stats-course-holes', uniqueCourseIds],
    enabled: uniqueCourseIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('holes')
        .select('course_id, hole_number, green_lat, green_lng, pin_lat, pin_lng')
        .in('course_id', uniqueCourseIds);
      if (error) throw error;
      return data ?? [];
    }
  });

  const bag = useBagStore((s) => s.clubs);
  const skillLevel = useAuthStore((s) => s.profile?.skill_level ?? null);

  if (isLoading) {
    return (
      <Box>
        <PageHeader title="Stats" back="/" />
        <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
          <CircularProgress />
        </Box>
      </Box>
    );
  }

  if (!rounds || rounds.length === 0) {
    return (
      <Box>
        <PageHeader title="Stats" back="/" />
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

  // Trend charts only become useful once there's a meaningful sample.
  // Hide the score trend, differential trend, and recent-differentials
  // strip until the user has logged at least 5 completed rounds — before
  // that the lines wobble per-round and the chart reads as noise.
  const MIN_ROUNDS_FOR_TRENDS = 5;
  const showTrends = completedIds.length >= MIN_ROUNDS_FOR_TRENDS;

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

  // Build a round_hole.id → green/pin position map for the dispersion
  // chart. The shot's `hole_id` references the round_holes row; that row
  // has its own hole_number, and the parent round has the course_id —
  // we cross-reference back to the course-level holes table for the
  // green/pin coordinates the user was aiming at.
  const aimTargetByHole: AimTargetByHole = useMemo(() => {
    const map: AimTargetByHole = new Map();
    if (!courseHolesQuery.data || !rounds) return map;
    const roundToCourse = new Map(rounds.map((r) => [r.id, r.course_id]));
    const courseHoleKey = (courseId: string, holeNumber: number) =>
      `${courseId}__${holeNumber}`;
    const courseHoleMap = new Map<string, { lat: number; lng: number }>();
    for (const ch of courseHolesQuery.data) {
      // Prefer per-round pin if set, else the green centroid. Skip
      // entirely when both are null (course not OSM-synced yet).
      const lat = ch.pin_lat ?? ch.green_lat;
      const lng = ch.pin_lng ?? ch.green_lng;
      if (lat == null || lng == null) continue;
      courseHoleMap.set(courseHoleKey(ch.course_id, ch.hole_number), { lat, lng });
    }
    for (const [roundId, holes] of holesByRound.entries()) {
      const courseId = roundToCourse.get(roundId);
      if (!courseId) continue;
      for (const h of holes) {
        const target = courseHoleMap.get(courseHoleKey(courseId, h.hole_number));
        if (target) map.set(h.id, target);
      }
    }
    return map;
  }, [courseHolesQuery.data, holesByRound, rounds]);

  // Per-club shot dispersion — distance variance + miss bias derived from
  // every logged shot in the user's history. Putters are filtered out
  // inside the helper. Real GPS-derived lateral offset is computed
  // against the green centroid (or pin position when set) as the
  // implied aim target.
  const dispersionRows = computeClubDispersion(
    shotsQuery.data ?? [],
    bag,
    aimTargetByHole
  );

  // Strokes Gained — derive a per-hole pin position from the user's
  // history of made putts (most courses aren't OSM-synced yet so the
  // explicit green coords aren't available), then run the per-shot SG
  // compute against the amateur baseline. Card is hidden by the
  // sample-size guard below.
  const sgData = useMemo(() => {
    const shots = shotsQuery.data ?? [];
    if (shots.length === 0) return null;
    // Flatten round_holes from holesByRound + rounds into the
    // RoundHoleRef list the pin-derivation expects.
    const roundToCourse = new Map(rounds.map((r) => [r.id, r.course_id]));
    const roundHoleRefs: RoundHoleRef[] = [];
    for (const [roundId, holes] of holesByRound.entries()) {
      const courseId = roundToCourse.get(roundId);
      if (!courseId) continue;
      for (const h of holes) {
        roundHoleRefs.push({ id: h.id, courseId, holeNumber: h.hole_number });
      }
    }
    const pins = derivePinsFromMadePutts(shots, roundHoleRefs);
    const shotSGs = computeStrokesGained(shots, pins, skillLevel);
    // Restrict the trend-by-round aggregation to completed rounds so
    // an in-progress round (active.completed_at = null) doesn't show
    // up as a spurious low/partial point on the chart.
    const completedRounds = rounds.filter((r) => r.completed_at);
    return {
      totals: aggregateStrokesGained(shotSGs),
      byClub: aggregateStrokesGainedByClub(shotSGs, bag),
      byRound: aggregateStrokesGainedByRound(shotSGs, completedRounds)
    };
  }, [shotsQuery.data, holesByRound, rounds, bag, skillLevel]);
  const sgTotals = sgData?.totals ?? null;
  const sgByClub = sgData?.byClub ?? [];
  const sgByRound = sgData?.byRound ?? [];
  const showSG =
    completedIds.length >= MIN_ROUNDS_FOR_SG &&
    sgTotals !== null &&
    sgTotals.scoredShotCount > 0;

  return (
    <Box>
      <PageHeader
        title="Stats"
        subtitle={`Estimated handicap based on ${stats.handicap.roundsUsed} rounds`}
        back="/"
      />
      <Stack spacing={2} px={2} pb={4}>
        <Card
          elevation={0}
          sx={{
            background: 'linear-gradient(135deg, rgba(46,125,50,0.4), rgba(76,175,80,0.25))',
            borderRadius: '5px'
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

        {showSG && sgTotals && (
          <StrokesGainedCard
            totals={sgTotals}
            roundCount={completedIds.length}
            byClub={sgByClub}
            byRound={sgByRound}
            skillLevel={skillLevel}
          />
        )}

        {!showTrends && completedIds.length > 0 && (
          <Alert severity="info" variant="outlined">
            Score and differential trends unlock after {MIN_ROUNDS_FOR_TRENDS} completed rounds — {' '}
            {MIN_ROUNDS_FOR_TRENDS - completedIds.length} to go.
          </Alert>
        )}

        {showTrends && stats.recentScores.length > 0 && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
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

        {showTrends && stats.handicapTrend.length > 0 && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
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
          <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
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

        {dispersionRows.length > 0 && <ClubDispersionCard rows={dispersionRows} />}

        {showTrends && stats.recentDifferentials.length > 0 && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
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
