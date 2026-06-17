import { useEffect, useMemo, useState } from 'react';
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
import ArrowBackRoundedIcon from '@mui/icons-material/ArrowBackRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { useAuthStore } from '@/stores/authStore';
import { swingRepo } from '@/services/swingRepo';
import { rangeRepo } from '@/services/rangeRepo';
import { practicePageSx } from './practicePageSx';
import type { SwingSession } from '@/types/swing';
import type { RangeSession } from '@/types/range';

interface PendingDelete {
  id: string;
  startedAt: string;
}

type RangeSessionWithCount = RangeSession & { shotCount: number };

// Same icons used on the "Choose a Practice" drawer buttons.
const SWING_ICON = (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <path
      d="M2 11h3.5L8 5l4.5 12L15 9h5"
      stroke="#2fd27b"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
    />
  </svg>
);
const RANGE_ICON = (
  <svg width="22" height="22" viewBox="0 0 22 22" fill="none">
    <circle cx="11" cy="11" r="8" stroke="#f88930" strokeWidth="1.6" />
    <circle cx="11" cy="11" r="3.4" stroke="#f88930" strokeWidth="1.6" />
    <circle cx="11" cy="11" r="1.1" fill="#f88930" />
  </svg>
);

const iconBoxSx = {
  width: 40,
  height: 40,
  flexShrink: 0,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  borderRadius: '5px',
  bgcolor: 'action.hover'
} as const;

export function PastPracticesPage() {
  const navigate = useNavigate();
  const userId = useAuthStore((s) => s.session?.user.id);
  const [sessions, setSessions] = useState<SwingSession[]>([]);
  const [rangeSessions, setRangeSessions] = useState<RangeSessionWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [pending, setPending] = useState<PendingDelete | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    setLoading(true);
    Promise.all([
      swingRepo.listSessions(userId).catch((err) => {
        console.warn('[practice-history] swing load failed', err);
        return [] as SwingSession[];
      }),
      rangeRepo.listSessions(userId).catch((err) => {
        console.warn('[practice-history] range load failed', err);
        return [] as RangeSessionWithCount[];
      })
    ])
      .then(([sw, rg]) => {
        if (cancelled) return;
        setSessions(sw);
        setRangeSessions(rg);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // Merge both session types, newest first.
  const items = useMemo(() => {
    const swingItems = sessions.map((s) => ({ kind: 'swing' as const, startedAt: s.startedAt, swing: s }));
    const rangeItems = rangeSessions.map((r) => ({ kind: 'range' as const, startedAt: r.startedAt, range: r }));
    return [...swingItems, ...rangeItems].sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  }, [sessions, rangeSessions]);

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
    <Box sx={practicePageSx()}>
      <IconButton aria-label="Back" onClick={() => navigate('/practice')} sx={{ ml: -1, mb: 1 }}>
        <ArrowBackRoundedIcon />
      </IconButton>
      <Typography variant="h5" sx={{ fontWeight: 900, fontSize: '32px', lineHeight: 1.1 }}>
        Past
        <br />
        Practices
      </Typography>
      <Typography variant="caption" color="text.secondary">
        Motion-based sessions · estimates, not launch-monitor data
      </Typography>

      {loading && (
        <Typography color="text.secondary" sx={{ mt: 3 }}>
          Loading…
        </Typography>
      )}

      {!loading && items.length === 0 && (
        <Typography color="text.secondary" sx={{ mt: 3 }}>
          No practice sessions yet.
        </Typography>
      )}

      <Stack spacing={1.5} sx={{ mt: 2 }}>
        {items.map((item) => {
          const isSwing = item.kind === 'swing';
          const startedAt = item.startedAt;
          const title = isSwing ? 'Swing/Net' : 'Range';
          const icon = isSwing ? SWING_ICON : RANGE_ICON;
          const inProgress = isSwing ? item.swing.endedAt == null : item.range.endedAt == null;
          const subtitle = isSwing
            ? `${item.swing.swingCount} swing${item.swing.swingCount === 1 ? '' : 's'}${
                item.swing.avgTempoRatio != null ? ` · ${item.swing.avgTempoRatio.toFixed(1)} : 1 tempo` : ''
              }`
            : `${item.range.shotCount} shot${item.range.shotCount === 1 ? '' : 's'}`;
          const onOpen = () =>
            navigate(isSwing ? `/practice/history/${item.swing.id}` : `/range/summary/${item.range.id}`);

          return (
            <Card
              key={`${item.kind}-${isSwing ? item.swing.id : item.range.id}`}
              variant="outlined"
              sx={{ borderRadius: '3px', position: 'relative' }}
            >
              {isSwing && (
                <IconButton
                  aria-label={`Delete practice session from ${dayjs(startedAt).format('MMM D, YYYY')}`}
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    setDeleteError(null);
                    setPending({ id: item.swing.id, startedAt });
                  }}
                  sx={{ position: 'absolute', top: 6, right: 6, zIndex: 2, color: 'text.secondary' }}
                >
                  <DeleteOutlineRoundedIcon fontSize="small" />
                </IconButton>
              )}
              <CardActionArea onClick={onOpen}>
                <CardContent sx={{ pr: 5 }}>
                  <Stack direction="row" spacing={1.5} alignItems="center">
                    <Box sx={iconBoxSx}>{icon}</Box>
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Stack direction="row" justifyContent="space-between" alignItems="flex-start">
                        <Box sx={{ minWidth: 0 }}>
                          <Typography variant="subtitle1" fontWeight={700}>
                            {title}
                          </Typography>
                          <Typography color="text.secondary" sx={{ fontSize: '12px' }}>
                            {dayjs(startedAt).format('MMM D, YYYY · h:mm A')}
                          </Typography>
                        </Box>
                        <Stack direction="row" spacing={0.5}>
                          {isSwing && item.swing.fatigueTrend && item.swing.fatigueTrend !== 'none' && (
                            <Chip size="small" color="warning" label="Fatigue" />
                          )}
                          {inProgress && <Chip size="small" label="In progress" />}
                        </Stack>
                      </Stack>
                      <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                        {subtitle}
                      </Typography>
                      {isSwing && item.swing.tempoConsistencyScore != null && (
                        <Typography variant="caption" color="text.secondary">
                          Tempo consistency {item.swing.tempoConsistencyScore}/100
                          {item.swing.planeConsistencyScore != null
                            ? ` · pattern ${item.swing.planeConsistencyScore}/100`
                            : ''}
                        </Typography>
                      )}
                    </Box>
                    <ChevronRightRoundedIcon sx={{ color: 'text.disabled', flexShrink: 0 }} />
                  </Stack>
                </CardContent>
              </CardActionArea>
            </Card>
          );
        })}
      </Stack>

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
