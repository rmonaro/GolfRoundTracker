import { Fragment, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Divider,
  IconButton,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import KeyboardArrowDownRoundedIcon from '@mui/icons-material/KeyboardArrowDownRounded';
import KeyboardArrowRightRoundedIcon from '@mui/icons-material/KeyboardArrowRightRounded';
import { useQuery } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router-dom';
import { adminRoundsRepo, computeRoundHoleTotals } from '@/services/adminRoundsRepo';
import { roundRepo } from '@/services/roundRepo';
import type { RoundHole, Shot } from '@/models';

function fmtVsPar(v: number | null | undefined): string {
  if (v == null) return '—';
  if (v === 0) return 'E';
  return v > 0 ? `+${v}` : `${v}`;
}

function fairwayLabel(par: number, result: string | null): string {
  if (par === 3) return '—'; // no fairway on par 3s
  if (!result || result === 'na') return '—';
  return result.charAt(0).toUpperCase() + result.slice(1);
}

function shotOutcome(s: Shot): string {
  if (s.target_type || s.target_result) {
    return [s.target_type, s.target_result].filter(Boolean).join(' · ');
  }
  return s.shot_result ?? '—';
}

export function AdminRoundDetail() {
  const { roundId } = useParams<{ roundId: string }>();
  const navigate = useNavigate();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const roundQuery = useQuery({
    queryKey: ['admin-round', roundId],
    queryFn: () => adminRoundsRepo.getOne(roundId!),
    enabled: !!roundId
  });
  const holesQuery = useQuery({
    queryKey: ['admin-round-holes', roundId],
    queryFn: () => roundRepo.listHoles(roundId!),
    enabled: !!roundId
  });
  const shotsQuery = useQuery({
    queryKey: ['admin-round-shots', roundId],
    queryFn: () => roundRepo.listShots(roundId!),
    enabled: !!roundId
  });
  const clubsQuery = useQuery({
    queryKey: ['admin-clubs-map'],
    queryFn: () => adminRoundsRepo.clubsMap(),
    staleTime: 5 * 60 * 1000
  });

  if (roundQuery.isLoading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const round = roundQuery.data;
  if (!round) {
    return (
      <Box sx={{ p: 2 }}>
        <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => navigate(-1)}>
          Back
        </Button>
        <Typography sx={{ mt: 2 }}>Round not found.</Typography>
      </Box>
    );
  }

  const clubs = clubsQuery.data ?? {};
  const clubName = (id: string | null) => (id ? clubs[id] ?? id : '—');
  const holes = holesQuery.data ?? [];
  const totals = holes.length > 0 ? computeRoundHoleTotals(holes) : null;
  const shotsByHole = new Map<string, Shot[]>();
  for (const s of shotsQuery.data ?? []) {
    const arr = shotsByHole.get(s.hole_id) ?? [];
    arr.push(s);
    shotsByHole.set(s.hole_id, arr);
  }

  const toggle = (id: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const renderShots = (hole: RoundHole) => {
    const shots = shotsByHole.get(hole.id) ?? [];
    if (shots.length === 0) {
      return (
        <Typography variant="body2" color="text.secondary" sx={{ py: 1, px: 2 }}>
          No shot-level data recorded for this hole.
        </Typography>
      );
    }
    return (
      <Table size="small" sx={{ bgcolor: 'action.hover' }}>
        <TableHead>
          <TableRow>
            <TableCell>#</TableCell>
            <TableCell>Club</TableCell>
            <TableCell>Outcome</TableCell>
            <TableCell>Lie</TableCell>
            <TableCell align="right">Distance</TableCell>
            <TableCell>Penalty</TableCell>
            <TableCell>Notes</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {shots.map((s) => (
            <TableRow key={s.id}>
              <TableCell>{s.shot_number}</TableCell>
              <TableCell>{clubName(s.club_id)}</TableCell>
              <TableCell>{shotOutcome(s)}</TableCell>
              <TableCell>{s.lie ?? '—'}</TableCell>
              <TableCell align="right">
                {s.distance != null ? `${s.distance} ${s.distance_unit ?? ''}`.trim() : '—'}
              </TableCell>
              <TableCell>{s.penalty_type ?? '—'}</TableCell>
              <TableCell>{s.notes ?? '—'}</TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    );
  };

  return (
    <Box sx={{ p: 2 }}>
      <Button startIcon={<ArrowBackRoundedIcon />} onClick={() => navigate(-1)} sx={{ mb: 1 }}>
        Back
      </Button>

      <Typography variant="h5" sx={{ fontWeight: 700 }}>
        {round.course_name || 'Round'}
      </Typography>
      <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap sx={{ mt: 0.5, alignItems: 'center' }}>
        <Typography variant="body2" color="text.secondary">
          {round.player_name}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {round.started_at ? new Date(round.started_at).toLocaleString() : '—'}
        </Typography>
        <Chip
          size="small"
          label={round.completed_at ? 'Completed' : 'In progress'}
          color={round.completed_at ? 'success' : 'warning'}
        />
      </Stack>
      <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap sx={{ mt: 1.5 }}>
        <Stat label="Holes" value={String(totals?.holesPlayed ?? round.holes_played ?? '—')} />
        <Stat label="Score" value={fmtVsPar(totals ? totals.scoreVsPar : round.score_vs_par)} />
        <Stat label="Strokes" value={String(totals?.score ?? round.score ?? '—')} />
        <Stat label="Par" value={String(totals?.par ?? round.par ?? '—')} />
        {round.estimated_handicap != null && (
          <Stat label="Est. handicap" value={String(round.estimated_handicap)} />
        )}
      </Stack>
      {!round.completed_at && totals && totals.holesPlayed > 0 && (
        <Typography variant="caption" color="text.secondary">
          Running total through {totals.holesPlayed} hole{totals.holesPlayed === 1 ? '' : 's'} played.
        </Typography>
      )}

      <Divider sx={{ my: 2 }} />

      <Typography variant="subtitle1" sx={{ fontWeight: 700, mb: 1 }}>
        Hole-by-hole
      </Typography>
      {holesQuery.isLoading ? (
        <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
          <CircularProgress />
        </Box>
      ) : holes.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          No hole data recorded for this round.
        </Typography>
      ) : (
        <Box sx={{ overflowX: 'auto' }}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell padding="checkbox" />
                <TableCell>Hole</TableCell>
                <TableCell align="right">Par</TableCell>
                <TableCell align="right">Yards</TableCell>
                <TableCell align="right">Strokes</TableCell>
                <TableCell align="right">Putts</TableCell>
                <TableCell>Fairway</TableCell>
                <TableCell>GIR</TableCell>
                <TableCell>Sand</TableCell>
                <TableCell align="right">Pen.</TableCell>
                <TableCell>Clubs</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {holes.map((h) => {
                const isOpen = expanded.has(h.id);
                const shotCount = shotsByHole.get(h.id)?.length ?? 0;
                return (
                  <Fragment key={h.id}>
                    <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => toggle(h.id)}>
                      <TableCell padding="checkbox">
                        <IconButton size="small" aria-label="Toggle shots">
                          {isOpen ? (
                            <KeyboardArrowDownRoundedIcon fontSize="small" />
                          ) : (
                            <KeyboardArrowRightRoundedIcon fontSize="small" />
                          )}
                        </IconButton>
                      </TableCell>
                      <TableCell sx={{ fontWeight: 600 }}>{h.hole_number}</TableCell>
                      <TableCell align="right">{h.par}</TableCell>
                      <TableCell align="right">{h.yardage ?? '—'}</TableCell>
                      <TableCell align="right">{h.strokes}</TableCell>
                      <TableCell align="right">{h.putts}</TableCell>
                      <TableCell>{fairwayLabel(h.par, h.fairway_result)}</TableCell>
                      <TableCell>{h.gir ? 'Yes' : 'No'}</TableCell>
                      <TableCell>{h.sand ? 'Yes' : 'No'}</TableCell>
                      <TableCell align="right">{h.penalty_strokes || 0}</TableCell>
                      <TableCell>
                        {h.clubs_used.length > 0
                          ? h.clubs_used.map((id) => clubName(id)).join(', ')
                          : '—'}
                      </TableCell>
                    </TableRow>
                    <TableRow>
                      <TableCell sx={{ py: 0, border: 0 }} colSpan={11}>
                        <Collapse in={isOpen} timeout="auto" unmountOnExit>
                          <Box sx={{ py: 1 }}>
                            <Typography variant="caption" color="text.secondary" sx={{ px: 2 }}>
                              {shotCount} shot{shotCount === 1 ? '' : 's'}
                            </Typography>
                            {renderShots(h)}
                          </Box>
                        </Collapse>
                      </TableCell>
                    </TableRow>
                  </Fragment>
                );
              })}
            </TableBody>
          </Table>
        </Box>
      )}
    </Box>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography variant="caption" color="text.secondary" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
        {label}
      </Typography>
      <Typography variant="h6" sx={{ fontWeight: 800, lineHeight: 1.1 }}>
        {value}
      </Typography>
    </Box>
  );
}
