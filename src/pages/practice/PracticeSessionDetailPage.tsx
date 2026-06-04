import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Chip, Divider, Paper, Stack, Typography } from '@mui/material';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { swingRepo } from '@/services/swingRepo';
import { evaluateSession } from '@/services/swingFeedbackEngine';
import { MotionDisclaimer } from '@/components/practice/MotionDisclaimer';
import { SwingCard } from '@/features/practice/SwingCard';
import { SWING_DISCLAIMER } from '@/utils/swingLabels';
import type { SwingFeedback, SwingMetric, SwingSession } from '@/types/swing';
import type { SwingFeedbackRow } from '@/types/database';

const fatigueLabel: Record<string, string> = {
  none: 'No fatigue trend',
  possible: 'Possible fatigue',
  likely: 'Likely fatigue'
};

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 2, textAlign: 'center' }}>
      <Typography variant="h6" fontWeight={800}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary">
        {label}
      </Typography>
    </Paper>
  );
}

const toFeedback = (r: SwingFeedbackRow): SwingFeedback => ({
  swingId: r.swing_id,
  level: r.level,
  code: r.code,
  message: r.message,
  disclaimer: SWING_DISCLAIMER
});

export function PracticeSessionDetailPage() {
  const navigate = useNavigate();
  const { sessionId = '' } = useParams();
  const [session, setSession] = useState<SwingSession | null>(null);
  const [swings, setSwings] = useState<SwingMetric[]>([]);
  const [feedbackBySwing, setFeedbackBySwing] = useState<Record<string, SwingFeedback[]>>({});
  const [sessionFeedback, setSessionFeedback] = useState<SwingFeedback[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!sessionId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      swingRepo.getSession(sessionId),
      swingRepo.listSwings(sessionId),
      swingRepo.listFeedback(sessionId)
    ])
      .then(([sess, sws, fb]) => {
        if (cancelled) return;
        setSession(sess);
        setSwings(sws);
        const perSwing: Record<string, SwingFeedback[]> = {};
        const sessionLevel: SwingFeedback[] = [];
        for (const row of fb) {
          const mapped = toFeedback(row);
          if (row.swing_id) {
            (perSwing[row.swing_id] ??= []).push(mapped);
          } else {
            sessionLevel.push(mapped);
          }
        }
        setFeedbackBySwing(perSwing);
        setSessionFeedback(sessionLevel);
      })
      .catch((err) => console.warn('[practice-detail] load failed', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  // Compute the overview stats from the actual swings rather than trusting the
  // session row's rollup — the rollup is only written on a clean end-of-session,
  // so an in-progress or imperfectly-ended session would otherwise show 0/—
  // even though the swings exist. Computed values always match the cards below.
  const derived = useMemo(() => evaluateSession(swings).rollup, [swings]);
  const swingCount = swings.length || (session?.swingCount ?? 0);
  const avgTempo = derived.avgTempoRatio ?? session?.avgTempoRatio ?? null;
  const tempoConsistency = derived.tempoConsistencyScore ?? session?.tempoConsistencyScore ?? null;
  const planeConsistency = derived.planeConsistencyScore ?? session?.planeConsistencyScore ?? null;
  const fatigueTrend = derived.fatigueTrend ?? session?.fatigueTrend ?? 'none';

  const levelColor = (level: string) =>
    level === 'positive' ? 'success' : level === 'attention' ? 'warning' : 'default';

  if (loading) {
    return (
      <Box sx={{ p: 2, maxWidth: 520, mx: 'auto' }}>
        <Typography color="text.secondary">Loading…</Typography>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 2, maxWidth: 520, mx: 'auto' }}>
      <Typography variant="h5" fontWeight={800}>
        Practice Session
      </Typography>
      {session && (
        <Typography variant="caption" color="text.secondary">
          {dayjs(session.startedAt).format('MMM D, YYYY · h:mm A')}
        </Typography>
      )}
      <MotionDisclaimer />

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 1, mt: 2 }}>
        <Stat label="Swings" value={String(swingCount)} />
        <Stat
          label="Avg tempo (est.)"
          value={avgTempo != null ? `${avgTempo.toFixed(1)} : 1` : '—'}
        />
        <Stat
          label="Tempo consistency"
          value={tempoConsistency != null ? `${tempoConsistency}/100` : '—'}
        />
        <Stat
          label="Pattern consistency"
          value={planeConsistency != null ? `${planeConsistency}/100` : '—'}
        />
      </Box>

      <Chip
        sx={{ mt: 1.5 }}
        size="small"
        color={fatigueTrend !== 'none' ? 'warning' : 'default'}
        label={fatigueLabel[fatigueTrend]}
      />

      {sessionFeedback.length > 0 && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            Session feedback
          </Typography>
          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
            {sessionFeedback.map((f) => (
              <Chip key={f.code} size="small" color={levelColor(f.level)} label={f.message} />
            ))}
          </Stack>
        </>
      )}

      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
        Swings
      </Typography>
      <Stack spacing={1.5}>
        {swings.map((s) => (
          <SwingCard key={s.id} swing={s} feedback={feedbackBySwing[s.remoteId ?? s.id] ?? []} editable={false} />
        ))}
      </Stack>

      <Button sx={{ mt: 3 }} onClick={() => navigate('/practice/history')}>
        Back to history
      </Button>
    </Box>
  );
}
