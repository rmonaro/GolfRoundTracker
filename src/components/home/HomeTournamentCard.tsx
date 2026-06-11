import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import EmojiEventsRoundedIcon from '@mui/icons-material/EmojiEventsRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import dayjs from 'dayjs';
import type { HomeTournamentSelection } from '@/features/tournaments/selectHomeTournament';
import type { TmRound } from '@/services/tmIntegration/types';
import type { RoundRow } from '@/types/database';
import {
  fmtToPar,
  isTmRoundComplete,
  isTmRoundInProgress,
  localRoundFor
} from '@/features/tournaments/tournamentProgress';

const fmtTee = (round: TmRound): string =>
  round.tee_time ? dayjs(round.tee_time).format('ddd MMM D · h:mm A') : 'Tee time TBD';

/**
 * One line per tournament round. Completion + score come from the locally
 * recorded round when available (authoritative), falling back to TM's
 * scorecard. Finished rounds read "Complete · score"; the in-progress round
 * shows its live score; not-yet-started rounds show their tee time.
 */
function RoundLine({ round, localRound }: { round: TmRound; localRound: RoundRow | null }) {
  const complete = isTmRoundComplete(round, localRound);
  const inProgress = isTmRoundInProgress(round, localRound);
  const sc = round.scorecard;

  // Prefer the recorded local score once the round is finished; otherwise lean
  // on TM's live scorecard totals.
  const toPar =
    complete && localRound?.completed_at != null
      ? fmtToPar(localRound.score_vs_par)
      : fmtToPar(sc?.to_par);

  let detail: string;
  let emphasize = false;
  if (complete) {
    detail = toPar ? `Complete · ${toPar}` : 'Complete';
  } else if (inProgress) {
    detail =
      (toPar ?? 'In progress') +
      (sc?.holes_completed != null ? ` · ${sc.holes_completed} holes in` : '');
    emphasize = true;
  } else {
    detail = fmtTee(round);
  }

  return (
    <Stack direction="row" alignItems="baseline" justifyContent="space-between" spacing={1}>
      <Typography variant="body2" sx={{ fontWeight: 600, flexShrink: 0 }}>
        Round {round.round_number}
      </Typography>
      <Typography
        variant="body2"
        noWrap
        sx={{ opacity: emphasize ? 1 : 0.85, fontWeight: emphasize ? 700 : 400 }}
      >
        {detail}
      </Typography>
    </Stack>
  );
}

/**
 * Home-screen banner that surfaces the player's live or upcoming tournament in
 * place of the "Start a Round" button. Lists every round with its score /
 * status, and the primary button starts or resumes the next actionable round.
 */
export function HomeTournamentCard({
  selection,
  localRounds,
  onClick
}: {
  selection: HomeTournamentSelection;
  localRounds?: RoundRow[];
  onClick: () => void;
}) {
  const { entry, round, isLive } = selection;
  const { tournament, division, rounds } = entry;

  const selectedLocal = localRoundFor(localRounds, entry.registration_id, round.round_number);
  const inProgress = isTmRoundInProgress(round, selectedLocal);
  const label = inProgress
    ? 'Tournament in progress'
    : isLive
      ? 'Tournament'
      : 'Upcoming tournament';

  const ctaLabel = inProgress ? 'Resume' : isLive ? 'Start Round' : 'View Tournament';
  const CtaIcon = inProgress || isLive ? PlayArrowRoundedIcon : VisibilityRoundedIcon;

  return (
    <Card
      elevation={0}
      sx={{
        background: 'linear-gradient(135deg, rgba(237,108,2,0.5), rgba(255,167,38,0.32))',
        borderRadius: '5px'
      }}
    >
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={0.75}>
          <EmojiEventsRoundedIcon sx={{ fontSize: 16 }} />
          <Typography variant="caption" sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}>
            {label}
          </Typography>
        </Stack>

        <Typography variant="h5" noWrap sx={{ mt: 0.25 }}>
          {tournament.name}
        </Typography>

        <Typography variant="body2" sx={{ opacity: 0.85 }} noWrap>
          {tournament.course_name ?? 'Course TBD'}
          {division ? ` · ${division.name}` : ''}
        </Typography>

        <Box sx={{ mt: 1 }}>
          <Stack spacing={0.5}>
            {rounds.map((r) => (
              <RoundLine
                key={r.round_number}
                round={r}
                localRound={localRoundFor(localRounds, entry.registration_id, r.round_number)}
              />
            ))}
          </Stack>
        </Box>

        <Button
          variant="contained"
          color={inProgress ? 'warning' : 'primary'}
          size="large"
          fullWidth
          startIcon={<CtaIcon />}
          sx={{ mt: 1.5, minHeight: 52, fontSize: '1.05rem', borderRadius: '5px' }}
          onClick={onClick}
        >
          {ctaLabel}
        </Button>
      </CardContent>
    </Card>
  );
}
