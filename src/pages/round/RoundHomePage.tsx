import { useState } from 'react';
import dayjs from 'dayjs';
import {
  Alert,
  Box,
  Button,
  Card,
  CardActionArea,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography
} from '@mui/material';
import GolfCourseRoundedIcon from '@mui/icons-material/GolfCourseRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import HistoryRoundedIcon from '@mui/icons-material/HistoryRounded';
import EmojiEventsRoundedIcon from '@mui/icons-material/EmojiEventsRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { useRoundStore } from '@/stores/roundStore';
import { useAuthStore } from '@/stores/authStore';
import { tmLinksRepo } from '@/services/tmIntegration/tmLinksRepo';
import { useTournamentResumeReconcile } from '@/features/tournaments/useTournamentResumeReconcile';
import { useRounds } from '@/features/stats/useRounds';
import { scoreVsPar } from '@/utils/format';
import { computeCompletedTotals } from '@/features/round/computeRoundTotals';
import { roundRepo } from '@/services/roundRepo';

export function RoundHomePage() {
  const active = useRoundStore((s) => s.active);
  const endRound = useRoundStore((s) => s.endRound);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);
  const { data: rounds } = useRounds();
  const lastRound = (rounds ?? []).filter((r) => r.completed_at)[0];
  const [confirmDelete, setConfirmDelete] = useState(false);

  // If the active round is a tournament round, reconcile it against the DB so a
  // stale/empty local store (e.g. a duplicate round) is healed to the real one.
  useTournamentResumeReconcile();

  // When the active round is a tournament round, pull its TM link so the card
  // can show the tournament name + round number.
  const tmRegistrationId = active?.tmRegistrationId ?? null;
  const { data: tmLink } = useQuery({
    queryKey: ['tm', 'link', userId, tmRegistrationId],
    enabled: !!userId && !!tmRegistrationId,
    queryFn: () => tmLinksRepo.getByRegistration(userId!, tmRegistrationId!)
  });

  // Tombstones the active round: deletes the row in Supabase (schema cascade
  // drops round_holes + shots) and clears the local store so the resume card
  // disappears. Errors surface in the dialog instead of swallowing — the
  // user can retry or cancel and the local round stays intact.
  const deleteActive = useMutation({
    mutationFn: async (roundId: string) => roundRepo.deleteRound(roundId),
    onSuccess: () => {
      endRound();
      queryClient.invalidateQueries({ queryKey: ['rounds', userId] });
      setConfirmDelete(false);
    }
  });

  return (
    <Box>
      <PageHeader title="Round" subtitle="Start a new round or resume" />
      <Stack spacing={2} px={2} pb={3}>
        {active && (
          <Card
            elevation={0}
            sx={{
              bgcolor: 'background.paper',
              border: '1px solid',
              borderColor: 'primary.main',
              position: 'relative',
              borderRadius: '5px'
            }}
          >
            {/* Delete affordance — absolute-positioned over the card so the
                resume button stays the primary action. Confirmation dialog
                prevents accidental loss; only fully removes the round from
                Supabase + local store on confirm. */}
            <IconButton
              aria-label="delete active round"
              size="small"
              onClick={() => setConfirmDelete(true)}
              sx={{
                position: 'absolute',
                top: 6,
                right: 6,
                color: 'text.secondary'
              }}
            >
              <DeleteOutlineRoundedIcon fontSize="small" />
            </IconButton>
            <CardContent sx={{ pr: 5 }}>
              <Stack direction="row" alignItems="center" spacing={1}>
                <Typography
                  variant="caption"
                  color="primary"
                  sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
                >
                  Active Round
                </Typography>
                {active.tmRegistrationId && (
                  <Chip
                    size="small"
                    color="warning"
                    icon={<EmojiEventsRoundedIcon sx={{ fontSize: 14 }} />}
                    label="Tournament"
                    sx={{ height: 20, '.MuiChip-label': { px: 0.75, fontSize: '0.7rem' } }}
                  />
                )}
              </Stack>
              {active.tmRegistrationId && (tmLink?.tournament_name || active.tmRoundNumber != null) && (
                <Typography
                  variant="body2"
                  color="warning.main"
                  sx={{ fontWeight: 600, mt: 0.25 }}
                  noWrap
                >
                  {tmLink?.tournament_name ?? 'Tournament'}
                  {active.tmRoundNumber != null ? ` · Round ${active.tmRoundNumber}` : ''}
                  {tmLink?.division_name ? ` · ${tmLink.division_name}` : ''}
                </Typography>
              )}
              <Typography variant="h5" sx={{ mt: 0.5 }}>
                {active.courseName}
              </Typography>
              {(() => {
                // Running totals across completed holes only. The current
                // (in-progress) hole is excluded so partial strokes don't
                // skew the round-wide read. Shows "--" until the first
                // hole is finalized.
                const t = computeCompletedTotals(active);
                const hasComplete = t.completedCount > 0;
                return (
                  <Stack direction="row" spacing={3} mt={1}>
                    <Stat label="Holes" value={`${active.holesPlayed}`} />
                    <Stat label="Score" value={hasComplete ? `${t.score}` : '--'} />
                    <Stat
                      label="vs Par"
                      value={hasComplete ? scoreVsPar(t.score, t.par) : '--'}
                    />
                  </Stack>
                );
              })()}
              <Button
                variant="contained"
                size="large"
                fullWidth
                startIcon={<PlayArrowRoundedIcon />}
                sx={{ mt: 2 }}
                onClick={() => navigate('/round/play')}
              >
                Resume Round
              </Button>
            </CardContent>
          </Card>
        )}

        <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
          <CardContent>
            <Stack alignItems="center" spacing={1.5} py={2}>
              <Box
                sx={{
                  width: 72,
                  height: 72,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                  color: 'primary.contrastText',
                  display: 'grid',
                  placeItems: 'center'
                }}
              >
                <GolfCourseRoundedIcon sx={{ fontSize: 36 }} />
              </Box>
              <Typography variant="h6">{active ? 'Start another round' : 'Tee it up'}</Typography>
              <Typography variant="body2" color="text.secondary" align="center">
                Pick a course, your tee box and number of holes.
              </Typography>
              <Button
                variant="contained"
                size="large"
                fullWidth
                onClick={() => navigate('/round/start')}
                sx={{ mt: 1, minHeight: 60 }}
              >
                Start New Round
              </Button>
            </Stack>
          </CardContent>
        </Card>

        {lastRound && (
          <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
            <CardActionArea onClick={() => navigate(`/round/summary/${lastRound.id}`)}>
              <CardContent>
                <Typography
                  variant="caption"
                  color="text.secondary"
                  sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
                >
                  Last Round
                </Typography>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-end" mt={0.5}>
                  <Box sx={{ minWidth: 0 }}>
                    <Typography variant="h6" noWrap>
                      {lastRound.course_name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {dayjs(lastRound.started_at).format('MMM D, YYYY')}
                    </Typography>
                  </Box>
                  <Box textAlign="right">
                    <Typography
                      variant="h4"
                      sx={{ fontWeight: 700 }}
                      color={lastRound.score_vs_par <= 0 ? 'primary' : 'warning.main'}
                    >
                      {scoreVsPar(lastRound.score, lastRound.par)}
                    </Typography>
                    <Typography
                      variant="body2"
                      color="text.secondary"
                      sx={{ fontWeight: 600 }}
                    >
                      {lastRound.score} strokes
                    </Typography>
                  </Box>
                </Stack>
              </CardContent>
            </CardActionArea>
          </Card>
        )}

        <Button
          variant="outlined"
          size="large"
          fullWidth
          startIcon={<EmojiEventsRoundedIcon />}
          onClick={() => navigate('/tournaments')}
          sx={{ minHeight: 56, borderRadius: '5px' }}
        >
          My Tournaments
        </Button>

        <Button
          variant="outlined"
          size="large"
          fullWidth
          startIcon={<HistoryRoundedIcon />}
          onClick={() => navigate('/round/history')}
          sx={{ minHeight: 56, borderRadius: '5px' }}
        >
          View All Past Rounds
        </Button>
      </Stack>

      <Dialog
        open={confirmDelete}
        onClose={() => {
          if (deleteActive.isPending) return;
          setConfirmDelete(false);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Delete active round?</DialogTitle>
        <DialogContent>
          {active && (
            <Typography variant="body2">
              <strong>{active.courseName}</strong>
              <br />
              All hole and shot data will be removed. This cannot be undone.
            </Typography>
          )}
          {deleteActive.error && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {(deleteActive.error as Error).message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button
            onClick={() => setConfirmDelete(false)}
            disabled={deleteActive.isPending}
          >
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => active && deleteActive.mutate(active.roundId)}
            disabled={deleteActive.isPending || !active}
          >
            {deleteActive.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Box>
      <Typography
        variant="caption"
        color="text.secondary"
        sx={{ textTransform: 'uppercase', letterSpacing: 0.5, display: 'block' }}
      >
        {label}
      </Typography>
      <Typography variant="h6" sx={{ lineHeight: 1.1 }}>
        {value}
      </Typography>
    </Box>
  );
}
