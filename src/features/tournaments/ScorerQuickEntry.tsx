// Quick entry — the whole group on one hole, one tap per player.
//
// A scorekeeper walking with 2-4 players cannot always stop to record club, lie
// and landing position for every shot. This is the fallback that keeps the
// leaderboard correct when there's no time for detail: strokes, putts, penalty.
//
// It writes the SAME rows the detailed path does (round_holes.strokes/putts/
// penalty_strokes), so a hole entered quickly can have its shot detail filled in
// later from the map without re-entering anything.

import { Box, IconButton, Paper, Stack, Typography } from '@mui/material';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import RemoveRoundedIcon from '@mui/icons-material/RemoveRounded';
import type { ActiveRound, LocalHole } from '@/stores/roundStore';

export interface QuickEntryChange {
  roundId: string;
  holeNumber: number;
  patch: Partial<Pick<LocalHole, 'strokes' | 'putts' | 'penaltyStrokes'>>;
}

function holeFor(round: ActiveRound, holeNumber: number): LocalHole | undefined {
  return round.holes.find((h) => h.holeNumber === holeNumber);
}

function Stepper({
  label,
  value,
  min = 0,
  onChange,
  disabled
}: {
  label: string;
  value: number;
  min?: number;
  onChange: (next: number) => void;
  disabled?: boolean;
}) {
  return (
    <Stack alignItems="center" spacing={0.25} sx={{ minWidth: 68 }}>
      <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
        {label}
      </Typography>
      <Stack direction="row" alignItems="center" spacing={0.25}>
        <IconButton
          size="small"
          aria-label={`Decrease ${label}`}
          disabled={disabled || value <= min}
          onClick={() => onChange(value - 1)}
          sx={{ p: 0.25 }}
        >
          <RemoveRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
        <Typography
          variant="body2"
          className="nums"
          sx={{ minWidth: 18, textAlign: 'center', fontWeight: 700 }}
        >
          {value}
        </Typography>
        <IconButton
          size="small"
          aria-label={`Increase ${label}`}
          disabled={disabled}
          onClick={() => onChange(value + 1)}
          sx={{ p: 0.25 }}
        >
          <AddRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
      </Stack>
    </Stack>
  );
}

export function ScorerQuickEntry({
  rounds,
  holeNumber,
  activeRoundId,
  onChange,
  onSelectPlayer
}: {
  /** Every player in the group, in tab order. */
  rounds: ActiveRound[];
  holeNumber: number;
  activeRoundId: string | null;
  onChange: (change: QuickEntryChange) => void;
  onSelectPlayer: (roundId: string) => void;
}) {
  return (
    <Stack spacing={1}>
      {rounds.map((r) => {
        const hole = holeFor(r, holeNumber);
        if (!hole) return null;
        // Shots recorded in detail are the source of truth for the stroke count;
        // once any exist, the stepper would fight the shot list, so it's locked
        // and the detailed view owns the hole.
        const shotCount = hole.shots.length;
        const detailed = shotCount > 0;
        const strokes = detailed ? shotCount : hole.strokes;

        return (
          <Paper
            key={r.roundId}
            elevation={0}
            onClick={() => onSelectPlayer(r.roundId)}
            sx={{
              p: 1.25,
              borderRadius: '5px',
              cursor: 'pointer',
              border: '1px solid',
              borderColor: r.roundId === activeRoundId ? 'primary.main' : 'divider',
              bgcolor: 'background.paper'
            }}
          >
            <Stack direction="row" alignItems="center" spacing={1}>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
                  {r.athleteName ?? 'Player'}
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  Par {hole.par}
                  {detailed ? ` · ${shotCount} shots recorded` : ''}
                </Typography>
              </Box>

              <Stack direction="row" spacing={0.5} onClick={(e) => e.stopPropagation()}>
                <Stepper
                  label="Score"
                  value={strokes}
                  disabled={detailed}
                  onChange={(next) =>
                    onChange({ roundId: r.roundId, holeNumber, patch: { strokes: next } })
                  }
                />
                <Stepper
                  label="Putts"
                  value={hole.putts}
                  onChange={(next) =>
                    onChange({ roundId: r.roundId, holeNumber, patch: { putts: next } })
                  }
                />
                <Stepper
                  label="Pen"
                  value={hole.penaltyStrokes}
                  onChange={(next) =>
                    onChange({ roundId: r.roundId, holeNumber, patch: { penaltyStrokes: next } })
                  }
                />
              </Stack>
            </Stack>

            {detailed && (
              <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
                Score comes from the recorded shots — open this player to edit them.
              </Typography>
            )}
          </Paper>
        );
      })}
    </Stack>
  );
}
