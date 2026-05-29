import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
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
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { useRoundStore } from '@/stores/roundStore';
import { useAuthStore } from '@/stores/authStore';
import { scoreVsPar } from '@/utils/format';
import { computeTotalScore } from '@/features/round/computeRoundTotals';
import { roundRepo } from '@/services/roundRepo';

export function RoundHomePage() {
  const active = useRoundStore((s) => s.active);
  const endRound = useRoundStore((s) => s.endRound);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);
  const [confirmDelete, setConfirmDelete] = useState(false);

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
              position: 'relative'
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
              <Typography
                variant="caption"
                color="primary"
                sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
              >
                Active Round
              </Typography>
              <Typography variant="h5" sx={{ mt: 0.5 }}>
                {active.courseName}
              </Typography>
              <Stack direction="row" spacing={3} mt={1}>
                <Stat label="Holes" value={`${active.holesPlayed}`} />
                <Stat label="Score" value={`${computeTotalScore(active.holes)}`} />
                <Stat label="vs Par" value={scoreVsPar(computeTotalScore(active.holes), active.totalPar)} />
              </Stack>
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

        <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
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
