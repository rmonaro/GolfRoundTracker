import { Box, Card, Skeleton, Stack, Typography } from '@mui/material';
import type { AggregatedStats } from '@/features/stats/computeStats';

interface GameStatsCardProps {
  stats: AggregatedStats;
  /** Completed rounds the figures are drawn from. */
  roundCount: number;
  /** Hole-level rows still in flight — fairways, GIR and putts aren't known yet. */
  isLoadingHoles?: boolean;
}

/**
 * The six numbers that describe a player's game, as one panel on Home.
 *
 * Laid out as a 3×2 grid of hairline-separated cells rather than six floating
 * cards: at this size the gaps between separate cards read as noise, and a
 * single bordered block keeps the whole set scannable as one thought.
 */
export function GameStatsCard({ stats, roundCount, isLoadingHoles }: GameStatsCardProps) {
  const cells: Array<{ label: string; value: string; color?: string; pending?: boolean }> = [
    { label: 'Avg Score', value: fmt1(stats.averageScore) },
    { label: 'Best Score', value: stats.bestScore != null ? String(stats.bestScore) : '—' },
    {
      label: 'Avg vs Par',
      value: fmtVsPar(stats.averageScoreVsPar),
      // Green only for the genuinely notable case of averaging at or under par.
      // Over par stays neutral: `warning` amber is a near-twin of the primary
      // orange in this theme, and flagging the normal outcome for most golfers
      // would read as an alert about nothing.
      color:
        stats.averageScoreVsPar != null && stats.averageScoreVsPar <= 0
          ? 'success.main'
          : undefined
    },
    { label: 'Fairways', value: fmtPct(stats.fairwaysHitPct), pending: isLoadingHoles },
    { label: 'GIR', value: fmtPct(stats.girPct), pending: isLoadingHoles },
    { label: 'Putts/Rd', value: fmt1(stats.puttsPerRound), pending: isLoadingHoles }
  ];

  return (
    <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px', overflow: 'hidden' }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        sx={{ px: 2, py: 1.5 }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ textTransform: 'uppercase', letterSpacing: 0.6, fontWeight: 700 }}
        >
          Your Game
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {roundCount === 1 ? '1 round' : `${roundCount} rounds`}
        </Typography>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          borderTop: '1px solid',
          borderColor: 'divider'
        }}
      >
        {cells.map((cell, i) => (
          <Box
            key={cell.label}
            sx={{
              px: 0.75,
              py: 1.75,
              textAlign: 'center',
              minWidth: 0,
              // Hairlines between cells only — the card edge supplies the rest.
              borderRight: i % 3 === 2 ? 0 : '1px solid',
              borderBottom: i < 3 ? '1px solid' : 0,
              borderColor: 'divider'
            }}
          >
            {cell.pending ? (
              <Skeleton variant="text" width="60%" sx={{ mx: 'auto', fontSize: '1.375rem' }} />
            ) : (
              <Typography
                sx={{
                  // Sized to the narrowest real case: three columns on a 390px
                  // screen still has to fit "102.5" and "+14.4" without clipping.
                  fontSize: '1.375rem',
                  fontWeight: 800,
                  lineHeight: 1.15,
                  color: cell.color ?? 'text.primary'
                }}
                noWrap
              >
                {cell.value}
              </Typography>
            )}
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                display: 'block',
                mt: 0.25,
                textTransform: 'uppercase',
                letterSpacing: 0.2,
                fontSize: '0.6rem',
                lineHeight: 1.25
              }}
            >
              {cell.label}
            </Typography>
          </Box>
        ))}
      </Box>
    </Card>
  );
}

const fmt1 = (n: number | null): string => (n == null ? '—' : n.toFixed(1));
const fmtPct = (n: number | null): string => (n == null ? '—' : `${n}%`);

/** Signed average against par: E, +2.4, -1.1. */
function fmtVsPar(n: number | null): string {
  if (n == null) return '—';
  if (n === 0) return 'E';
  return n > 0 ? `+${n.toFixed(1)}` : n.toFixed(1);
}
