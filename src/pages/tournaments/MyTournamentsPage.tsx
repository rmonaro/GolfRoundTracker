import { useState } from 'react';
import dayjs from 'dayjs';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Divider,
  Stack,
  Typography
} from '@mui/material';
import EmojiEventsRoundedIcon from '@mui/icons-material/EmojiEventsRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import LockClockRoundedIcon from '@mui/icons-material/LockClockRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import VerifiedRoundedIcon from '@mui/icons-material/VerifiedRounded';
import VisibilityRoundedIcon from '@mui/icons-material/VisibilityRounded';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { useMyTournaments } from '@/features/tournaments/useMyTournaments';
import { useTournamentCourse } from '@/features/tournaments/useTournamentCourse';
import { fmtToPar, localRoundFor } from '@/features/tournaments/tournamentProgress';
import { useStartRound } from '@/features/round/useStartRound';
import { useRounds } from '@/features/stats/useRounds';
import { useRoundStore } from '@/stores/roundStore';
import type { RoundRow } from '@/types/database';
import { watchBridge } from '@/services/watchBridge';
import { toAppError } from '@/services/errors';
import type {
  TmRound,
  TmTournamentEntry
} from '@/services/tmIntegration/types';

export function MyTournamentsPage() {
  const { data, isLoading, isError, error, refetch, isFetching } = useMyTournaments();
  const tournaments = data?.tournaments ?? [];

  return (
    <Box>
      <PageHeader
        title="My Tournaments"
        subtitle="Your registered events from Tournament Management"
        back="/"
        action={
          <Button
            size="small"
            startIcon={<RefreshRoundedIcon />}
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? '…' : 'Refresh'}
          </Button>
        }
      />
      <Stack spacing={2} px={2} pb={4}>
        {isError && (
          <Alert severity="error">{toAppError(error).message}</Alert>
        )}

        {isLoading && (
          <Stack alignItems="center" py={6}>
            <CircularProgress />
          </Stack>
        )}

        {!isLoading && tournaments.length === 0 && !isError && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
            <CardContent>
              <Stack alignItems="center" spacing={1.5} py={3}>
                <Box
                  sx={{
                    width: 64,
                    height: 64,
                    borderRadius: '50%',
                    bgcolor: 'action.hover',
                    display: 'grid',
                    placeItems: 'center'
                  }}
                >
                  <EmojiEventsRoundedIcon sx={{ fontSize: 32, color: 'text.secondary' }} />
                </Box>
                <Typography variant="h6">No tournaments yet</Typography>
                <Typography variant="body2" color="text.secondary" align="center">
                  When you register for an event in Tournament Management with this
                  account&apos;s email, it shows up here.
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        )}

        {tournaments.map((t) => (
          <TournamentCard key={t.registration_id} entry={t} />
        ))}
      </Stack>
    </Box>
  );
}

