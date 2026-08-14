import { Box, ButtonBase, Card, Skeleton, Stack, Typography } from '@mui/material';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useNavigate } from 'react-router-dom';
import { brand } from '@/theme/theme';
import { trackFill } from '@/theme/designTokens';
import type { AggregatedStats } from '@/features/stats/computeStats';

interface GameStatsCardProps {
  stats: AggregatedStats;
  /** Hole-level rows still in flight — fairways, GIR and putts aren't known yet. */
  isLoadingHoles?: boolean;
}

interface Cell {
  label: string;
  value: string;
  /** Small qualifier beside the number, e.g. "gross". */
  note?: string;
  color?: string;
  /** 0-100 — renders a progress track under the value. */
  bar?: number | null;
  pending?: boolean;
}

/**
 * The six numbers that describe a player's game.
 *
 * Two-up grid of hairline-separated cells, per the Home Screen design: the
 * 1px grid gap over a divider-colored background draws the separators, so the
 * cells themselves stay plain surfaces.
 */
export function GameStatsCard({ stats, isLoadingHoles }: GameStatsCardProps) {
  const navigate = useNavigate();

  const cells: Cell[] = [
    { label: 'Avg Score', value: fmt1(stats.averageScore), note: 'gross' },
    {
      label: 'Best Score',
      value: stats.bestScore != null ? String(stats.bestScore) : '—',
      color: stats.bestScore != null ? 'success.main' : undefined
    },
    {
      label: 'Avg vs Par',
      value: fmtVsPar(stats.averageScoreVsPar),
      // Under par is the standout case and takes the success green; over par
      // takes the design's warning amber.
      color:
        stats.averageScoreVsPar == null
          ? undefined
          : stats.averageScoreVsPar <= 0
            ? 'success.main'
            : 'warning.main'
    },
    { label: 'Putts/Rd', value: fmt1(stats.puttsPerRound), pending: isLoadingHoles },
    {
      label: 'Fairways',
      value: fmtPct(stats.fairwaysHitPct),
      bar: stats.fairwaysHitPct,
      pending: isLoadingHoles
    },
    { label: 'GIR', value: fmtPct(stats.girPct), bar: stats.girPct, pending: isLoadingHoles }
  ];

  return (
    <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px', overflow: 'hidden' }}>
      <Stack
        direction="row"
        alignItems="center"
        justifyContent="space-between"
        spacing={1.5}
        sx={{ px: 2, py: 1.75, borderBottom: '1px solid', borderColor: 'divider' }}
      >
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ textTransform: 'uppercase', letterSpacing: '0.6px' }}
        >
          Your Game
        </Typography>
        <ButtonBase
          onClick={() => navigate('/stats')}
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            color: 'primary.main',
            fontSize: '0.85rem',
            fontWeight: 600,
            borderRadius: '5px',
            px: 0.5,
            py: 0.25
          }}
        >
          All Stats
          <ChevronRightRoundedIcon sx={{ fontSize: 18 }} />
        </ButtonBase>
      </Stack>

      {/* 1px gap over a divider-colored ground = the cell separators. */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '1px',
          bgcolor: 'divider'
        }}
      >
        {cells.map((cell) => (
          <Stack
            key={cell.label}
            spacing={0.75}
            sx={{ bgcolor: 'background.paper', px: 2, py: 1.75, minHeight: 84, minWidth: 0 }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}
              noWrap
            >
              {cell.label}
            </Typography>

            {cell.pending ? (
              <Skeleton variant="text" width="55%" sx={{ fontSize: '1.75rem' }} />
            ) : (
              <Stack direction="row" alignItems="baseline" spacing={0.75} sx={{ minWidth: 0 }}>
                <Typography
                  sx={{
                    fontSize: '1.75rem',
                    fontWeight: 700,
                    lineHeight: 1,
                    color: cell.color ?? 'text.primary'
                  }}
                  noWrap
                >
                  {cell.value}
                </Typography>
                {cell.note && (
                  <Typography variant="caption" color="text.disabled" sx={{ fontSize: '0.75rem' }}>
                    {cell.note}
                  </Typography>
                )}
              </Stack>
            )}

            {cell.bar != null && !cell.pending && (
              <Box
                sx={(theme) => ({
                  height: 4,
                  borderRadius: '999px',
                  bgcolor: trackFill(theme.palette.mode),
                  overflow: 'hidden'
                })}
              >
                <Box
                  sx={{
                    height: '100%',
                    width: `${Math.min(100, Math.max(0, cell.bar ?? 0))}%`,
                    bgcolor: brand[500],
                    borderRadius: '999px'
                  }}
                />
              </Box>
            )}
          </Stack>
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
