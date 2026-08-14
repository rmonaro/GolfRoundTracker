import { useEffect, useMemo, useState } from 'react';
import { Box, IconButton, Stack, Typography, useTheme } from '@mui/material';
import SettingsRoundedIcon from '@mui/icons-material/SettingsRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import WatchRoundedIcon from '@mui/icons-material/WatchRounded';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { PageHeader } from '@/components/layout/PageHeader';
import { NextRoundHero } from '@/components/home/NextRoundHero';
import { GameStatsCard } from '@/components/home/GameStatsCard';
import { HomeSummaryRow } from '@/components/home/HomeSummaryRow';
import { ModeSwitchToggle } from '@/features/appMode/ModeSwitchToggle';
import { useAuthStore } from '@/stores/authStore';
import { swingRepo } from '@/services/swingRepo';
import type { SwingSession } from '@/types/swing';
import { useRounds } from '@/features/stats/useRounds';
import { useRoundHoles } from '@/features/stats/useRoundHoles';
import { aggregateRoundStats } from '@/features/stats/computeStats';
import { useBag } from '@/features/bag/useBag';
import { useRoundStore } from '@/stores/roundStore';
import { WASH_ROUND } from '@/theme/designTokens';
import { brand } from '@/theme/theme';
import { fullName, scoreVsPar } from '@/utils/format';

export function HomePage() {
  const navigate = useNavigate();
  const theme = useTheme();
  const profile = useAuthStore((s) => s.profile);
  const active = useRoundStore((s) => s.active);
  const { data: rounds } = useRounds();
  useBag(); // hydrate bag store

  const completed = (rounds ?? []).filter((r) => r.completed_at);
  const lastRound = completed[0];

  // Fairways/GIR/putts need hole-level rows, which arrive separately — the
  // score figures paint immediately and the rest fill in behind a skeleton.
  const completedIds = useMemo(() => completed.map((r) => r.id), [completed]);
  const holesQuery = useRoundHoles(completedIds);
  const stats = useMemo(
    () => aggregateRoundStats(rounds ?? [], holesQuery.data ?? new Map()),
    [rounds, holesQuery.data]
  );

  // Most recent practice session for the "Last Practice" row.
  const userId = useAuthStore((s) => s.session?.user.id ?? null);
  const [lastPractice, setLastPractice] = useState<SwingSession | null>(null);
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    swingRepo
      .listSessions(userId)
      .then((s) => {
        if (!cancelled) setLastPractice(s[0] ?? null);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const roundsLabel = completed.length === 1 ? '1 Round Logged' : `${completed.length} Rounds Logged`;

  return (
    <Box sx={{ fontVariantNumeric: 'tabular-nums' }}>
      <PageHeader
        title={`Hi, ${fullName(profile?.first_name, profile?.last_name)}`}
        subtitle="Ready to play?"
        action={
          <Stack direction="row" alignItems="center" spacing={1} sx={{ flexShrink: 0 }}>
            <ModeSwitchToggle />
            <IconButton
              aria-label="Settings"
              onClick={() => navigate('/settings')}
              sx={{ borderRadius: '12px' }}
            >
              <SettingsRoundedIcon />
            </IconButton>
          </Stack>
        }
      />

      <Stack spacing={2} px={2} pb={4}>
        {active ? (
          <NextRoundHero
            eyebrow="Active Round"
            meta={`Hole ${active.currentHoleIndex + 1} of ${active.holesPlayed}`}
            body={active.courseName}
            actionLabel="Resume Round"
            onAction={() => navigate('/round/play')}
          />
        ) : (
          <NextRoundHero
            eyebrow="Next Round"
            meta={roundsLabel}
            body="Pick a course, your tee box and number of holes."
            actionLabel="Start a Round"
            onAction={() => navigate('/round/start')}
          />
        )}

        {/* The Estimated Handicap tile is deliberately absent: differentials are
            only persisted when a round's summary screen is opened, so the number
            reads "—" for most players. Hidden until that pipeline is fixed
            rather than showing a permanently empty stat. */}

        {/* Always rendered, dashes and all: the empty grid tells a new player
            what the app will track for them once they finish a round. */}
        <GameStatsCard stats={stats} isLoadingHoles={holesQuery.isLoading} />

        {lastRound && (
          <HomeSummaryRow
            icon={<HistoryRoundedIcon />}
            iconBg={WASH_ROUND}
            // The wash is authored for dark surfaces; over a white card it goes
            // pale, and the light-green glyph disappears into it.
            iconColor={theme.palette.mode === 'dark' ? brand[200] : brand[800]}
            eyebrow="Last Round"
            title={lastRound.course_name}
            subtitle={dayjs(lastRound.started_at).format('MMM D, YYYY')}
            value={scoreVsPar(lastRound.score, lastRound.par)}
            valueColor={lastRound.score_vs_par <= 0 ? 'primary.main' : 'warning.main'}
            valueNote={`${lastRound.score} strokes`}
            onClick={() => navigate(`/round/summary/${lastRound.id}`)}
          />
        )}

        {lastPractice && (
          <HomeSummaryRow
            icon={<WatchRoundedIcon />}
            iconBg="rgba(248,137,48,0.14)"
            iconColor="primary.main"
            eyebrow="Last Practice"
            title="Swing/Net"
            subtitle={`${dayjs(lastPractice.startedAt).format('MMM D, YYYY')}${
              lastPractice.avgTempoRatio != null
                ? ` · ${lastPractice.avgTempoRatio.toFixed(1)}:1 tempo`
                : ''
            }`}
            value={String(lastPractice.swingCount)}
            valueColor="primary.main"
            valueNote={lastPractice.swingCount === 1 ? 'swing' : 'swings'}
            onClick={() => navigate(`/practice/history/${lastPractice.id}`)}
          />
        )}
      </Stack>
    </Box>
  );
}
