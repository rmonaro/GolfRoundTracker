import { useEffect } from 'react';
import { Box, Card, CardContent, CircularProgress, Stack, Typography, Button, Chip } from '@mui/material';
import HomeRoundedIcon from '@mui/icons-material/HomeRounded';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { useRoundDetails } from '@/features/stats/useRounds';
import { detailRoundStats } from '@/features/stats/computeStats';
import { calculateDifferential } from '@/utils/handicap';
import { roundRepo } from '@/services/roundRepo';
import { useRoundStore } from '@/stores/roundStore';
import { useBagStore } from '@/stores/bagStore';
import { pct, scoreVsPar, durationLabel } from '@/utils/format';

export function RoundSummaryPage() {
  const { roundId } = useParams<{ roundId: string }>();
  const navigate = useNavigate();
  const detail = useRoundDetails(roundId);
  const reset = useRoundStore((s) => s.reset);
  const bag = useBagStore((s) => s.clubs);

  useEffect(() => {
    if (!detail.data?.round) return;
    const { round, holes } = detail.data;
    if (round.completed_at) {
      // Compute differential once and persist if missing.
      // strokes already counts every logged shot (incl. putts); add penalty strokes on top.
      const score = holes.reduce((s, h) => s + h.strokes + h.penalty_strokes, 0);
      const diff = calculateDifferential(score, round.course_rating, round.slope_rating);
      if (diff != null && round.handicap_differential == null) {
        roundRepo.update(round.id, { handicap_differential: diff }).catch((err) => {
          console.error('[summary] could not persist differential', err);
        });
      }
      reset();
    }
  }, [detail.data, reset]);

  if (!roundId) return <Navigate to="/round" replace />;

  if (detail.isLoading || !detail.data) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '60dvh' }}>
        <CircularProgress />
      </Box>
    );
  }

  const { round, holes, shots } = detail.data;
  const stats = detailRoundStats(round, holes, shots);
  const front = holes.filter((h) => h.hole_number <= 9);
  const back = holes.filter((h) => h.hole_number > 9);
  const frontTotal = front.reduce((s, h) => s + h.strokes + h.penalty_strokes, 0);
  const frontPar = front.reduce((s, h) => s + h.par, 0);
  const backTotal = back.reduce((s, h) => s + h.strokes + h.penalty_strokes, 0);
  const backPar = back.reduce((s, h) => s + h.par, 0);

  return (
    <Box>
      <PageHeader title="Round Summary" subtitle={round.course_name} back="/round" />
      <Stack spacing={2} px={2} pb={4}>
        <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
          <CardContent>
            <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
              Final Score
            </Typography>
            <Stack direction="row" alignItems="baseline" spacing={2} mt={0.5}>
              <Typography variant="h2" sx={{ fontWeight: 800 }}>
                {stats.totalScore}
              </Typography>
              <Typography variant="h5" color="primary" sx={{ fontWeight: 700 }}>
                {scoreVsPar(stats.totalScore, stats.totalPar)}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                par {stats.totalPar}
              </Typography>
            </Stack>
            <Stack direction="row" spacing={1} mt={1}>
              <Chip label={`${round.holes_played} holes`} size="small" />
              <Chip label={durationLabel(round.started_at, round.completed_at)} size="small" />
              <Chip label={`${stats.clubsUsed.size} clubs used`} size="small" />
            </Stack>
          </CardContent>
        </Card>

        <ScoreCard
          holes={holes}
          frontTotal={frontTotal}
          frontPar={frontPar}
          backTotal={backTotal}
          backPar={backPar}
        />

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: 1.5
          }}
        >
          <StatCard label="Putts" value={stats.putts} />
          <StatCard label="GIR" value={`${stats.greensInRegulation}/${round.holes_played}`} />
          <StatCard label="Fairways Hit" value={`${stats.fairwaysHitPct}%`} accent="success" />
          <StatCard label="Sand Shots" value={stats.sandShots} />
          <StatCard label="Miss Left" value={`${stats.missLeftPct}%`} />
          <StatCard label="Miss Right" value={`${stats.missRightPct}%`} />
          <StatCard label="Penalties" value={stats.penaltyCount} accent="warning" />
          <StatCard label="Round Time" value={durationLabel(round.started_at, round.completed_at)} />
        </Box>

        {stats.clubsUsed.size > 0 && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
            <CardContent>
              <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
                Clubs Used
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
                {[...stats.clubsUsed].map((clubId) => {
                  const club = bag.find((c) => c.clubId === clubId);
                  return (
                    <Chip key={clubId} label={club ? club.customName || club.name : 'Club'} size="small" />
                  );
                })}
              </Box>
            </CardContent>
          </Card>
        )}

        <Button
          variant="contained"
          size="large"
          startIcon={<HomeRoundedIcon />}
          onClick={() => navigate('/')}
        >
          Done
        </Button>
        <Typography variant="caption" color="text.secondary" align="center">
          Estimated handicap only. Not an official USGA handicap.
        </Typography>
      </Stack>
    </Box>
  );
}

