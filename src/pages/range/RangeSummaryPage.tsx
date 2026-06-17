import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Card, CardContent, Divider, Stack, Typography } from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { StatCard } from '@/components/ui/StatCard';
import { rangeRepo } from '@/services/rangeRepo';
import { computeClubSummaries } from '@/features/range/rangeStats';
import type { RangeShot } from '@/types/range';

export function RangeSummaryPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const [shots, setShots] = useState<RangeShot[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    (async () => {
      try {
        const s = await rangeRepo.getSessionShots(sessionId);
        if (!cancelled) setShots(s);
      } catch (err) {
        console.warn('[range] summary load failed', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  const summaries = useMemo(() => computeClubSummaries(shots), [shots]);
  const totalCarry = shots.length
    ? Math.round(shots.reduce((a, s) => a + s.carryYards, 0) / shots.length)
    : 0;

  return (
    <Box sx={{ pb: 'calc(env(safe-area-inset-bottom) + 16px)' }}>
      <PageHeader title="Range Summary" subtitle="Session complete" back="/practice" />
      <Stack spacing={2} px={2}>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1.5 }}>
          <StatCard label="Shots" value={shots.length} accent="primary" />
          <StatCard label="Avg Carry" value={shots.length ? `${totalCarry}y` : '—'} />
        </Box>

        <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
          <CardContent>
            <Typography variant="h6" sx={{ mb: 1 }}>
              By club
            </Typography>
            {loading ? (
              <Typography color="text.secondary">Loading…</Typography>
            ) : summaries.length === 0 ? (
              <Typography color="text.secondary">
                Need at least 3 shots with a club to show per-club dispersion.
              </Typography>
            ) : (
              <Stack divider={<Divider />} spacing={1}>
                {summaries.map((s) => (
                  <Stack key={s.club} direction="row" justifyContent="space-between" alignItems="center">
                    <Box>
                      <Typography variant="body1" fontWeight={700}>
                        {s.club}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {s.shotCount} shots · bias {Math.round(s.avgOfflineYards)}y{' '}
                        {s.avgOfflineYards >= 0 ? 'right' : 'left'}
                      </Typography>
                    </Box>
                    <Box textAlign="right">
                      <Typography variant="h6" color="primary">
                        {Math.round(s.avgCarryYards)}y
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        ±{Math.round(s.dispersionYards)}y dispersion
                      </Typography>
                    </Box>
                  </Stack>
                ))}
              </Stack>
            )}
          </CardContent>
        </Card>

        <Button variant="contained" onClick={() => navigate('/range')}>
          Start another range session
        </Button>
        <Button onClick={() => navigate('/practice')}>Back to practice</Button>
      </Stack>
    </Box>
  );
}
