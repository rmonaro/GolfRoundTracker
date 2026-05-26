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
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography
} from '@mui/material';
import GolfCourseRoundedIcon from '@mui/icons-material/GolfCourseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { useRounds } from '@/features/stats/useRounds';
import { useAuthStore } from '@/stores/authStore';
import { roundRepo } from '@/services/roundRepo';
import { scoreVsPar } from '@/utils/format';

interface PendingDelete {
  id: string;
  courseName: string;
  startedAt: string;
}

export function PastRoundsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const userId = useAuthStore((s) => s.session?.user.id);
  const { data, isLoading } = useRounds();
  const [pending, setPending] = useState<PendingDelete | null>(null);

  const deleteRound = useMutation({
    mutationFn: (roundId: string) => roundRepo.deleteRound(roundId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rounds', userId] });
      setPending(null);
    }
  });

  if (isLoading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const completed = (data ?? []).filter((r) => r.completed_at);

  return (
    <Box>
      <PageHeader title="Past Rounds" back />
      {completed.length === 0 ? (
        <EmptyState
          icon={<GolfCourseRoundedIcon fontSize="inherit" />}
          title="No completed rounds yet"
          description="Finish a round to see it here."
          actionLabel="Start Round"
          onAction={() => navigate('/round/start')}
        />
      ) : (
        <Stack spacing={1.5} px={2} pb={3}>
          {completed.map((r) => (
            <Card
              key={r.id}
              elevation={0}
              sx={{ bgcolor: 'background.paper', position: 'relative' }}
            >
              {/* Delete affordance — absolute-positioned over the card so it
                  stays a separate tap target from the CardActionArea (which
                  would otherwise navigate to summary on any tap). */}
              <IconButton
                aria-label={`Delete round at ${r.course_name}`}
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  setPending({
                    id: r.id,
                    courseName: r.course_name,
                    startedAt: r.started_at
                  });
                }}
                sx={{
                  position: 'absolute',
                  top: 6,
                  right: 6,
                  zIndex: 2,
                  color: 'text.secondary'
                }}
              >
                <DeleteOutlineRoundedIcon fontSize="small" />
              </IconButton>
              <CardActionArea
                onClick={() => navigate(`/round/summary/${r.id}`)}
                sx={{ p: 0.5 }}
              >
                <CardContent>
                  <Stack
                    direction="row"
                    justifyContent="space-between"
                    alignItems="flex-start"
                    sx={{ pr: 4 /* keep title clear of the delete icon */ }}
                  >
                    <Box sx={{ minWidth: 0 }}>
                      <Typography variant="caption" color="text.secondary">
                        {dayjs(r.started_at).format('ddd MMM D, YYYY')}
                      </Typography>
                      <Typography variant="h6" noWrap>
                        {r.course_name}
                      </Typography>
                      <Stack direction="row" spacing={0.75} mt={0.5}>
                        <Chip label={`${r.holes_played} holes`} size="small" />
                        {r.handicap_differential != null && (
                          <Chip
                            label={`Δ ${r.handicap_differential.toFixed(1)}`}
                            size="small"
                            color="primary"
                            variant="outlined"
                          />
                        )}
                      </Stack>
                    </Box>
                    <Box sx={{ textAlign: 'right' }}>
                      <Typography variant="h4" sx={{ fontWeight: 700 }}>
                        {r.score}
                      </Typography>
                      <Typography
                        variant="body2"
                        color={r.score_vs_par <= 0 ? 'primary' : 'warning.main'}
                        sx={{ fontWeight: 600 }}
                      >
                        {scoreVsPar(r.score, r.par)}
                      </Typography>
                    </Box>
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          ))}
        </Stack>
      )}

      <Dialog
        open={pending !== null}
        onClose={() => {
          if (deleteRound.isPending) return;
          setPending(null);
        }}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>Delete round?</DialogTitle>
        <DialogContent>
          {pending && (
            <Typography variant="body2">
              <strong>{pending.courseName}</strong>{' '}
              <span style={{ opacity: 0.7 }}>
                · {dayjs(pending.startedAt).format('MMM D, YYYY')}
              </span>
              <br />
              All hole and shot data will be removed. This cannot be undone.
            </Typography>
          )}
          {deleteRound.error && (
            <Alert severity="error" sx={{ mt: 1.5 }}>
              {(deleteRound.error as Error).message}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} disabled={deleteRound.isPending}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            onClick={() => pending && deleteRound.mutate(pending.id)}
            disabled={deleteRound.isPending}
          >
            {deleteRound.isPending ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
