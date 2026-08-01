import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Chip, Divider, IconButton, Paper, Stack, Typography } from '@mui/material';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import { useNavigate, useParams } from 'react-router-dom';
import dayjs from 'dayjs';
import { swingRepo } from '@/services/swingRepo';
import { evaluateSession } from '@/services/swingFeedbackEngine';
import { MotionDisclaimer } from '@/components/practice/MotionDisclaimer';
import { practicePageSx } from './practicePageSx';
import { ClubGroups } from '@/features/practice/ClubGroups';
import { FeedbackChips } from '@/features/practice/FeedbackChips';
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
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 0, textAlign: 'center' }}>
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
  // Count real swings (rehearsals excluded), matching the stats below.
  const swingCount = derived.swingCount || swings.length;
  const avgTempo = derived.avgTempoRatio ?? session?.avgTempoRatio ?? null;
  const tempoConsistency = derived.tempoConsistencyScore ?? session?.tempoConsistencyScore ?? null;
  const planeConsistency = derived.planeConsistencyScore ?? session?.planeConsistencyScore ?? null;
  const fatigueTrend = derived.fatigueTrend ?? session?.fatigueTrend ?? 'none';
  const setupConsistency = derived.setupConsistencyScore ?? session?.setupConsistencyScore ?? null;
  const avgRest = derived.avgRestSeconds ?? session?.avgRestSeconds ?? null;


  if (loading) {
    return (
      <Box sx={practicePageSx()}>
        <Typography color="text.secondary">Loading…</Typography>
      </Box>
    );
  }

  return (
    <Box sx={practicePageSx()}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="h5" sx={{ fontWeight: 900, fontSize: '32px' }}>
          Practice Session
        </Typography>
        <IconButton
          aria-label="What these numbers mean"
          onClick={() => navigate('/practice/guide')}
        >
          <InfoOutlinedIcon />
        </IconButton>
      </Stack>
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

      <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap" useFlexGap>
        <Chip
          size="small"
          color={fatigueTrend !== 'none' ? 'warning' : 'default'}
          label={fatigueLabel[fatigueTrend]}
        />
        {setupConsistency != null && (
          <Chip size="small" variant="outlined" label={`Setup ${setupConsistency}/100`} />
        )}
        {avgRest != null && (
          <Chip size="small" variant="outlined" label={`~${avgRest}s between swings`} />
        )}
        {session?.avgHeartRate != null && (
          <Chip size="small" color="error" variant="outlined" label={`♥ ${session.avgHeartRate} avg`} />
        )}
        {session?.maxHeartRate != null && (
          <Chip size="small" color="error" variant="outlined" label={`♥ ${session.maxHeartRate} max`} />
        )}
        {session?.hrvSdnn != null && (
          <Chip size="small" variant="outlined" label={`HRV ${Math.round(session.hrvSdnn)} ms`} />
        )}
        {session?.activeCalories != null && (
          <Chip size="small" variant="outlined" label={`${Math.round(session.activeCalories)} kcal`} />
        )}
      </Stack>

      {sessionFeedback.length > 0 && (
        <>
          <Divider sx={{ my: 2 }} />
          <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
            Session feedback
          </Typography>
          <FeedbackChips items={sessionFeedback} />
        </>
      )}

      <Divider sx={{ my: 2 }} />
      <Typography variant="subtitle2" fontWeight={700} sx={{ mb: 1 }}>
        By club
      </Typography>
      <ClubGroups
        swings={swings}
        getFeedback={(s) => feedbackBySwing[s.remoteId ?? s.id] ?? []}
      />

      <Button sx={{ mt: 3 }} onClick={() => navigate('/practice/history')}>
        Back to history
      </Button>
    </Box>
  );
}