function TournamentCard({ entry }: { entry: TmTournamentEntry }) {
  const { tournament, division, rounds } = entry;
  const { course, ensureCourse, isImporting, isLoadingCourses } = useTournamentCourse(
    tournament.external_course_id
  );
  // Local recorded rounds are authoritative for completion/score — the final
  // SUBMITTED push to TM is best-effort and may not have landed.
  const { data: localRounds } = useRounds();

  return (
    <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
      <CardContent>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" noWrap>
              {tournament.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {tournament.course_name ?? 'Course TBD'}
              {division ? ` · ${division.name}` : ''}
            </Typography>
          </Box>
          <Chip
            size="small"
            label={tournament.status.replace(/_/g, ' ')}
            color={tournament.status === 'IN_PROGRESS' ? 'primary' : 'default'}
            variant="outlined"
          />
        </Stack>

        {/* Course match status — both apps key off the GolfCourseAPI id. */}
        <Box sx={{ mt: 1 }}>
          {tournament.external_course_id == null ? (
            <Typography variant="caption" color="text.secondary">
              No course linked on the tournament yet.
            </Typography>
          ) : course ? (
            <Chip
              size="small"
              icon={<VerifiedRoundedIcon sx={{ fontSize: 14 }} />}
              color="success"
              variant="outlined"
              label="Course in your library"
              sx={{ height: 22 }}
            />
          ) : isLoadingCourses ? (
            <Typography variant="caption" color="text.secondary">
              Checking your course library…
            </Typography>
          ) : (
            <Typography variant="caption" color="text.secondary">
              Course will be added from GolfCourseAPI on start.
            </Typography>
          )}
        </Box>

        <Divider sx={{ my: 1.5 }} />

        <Stack spacing={1.5}>
          {rounds.map((r) => (
            <RoundRow
              key={r.round_number}
              entry={entry}
              round={r}
              localRound={localRoundFor(localRounds, entry.registration_id, r.round_number)}
              ensureCourse={ensureCourse}
              hasCourse={!!course}
              isImporting={isImporting}
            />
          ))}
        </Stack>
      </CardContent>
    </Card>
  );
}

function RoundRow({
  entry,
  round,
  localRound,
  ensureCourse,
  isImporting
}: {
  entry: TmTournamentEntry;
  round: TmRound;
  localRound: RoundRow | null;
  ensureCourse: () => Promise<import('@/models').Course | null>;
  hasCourse: boolean;
  isImporting: boolean;
}) {
  const navigate = useNavigate();
  const startRound = useStartRound();
  const active = useRoundStore((s) => s.active);
  const [error, setError] = useState<string | null>(null);

  // Is THIS tournament round the one already in progress locally?
  const isActiveHere =
    !!active &&
    active.tmRegistrationId === entry.registration_id &&
    active.tmRoundNumber === round.round_number;
  // A different round is mid-play — block starting a new one until it's done.
  const otherActive = !!active && !isActiveHere;

  const teeLabel = round.tee_time
    ? dayjs(round.tee_time).format('ddd MMM D · h:mm A')
    : 'Tee time TBD';

  const gateReason =
    round.can_start_reason === 'before_tee_time'
      ? `Starts ${teeLabel}`
      : round.can_start_reason === 'no_tee_time'
        ? 'Tee time not set yet'
        : null;

  // Completion is driven by the locally-recorded round first (its completed_at),
  // falling back to TM's SUBMITTED status. This is what stops a finished round
  // from offering "Resume" and re-creating itself from scratch.
  const locallyComplete = !!localRound?.completed_at;
  const alreadySubmitted = round.scorecard?.status === 'SUBMITTED';
  const isComplete = locallyComplete || alreadySubmitted;
  // Prefer the local round id for review (always present + has recorded holes);
  // fall back to the TM scorecard's linked round id.
  const reviewRoundId = localRound?.id ?? round.scorecard?.round_tracking_round_id ?? null;
  // A GRT round has already been started + linked for this tournament round
  // (scorecard carries our round id) and isn't submitted → this is a RESUME,
  // not a fresh start. handleStart resolves the existing round from the DB.
  const hasLinkedRound =
    !!round.scorecard?.round_tracking_round_id && !isComplete;

  const handleStart = async () => {
    setError(null);
    try {
      const course = await ensureCourse();
      if (!course) {
        setError('Could not resolve this tournament’s course.');
        return;
      }
      await startRound.mutateAsync({
        course: {
          id: course.id,
          name: course.name,
          teeBox: course.tee_box,
          courseRating: course.course_rating,
          slopeRating: course.slope_rating,
          totalPar: course.total_par ?? 72,
          totalYardage: course.total_yardage
        },
        holesPlayed: 18,
        tm: {
          registrationId: entry.registration_id,
          roundNumber: round.round_number,
          tournamentSlug: entry.tournament.slug,
          startingHole: round.starting_hole
        }
      });
      void watchBridge.launchWatch(false);
      navigate('/round/play', { replace: true });
    } catch (err) {
      setError(toAppError(err).message);
    }
  };

  return (
    <Box>
      <Stack direction="row" alignItems="center" justifyContent="space-between" spacing={1}>
        <Box sx={{ minWidth: 0 }}>
          <Typography variant="subtitle2">
            Round {round.round_number}
            {round.starting_hole ? ` · Hole ${round.starting_hole} start` : ''}
          </Typography>
          <Typography variant="caption" color="text.secondary" display="block">
            {teeLabel}
            {round.scorecard && round.scorecard.holes_completed
              ? ` · ${round.scorecard.holes_completed} holes in`
              : ''}
          </Typography>
          {locallyComplete && (
            <Typography variant="caption" color="success.main" display="block" sx={{ fontWeight: 600 }}>
              Final {fmtToPar(localRound!.score_vs_par) ?? '—'} · {localRound!.score} strokes
            </Typography>
          )}
        </Box>

        {isComplete ? (
          reviewRoundId ? (
            <Button
              variant="outlined"
              size="small"
              color="success"
              startIcon={<VisibilityRoundedIcon />}
              onClick={() => navigate(`/round/summary/${reviewRoundId}`)}
            >
              Review
            </Button>
          ) : (
            <Chip size="small" color="success" label="Complete" variant="outlined" />
          )
        ) : isActiveHere ? (
          <Button
            variant="contained"
            size="small"
            startIcon={<PlayArrowRoundedIcon />}
            onClick={() => navigate('/round/play')}
          >
            Resume
          </Button>
        ) : hasLinkedRound ? (
          // Round already started elsewhere (or local store was cleared) —
          // handleStart resumes it from the DB rather than creating a new one.
          <Button
            variant="contained"
            size="small"
            startIcon={<PlayArrowRoundedIcon />}
            disabled={startRound.isPending || isImporting}
            onClick={handleStart}
          >
            {startRound.isPending || isImporting ? 'Resuming…' : 'Resume'}
          </Button>
        ) : (
          <Button
            variant="contained"
            size="small"
            startIcon={
              round.can_start ? <PlayArrowRoundedIcon /> : <LockClockRoundedIcon />
            }
            disabled={
              !round.can_start || otherActive || startRound.isPending || isImporting
            }
            onClick={handleStart}
          >
            {startRound.isPending || isImporting ? 'Starting…' : 'Start'}
          </Button>
        )}
      </Stack>

      {/* Why Start is locked. can_start is authoritative (now ≥ tee_time on TM). */}
      {!round.can_start && !isActiveHere && !isComplete && !hasLinkedRound && gateReason && (
        <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
          🔒 {gateReason}
        </Typography>
      )}
      {otherActive && round.can_start && !isComplete && !hasLinkedRound && (
        <Typography variant="caption" color="warning.main" sx={{ mt: 0.5, display: 'block' }}>
          Finish your active round before starting this one.
        </Typography>
      )}
      {error && (
        <Alert severity="error" sx={{ mt: 1 }}>
          {error}
        </Alert>
      )}
    </Box>
  );
}
