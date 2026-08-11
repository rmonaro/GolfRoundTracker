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
import AssignmentIndRoundedIcon from '@mui/icons-material/AssignmentIndRounded';
import GroupsRoundedIcon from '@mui/icons-material/GroupsRounded';
import LockClockRoundedIcon from '@mui/icons-material/LockClockRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import CloudOffRoundedIcon from '@mui/icons-material/CloudOffRounded';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '@/components/layout/PageHeader';
import { useScorerAssignmentsWithFallback } from '@/features/tournaments/useScorerAssignments';
import { useTournamentCourse } from '@/features/tournaments/useTournamentCourse';
import { useScorerGroupRounds } from '@/features/tournaments/useScorerGroupRounds';
import { useRoundStore } from '@/stores/roundStore';
import { toAppError } from '@/services/errors';
import type { TmScorerAssignment } from '@/services/tmIntegration/types';

export function ScorerAssignmentsPage() {
  const { assignments, isLoading, isError, error, refetch, isFetching, isStale } =
    useScorerAssignmentsWithFallback();

  return (
    <Box>
      <PageHeader
        title="Scoring"
        subtitle="Tee groups you've been assigned to score"
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
        {isStale && (
          <Alert severity="info" icon={<CloudOffRoundedIcon />}>
            Showing your last downloaded groups — tee times may have changed.
          </Alert>
        )}
        {isError && <Alert severity="error">{toAppError(error).message}</Alert>}

        {isLoading && (
          <Stack alignItems="center" py={6}>
            <CircularProgress />
          </Stack>
        )}

        {!isLoading && assignments.length === 0 && !isError && (
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
                  <AssignmentIndRoundedIcon sx={{ fontSize: 32, color: 'text.secondary' }} />
                </Box>
                <Typography variant="h6">Nothing to score</Typography>
                <Typography variant="body2" color="text.secondary" align="center">
                  When a tournament admin assigns you to a tee group using this
                  account&apos;s email, the group shows up here.
                </Typography>
              </Stack>
            </CardContent>
          </Card>
        )}

        {assignments.map((a) => (
          <AssignmentCard key={a.tee_group_id} assignment={a} />
        ))}
      </Stack>
    </Box>
  );
}

function AssignmentCard({ assignment }: { assignment: TmScorerAssignment }) {
  const navigate = useNavigate();
  const { tournament, players } = assignment;
  const { course, ensureCourse, isImporting, isLoadingCourses } = useTournamentCourse(
    tournament.external_course_id
  );
  const openGroup = useScorerGroupRounds();
  // Gate on hydration. Before the IndexedDB read settles the store looks empty,
  // so an already-open group reads as closed — and tapping Start would rebuild
  // it from the SERVER, discarding any shots that hadn't synced yet.
  const hydrated = useRoundStore((s) => s.hydrated);
  const active = useRoundStore((s) => s.active);
  const parked = useRoundStore((s) => s.parked);
  const [error, setError] = useState<string | null>(null);

  // Is this group already open? Any live round carrying its tee group id counts.
  const isOpen =
    active?.teeGroupId === assignment.tee_group_id ||
    Object.values(parked).some((r) => r.teeGroupId === assignment.tee_group_id);
  // A different round is mid-play — finish it before opening a group, or the
  // scorer would be tracking their own round and four others at once.
  const otherActive = !!active && !isOpen;

  const teeLabel = assignment.tee_time
    ? dayjs(assignment.tee_time).format('ddd MMM D · h:mm A')
    : 'Tee time TBD';

  const gateReason =
    assignment.can_start_reason === 'before_tee_time'
      ? `Starts ${teeLabel}`
      : assignment.can_start_reason === 'no_tee_time'
        ? 'Tee time not set yet'
        : null;

  const handleOpen = async () => {
    setError(null);
    if (isOpen) {
      navigate(`/scoring/${assignment.tee_group_id}`);
      return;
    }
    try {
      const resolved = await ensureCourse();
      if (!resolved) {
        setError('Could not resolve this tournament’s course.');
        return;
      }
      await openGroup.mutateAsync({ assignment, course: resolved });
      navigate(`/scoring/${assignment.tee_group_id}`);
    } catch (err) {
      setError(toAppError(err).message);
    }
  };

  const busy = openGroup.isPending || isImporting || !hydrated;

  return (
    <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
      <CardContent>
        <Stack direction="row" alignItems="flex-start" justifyContent="space-between" spacing={1}>
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" noWrap>
              {tournament.name}
            </Typography>
            <Typography variant="body2" color="text.secondary" noWrap>
              {tournament.course_name ?? 'Course TBD'} · Round {assignment.round_number}
            </Typography>
          </Box>
          <Chip
            size="small"
            icon={<GroupsRoundedIcon sx={{ fontSize: 14 }} />}
            label={`${players.length}`}
            variant="outlined"
          />
        </Stack>

        <Typography variant="caption" color="text.secondary" display="block" sx={{ mt: 0.5 }}>
          {teeLabel}
          {assignment.starting_hole ? ` · Hole ${assignment.starting_hole} start` : ''}
        </Typography>

        {tournament.external_course_id != null && !course && !isLoadingCourses && (
          <Typography variant="caption" color="text.secondary" display="block">
            Course will be added from GolfCourseAPI when you open the group.
          </Typography>
        )}

        <Divider sx={{ my: 1.5 }} />

        <Stack spacing={0.75}>
          {players.map((p) => (
            <Stack
              key={p.registration_id}
              direction="row"
              alignItems="center"
              spacing={1}
              sx={{ minWidth: 0 }}
            >
              <Box
                sx={{
                  width: 20,
                  height: 20,
                  borderRadius: '6px',
                  bgcolor: 'action.hover',
                  display: 'grid',
                  placeItems: 'center',
                  flexShrink: 0
                }}
              >
                <Typography variant="caption" sx={{ fontWeight: 700, fontSize: 10 }}>
                  {p.position}
                </Typography>
              </Box>
              <Typography variant="body2" noWrap sx={{ flex: 1, minWidth: 0 }}>
                {p.first_name} {p.last_name}
              </Typography>
              {p.division && (
                <Typography variant="caption" color="text.secondary" noWrap>
                  {p.division.name}
                </Typography>
              )}
            </Stack>
          ))}
          {players.length === 0 && (
            <Typography variant="body2" color="text.secondary">
              No players in this group yet.
            </Typography>
          )}
        </Stack>

        <Box sx={{ mt: 2 }}>
          <Button
            fullWidth
            variant="contained"
            startIcon={
              assignment.can_start || isOpen ? <PlayArrowRoundedIcon /> : <LockClockRoundedIcon />
            }
            disabled={(!assignment.can_start && !isOpen) || otherActive || busy || !players.length}
            onClick={handleOpen}
          >
            {!hydrated
              ? 'Checking…'
              : busy
                ? 'Opening…'
                : isOpen
                  ? 'Resume scoring'
                  : 'Start scoring'}
          </Button>
        </Box>

        {!assignment.can_start && !isOpen && gateReason && (
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            🔒 {gateReason}
          </Typography>
        )}
        {otherActive && (
          <Typography variant="caption" color="warning.main" sx={{ mt: 0.5, display: 'block' }}>
            Finish your active round before opening a group to score.
          </Typography>
        )}
        {error && (
          <Alert severity="error" sx={{ mt: 1 }}>
            {error}
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
