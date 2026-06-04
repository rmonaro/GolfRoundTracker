import { useMemo, useState } from 'react';
import { Box, Button, Chip, Collapse, Divider, Paper, Stack, Typography } from '@mui/material';
import type { SwingFeedback, SwingMetric } from '@/types/swing';
import { useClubNameLookup } from './useClubName';
import { SwingCard } from './SwingCard';

interface ClubGroup {
  clubId: string | null;
  swings: SwingMetric[];
  avgTempo: number;
  avgTransition: number;
  avgFinish: number;
  avgConsistency: number | null;
}

const avg = (nums: number[]) => (nums.length ? nums.reduce((a, b) => a + b, 0) / nums.length : 0);

function buildGroups(swings: SwingMetric[]): ClubGroup[] {
  const map = new Map<string | null, SwingMetric[]>();
  for (const s of swings) {
    const key = s.clubId ?? null;
    const arr = map.get(key);
    if (arr) arr.push(s);
    else map.set(key, [s]);
  }
  const groups = [...map.entries()].map(([clubId, gs]) => {
    const tempos = gs.map((s) => s.tempoRatio).filter((t) => t > 0);
    const cons = gs.map((s) => s.swingConsistencyScore).filter((v): v is number => v != null);
    return {
      clubId,
      swings: gs,
      avgTempo: avg(tempos),
      avgTransition: avg(gs.map((s) => s.transitionScore)),
      avgFinish: avg(gs.map((s) => s.finishStabilityScore)),
      avgConsistency: cons.length ? avg(cons) : null
    };
  });
  // Most-used club first; "No club" bucket last.
  return groups.sort((a, b) => {
    if (a.clubId === null) return 1;
    if (b.clubId === null) return -1;
    return b.swings.length - a.swings.length;
  });
}

/**
 * Groups a session's swings by the club used, showing per-club averages
 * (estimated/motion-based) with the ability to expand and view each swing.
 */
export function ClubGroups({
  swings,
  getFeedback
}: {
  swings: SwingMetric[];
  getFeedback: (swing: SwingMetric) => SwingFeedback[];
}) {
  const clubNameOf = useClubNameLookup();
  const groups = useMemo(() => buildGroups(swings), [swings]);

  if (groups.length === 0) {
    return (
      <Typography color="text.secondary" variant="body2">
        No swings to group.
      </Typography>
    );
  }

  return (
    <Stack spacing={1.5}>
      {groups.map((g) => (
        <ClubGroupCard
          key={g.clubId ?? 'none'}
          group={g}
          name={clubNameOf(g.clubId)}
          getFeedback={getFeedback}
        />
      ))}
    </Stack>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <Stack alignItems="center" sx={{ minWidth: 0 }}>
      <Typography variant="subtitle2" fontWeight={700}>
        {value}
      </Typography>
      <Typography variant="caption" color="text.secondary" noWrap>
        {label}
      </Typography>
    </Stack>
  );
}

function ClubGroupCard({
  group,
  name,
  getFeedback
}: {
  group: ClubGroup;
  name: string;
  getFeedback: (swing: SwingMetric) => SwingFeedback[];
}) {
  const [open, setOpen] = useState(false);
  const count = group.swings.length;

  return (
    <Paper variant="outlined" sx={{ p: 1.5, borderRadius: 0 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center">
        <Typography variant="subtitle1" fontWeight={800}>
          {name}
        </Typography>
        <Chip size="small" label={`${count} swing${count === 1 ? '' : 's'}`} />
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 1, mt: 1 }}>
        <MiniStat label="Tempo" value={group.avgTempo > 0 ? `${group.avgTempo.toFixed(1)}:1` : '—'} />
        <MiniStat label="Transition" value={`${Math.round(group.avgTransition)}`} />
        <MiniStat label="Finish" value={`${Math.round(group.avgFinish)}`} />
        <MiniStat
          label="Consistency"
          value={group.avgConsistency != null ? `${Math.round(group.avgConsistency)}` : '—'}
        />
      </Box>
      <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
        Averages · estimated, motion-based
      </Typography>

      <Button size="small" onClick={() => setOpen((v) => !v)} sx={{ mt: 0.5, px: 0, minWidth: 0 }}>
        {open ? 'Hide swings' : `View ${count} swing${count === 1 ? '' : 's'}`}
      </Button>

      <Collapse in={open} unmountOnExit>
        <Divider sx={{ my: 1 }} />
        <Stack spacing={1}>
          {group.swings.map((s) => (
            <SwingCard key={s.id} swing={s} feedback={getFeedback(s)} editable={false} square />
          ))}
        </Stack>
      </Collapse>
    </Paper>
  );
}
