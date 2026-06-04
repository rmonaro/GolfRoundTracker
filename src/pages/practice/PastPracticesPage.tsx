import { useEffect, useState } from 'react';
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
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { useAuthStore } from '@/stores/authStore';
import { swingRepo } from '@/services/swingRepo';
import type { SwingSession } from '@/types/swing';

interface PendingDelete {
  id: string;
  startedAt: string;
}

export function PastPracticesPage() {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.session?.user.id);
  const [sessions, setSessions] = useState<SwingSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    swingRepo
      .listSessions(userId)
      .then((rows) => {
        if (!cancelled) setSessions(rows);
      })
      .catch((err) => console.warn('[practice-history] load failed', err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  const onConfirmDelete = async () => {
    if (!pending) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await swingRepo.deleteSession(pending.id);
      setSessions((prev) => prev.filter((s) => s.id !== pending.id));
      setPending(null);
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : 'Could not delete session');
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Box sx={{ p: 2, maxWidth: 520, mx: 'auto' }}>
      <Typography variant="h5" fontWeight={800}>
        Past Practices
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Motion-based sessions · estimates, not launch-monitor data
      </Typography>

      {loading && (
        <Typography color="text.secondary" sx={{ mt: 3 }}>
          Loading…
        </Typography>
      )}

      {!loading && sessions.length === 0 && (
        <Typography color="text.secondary" sx={{ mt: 3 }}>
          No practice sessions yet.
        </Typography>
      )}

      <Stack spacing={1.5} sx={{ mt: 2 }}>
        {sessions.map((s) => (
          <Card key={s.id} variant="outlined" sx={{ borderRadius: 2, position: 'relative' }}>
            {/* Delete affordance — absolute-positioned so it stays a separate
                tap target from the CardActionArea (which navigates to detail). */}
            <IconButton
              aria-label={`Delete practice session from ${dayjs(s.startedAt).format('MMM D, YYYY')}`}
              size="small"
              onClick={(e) => {
                e.stopPropagation();
                setDeleteError(null);
                setPending({ id: s.id, startedAt: s.startedAt });
              }}
              sx={{ position: 'absolute', top: 6, right: 6, zIndex: 2, color: 'text.secondary' }}
            >
              <DeleteOutlineRoundedIcon fontSize="small" />
            </IconButton>
            <CardActionArea onClick={() => navigate(`/practice/history/${s.id}`)}>
              <CardContent sx={{ pr: 5 }}>
                <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                  <Box>
                    <Typography variant="subtitle1" fontWeight={700}>
                      {dayjs(s.startedAt).format('MMM D, YYYY · h:mm A')}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {s.swingCount} swing{s.swingCount === 1 ? '' : 's'}
                      {s.avgTempoRatio != null ? ` · ${s.avgTempoRatio.toFixed(1)} : 1 tempo` : ''}
                    </Typography>
                  </Box>
                  <Stack direction="row" spacing={0.5}>
                    {s.fatigueTrend && s.fatigueTrend !== 'none' && (
                      <Chip size="small" color="warning" label="Fatigue" />
                    )}
                    {s.endedAt == null && <Chip size="small" label="In progress" />}
                  </Stack>
                </Stack>
                {s.tempoConsistencyScore != null && (
                  <Typography variant="caption" color="text.secondary">
                    Tempo consistency {s.tempoConsistencyScore}/100
                    {s.planeConsistencyScore != null
                      ? ` · pattern ${s.planeConsistencyScore}/100`
                      : ''}
                  </Typography>
                )}
              </CardContent>
            </CardActionArea>
          </Card>
        ))}
      </Stack>

      <Button sx={{ mt: 3 }} onClick={() => navigate('/practice')}>
        Back
      </Button>

      <Dialog
        open={pending != null}
        onClose={() => {
          if (deleting) return;
          setPending(null);
        }}
      >
        <DialogTitle>Delete practice session?</DialogTitle>
        <DialogContent>
          <Typography variant="body2" color="text.secondary">
            This permanently removes the session from{' '}
            {pending ? dayjs(pending.startedAt).format('MMM D, YYYY') : ''} and all of its
            swings. This can't be undone.
          </Typography>
          {deleteError && (
            <Alert severity="error" sx={{ mt: 2 }}>
              {deleteError}
            </Alert>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPending(null)} disabled={deleting}>
            Cancel
          </Button>
          <Button color="error" variant="contained" onClick={onConfirmDelete} disabled={deleting}>
            {deleting ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