interface ScoreCardProps {
  holes: Array<{ hole_number: number; par: number; strokes: number; penalty_strokes: number }>;
  frontTotal: number;
  frontPar: number;
  backTotal: number;
  backPar: number;
}

function ScoreCard({ holes, frontTotal, frontPar, backTotal, backPar }: ScoreCardProps) {
  const front = holes.filter((h) => h.hole_number <= 9);
  const back = holes.filter((h) => h.hole_number > 9);

  return (
    <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
      <CardContent>
        <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
          Scorecard
        </Typography>
        <Box sx={{ overflowX: 'auto', mt: 1 }}>
          <NineRow label="Front 9" holes={front} totalLabel="OUT" total={frontTotal} parTotal={frontPar} />
          {back.length > 0 && (
            <NineRow label="Back 9" holes={back} totalLabel="IN" total={backTotal} parTotal={backPar} />
          )}
        </Box>
      </CardContent>
    </Card>
  );
}

function NineRow({
  label,
  holes,
  totalLabel,
  total,
  parTotal
}: {
  label: string;
  holes: Array<{ hole_number: number; par: number; strokes: number; penalty_strokes: number }>;
  totalLabel: string;
  total: number;
  parTotal: number;
}) {
  return (
    <Box mt={1.5}>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: `repeat(${holes.length}, minmax(36px, 1fr)) 60px`,
          gap: 0.5,
          mt: 0.5,
          fontVariantNumeric: 'tabular-nums'
        }}
      >
        {holes.map((h) => (
          <Box key={`hole-${h.hole_number}`} sx={{ textAlign: 'center', fontSize: 12, color: 'text.secondary' }}>
            {h.hole_number}
          </Box>
        ))}
        <Box sx={{ textAlign: 'center', fontSize: 12, color: 'text.secondary' }}>{totalLabel}</Box>
        {holes.map((h) => (
          <Box key={`par-${h.hole_number}`} sx={{ textAlign: 'center', fontSize: 12, color: 'text.secondary' }}>
            {h.par}
          </Box>
        ))}
        <Box sx={{ textAlign: 'center', fontSize: 12, color: 'text.secondary' }}>{parTotal}</Box>
        {holes.map((h) => {
          const holeScore = h.strokes + h.penalty_strokes;
          return (
            <Box
              key={`s-${h.hole_number}`}
              sx={{
                textAlign: 'center',
                py: 0.5,
                borderRadius: 1,
                fontWeight: 700,
                bgcolor: scoreColor(holeScore, h.par),
                color: 'common.white'
              }}
            >
              {holeScore || '-'}
            </Box>
          );
        })}
        <Box sx={{ textAlign: 'center', py: 0.5, fontWeight: 700 }}>{total || '-'}</Box>
      </Box>
      <Typography variant="caption" color="text.secondary" mt={0.5} display="block">
        Hits {pct(holes.filter((h) => h.strokes + h.penalty_strokes > 0 && h.strokes + h.penalty_strokes <= h.par).length, holes.length)}% to par
      </Typography>
    </Box>
  );
}

function scoreColor(strokes: number, par: number): string {
  if (strokes === 0) return 'rgba(255,255,255,0.08)';
  const diff = strokes - par;
  if (diff <= -2) return '#1976d2';
  if (diff === -1) return '#2e7d32';
  if (diff === 0) return '#4caf50';
  if (diff === 1) return '#ef6c00';
  return '#c62828';
}
