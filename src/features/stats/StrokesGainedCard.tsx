import { useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  Stack,
  Tab,
  Tabs,
  Typography
} from '@mui/material';
import { LineChart } from '@mui/x-charts/LineChart';
import type { SkillLevel } from '@/models';
import type {
  RoundStrokesGained,
  ClubStrokesGained,
  RoundSGTrendPoint
} from './computeStrokesGained';

interface Props {
  /** Sum of per-shot SG across the user's entire scored history. */
  totals: RoundStrokesGained;
  /** Number of completed rounds the totals were drawn from — used to
   *  compute "per round" averages so the card reads at the same scale
   *  regardless of history depth. */
  roundCount: number;
  /** Per-club SG breakdown, sorted by SG/shot descending. Empty array
   *  disables the "By Club" tab. */
  byClub: ClubStrokesGained[];
  /** SG total per round, chronological. Empty (or 1-point) array
   *  disables the "Trend" tab. */
  byRound: RoundSGTrendPoint[];
  /** User's profile skill level — used in the subtitle so they know
   *  which baseline they're being measured against. Null when the
   *  user hasn't set it yet (falls back to the 'average' baseline). */
  skillLevel: SkillLevel | null;
}

const SKILL_LABELS: Record<SkillLevel, string> = {
  beginner: 'beginner (~100-shooter)',
  average: 'average (~90-shooter)',
  good: 'good (~80-shooter)',
  advanced: 'advanced (scratch)',
  pga_tour: 'PGA Tour'
};

type SGTab = 'summary' | 'trend' | 'club';

/** Threshold below which the card stays hidden — SG is statistically
 *  noisy with too few rounds. Mirrors the existing trend-chart guard. */
export const MIN_ROUNDS_FOR_SG = 3;

/**
 * Strokes Gained card. Three tabs:
 *   • Summary  — Total + 4 category rows (Off the Tee / Approach /
 *                Around the Green / Putting)
 *   • Trend    — Per-round LineChart, oldest → newest
 *   • By Club  — Per-club SG/shot list, sorted best-first
 *
 * Tabs whose data is missing (e.g., only 1 round → no trend, < 5 shots
 * on every club → no per-club rows) are disabled rather than hidden so
 * the tab strip has a stable layout.
 *
 * Card is hidden by the parent when roundCount < MIN_ROUNDS_FOR_SG or
 * when scoredShotCount is 0 (no GPS-tracked shots yet).
 */
export function StrokesGainedCard({
  totals,
  roundCount,
  byClub,
  byRound,
  skillLevel
}: Props) {
  if (totals.scoredShotCount === 0) return null;

  const safeRounds = Math.max(1, roundCount);
  const perRound = (n: number) => n / safeRounds;
  const baselineLabel = SKILL_LABELS[skillLevel ?? 'average'];

  const hasTrend = byRound.length >= 2;
  const hasClub = byClub.length > 0;

  const [tab, setTab] = useState<SGTab>('summary');

  return (
    <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
      <CardContent>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
        >
          Strokes Gained
        </Typography>
        <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 1.5 }}>
          Per round vs the {baselineLabel} baseline. Positive = gaining strokes.
          {skillLevel == null && ' Set your skill level in Settings to tune this.'}
        </Typography>

        <Tabs
          value={tab}
          onChange={(_, v) => setTab(v as SGTab)}
          variant="fullWidth"
          sx={{
            minHeight: 36,
            mb: 1.5,
            '& .MuiTab-root': {
              minHeight: 36,
              textTransform: 'none',
              fontSize: '0.8rem',
              fontWeight: 600
            }
          }}
        >
          <Tab label="Summary" value="summary" />
          <Tab label="Trend" value="trend" disabled={!hasTrend} />
          <Tab label="By Club" value="club" disabled={!hasClub} />
        </Tabs>

        {tab === 'summary' && (
          <Stack spacing={1.25}>
            <SGRow label="Total" value={perRound(totals.total)} primary />
            <SGRow label="Off the Tee" value={perRound(totals.tee)} />
            <SGRow label="Approach" value={perRound(totals.approach)} />
            <SGRow label="Around the Green" value={perRound(totals.arg)} />
            <SGRow label="Putting" value={perRound(totals.putting)} />
          </Stack>
        )}

        {tab === 'trend' && hasTrend && (
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mb: 1, fontSize: '0.7rem' }}
            >
              SG total per round, oldest → newest. Above 0 = above baseline.
            </Typography>
            <Box sx={{ height: 220, mx: -1 }}>
              <LineChart
                height={220}
                margin={{ top: 12, right: 16, bottom: 28, left: 36 }}
                series={[
                  {
                    data: byRound.map((p) => p.totalSG),
                    label: 'SG',
                    color: '#A5D6A7',
                    showMark: true
                  }
                ]}
                xAxis={[
                  {
                    scaleType: 'point',
                    data: byRound.map((p) => p.label)
                  }
                ]}
                slotProps={{ legend: { hidden: true } }}
              />
            </Box>
          </Box>
        )}

        {tab === 'club' && hasClub && (
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mb: 1, fontSize: '0.7rem' }}
            >
              SG / shot. Clubs with fewer than 5 scored shots are hidden.
            </Typography>
            <Stack spacing={0.75}>
              {byClub.map((c) => (
                <ClubRow key={c.clubId} row={c} />
              ))}
            </Stack>
          </Box>
        )}

        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ display: 'block', mt: 1.5, fontSize: '0.7rem' }}
        >
          Based on {totals.scoredShotCount} GPS-tracked{' '}
          {totals.scoredShotCount === 1 ? 'shot' : 'shots'} across {safeRounds}{' '}
          {safeRounds === 1 ? 'round' : 'rounds'}.
        </Typography>
      </CardContent>
    </Card>
  );
}

function ClubRow({ row }: { row: ClubStrokesGained }) {
  const pos = row.sgPerShot >= 0;
  return (
    <Stack direction="row" alignItems="baseline" spacing={1.5}>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
          {row.clubName}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {row.shotCount} shots
        </Typography>
      </Box>
      <Box sx={{ textAlign: 'right' }}>
        <Box
          sx={{
            fontSize: '1.05rem',
            fontWeight: 700,
            color: pos ? 'success.light' : 'warning.light',
            lineHeight: 1
          }}
        >
          {pos ? '+' : ''}
          {row.sgPerShot.toFixed(2)}
        </Box>
        <Typography variant="caption" color="text.secondary">
          total {row.totalSG >= 0 ? '+' : ''}
          {row.totalSG.toFixed(1)}
        </Typography>
      </Box>
    </Stack>
  );
}

function SGRow({
  label,
  value,
  primary
}: {
  label: string;
  value: number;
  primary?: boolean;
}) {
  const pos = value >= 0;
  const headlineSize = primary ? '1.5rem' : '1.05rem';
  const labelWeight = primary ? 700 : 500;
  return (
    <Stack direction="row" justifyContent="space-between" alignItems="baseline">
      <Typography variant={primary ? 'subtitle1' : 'body2'} sx={{ fontWeight: labelWeight }}>
        {label}
      </Typography>
      <Box
        sx={{
          fontSize: headlineSize,
          fontWeight: primary ? 800 : 600,
          color: pos ? 'success.light' : 'warning.light',
          lineHeight: 1
        }}
      >
        {pos ? '+' : ''}
        {value.toFixed(2)}
      </Box>
    </Stack>
  );
}
