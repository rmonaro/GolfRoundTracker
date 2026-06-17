import { Chip, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import type { Round } from '@/models';

type RoundRowLike = Round & { player_name?: string };

interface RoundsTableProps {
  rounds: RoundRowLike[];
  /** Show a leading Player column (used by the global rounds view). */
  showPlayer?: boolean;
  onRowClick?: (round: RoundRowLike) => void;
}

function fmtVsPar(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v === 0) return 'E';
  return v > 0 ? `+${v}` : `${v}`;
}

export function RoundsTable({ rounds, showPlayer = false, onRowClick }: RoundsTableProps) {
  if (rounds.length === 0) {
    return (
      <Typography variant="body2" color="text.secondary" sx={{ py: 2 }}>
        No rounds yet.
      </Typography>
    );
  }

  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          {showPlayer && <TableCell>Player</TableCell>}
          <TableCell>Course</TableCell>
          <TableCell>Date</TableCell>
          <TableCell align="right">Holes</TableCell>
          <TableCell align="right">Strokes</TableCell>
          <TableCell align="right">Score</TableCell>
          <TableCell>Status</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rounds.map((r) => (
          <TableRow
            key={r.id}
            hover={Boolean(onRowClick)}
            onClick={() => onRowClick?.(r)}
            sx={{ cursor: onRowClick ? 'pointer' : 'default' }}
          >
            {showPlayer && <TableCell sx={{ fontWeight: 600 }}>{r.player_name ?? '—'}</TableCell>}
            <TableCell>{r.course_name || '—'}</TableCell>
            <TableCell sx={{ whiteSpace: 'nowrap' }}>
              {r.started_at ? new Date(r.started_at).toLocaleDateString() : '—'}
            </TableCell>
            <TableCell align="right">{r.holes_played ?? '—'}</TableCell>
            <TableCell align="right">{r.score ?? '—'}</TableCell>
            <TableCell align="right" sx={{ fontWeight: 600 }}>{fmtVsPar(r.score_vs_par)}</TableCell>
            <TableCell>
              <Chip
                size="small"
                label={r.completed_at ? 'Completed' : 'In progress'}
                color={r.completed_at ? 'success' : 'warning'}
              />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
