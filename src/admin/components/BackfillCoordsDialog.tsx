import { useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Checkbox,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Link,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import { useQueryClient } from '@tanstack/react-query';
import {
  useBackfillCoordsApply,
  useBackfillCoordsPreview,
  type CoordProposal
} from '@/admin/hooks/useCoursesApi';

interface BackfillCoordsDialogProps {
  open: boolean;
  onClose: () => void;
}

const CONFIDENCE_COLOR = {
  exact: 'success',
  likely: 'info',
  weak: 'warning'
} as const;

/**
 * Fills null lat/lng on library courses from OpenGolfAPI. Matching is by name
 * (+ state), so it proposes rather than writes: `exact` and `likely` matches
 * are pre-ticked, `weak` ones are left for the admin to eyeball against the
 * matched name and city before applying.
 *
 * Applying also resets osm_status → 'pending', because a course that had no
 * coordinates could never have been synced in the first place.
 */
export function BackfillCoordsDialog({ open, onClose }: BackfillCoordsDialogProps) {
  const queryClient = useQueryClient();
  const preview = useBackfillCoordsPreview();
  const apply = useBackfillCoordsApply();
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [applied, setApplied] = useState<{ updated: number; failed: number } | null>(null);

  const proposals = preview.data?.proposals ?? [];

  useEffect(() => {
    if (!open) {
      preview.reset();
      apply.reset();
      setSelected({});
      setApplied(null);
      return;
    }
    preview.mutate(50, {
      onSuccess: (data) => {
        // Pre-tick anything we're reasonably sure about; leave weak matches
        // to a human.
        const next: Record<string, boolean> = {};
        for (const p of data.proposals) {
          if (p.match && p.confidence !== 'weak') next[p.courseId] = true;
        }
        setSelected(next);
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const chosen = useMemo(
    () => proposals.filter((p) => p.match && selected[p.courseId]),
    [proposals, selected]
  );

  const onApply = () => {
    apply.mutate(
      chosen.map((p) => ({
        courseId: p.courseId,
        lat: p.match!.lat,
        lng: p.match!.lng
      })),
      {
        onSuccess: (res) => {
          setApplied({ updated: res.updated, failed: res.failed.length });
          queryClient.invalidateQueries({ queryKey: ['admin-all-courses'] });
          queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
        }
      }
    );
  };

  const renderRow = (p: CoordProposal) => (
    <TableRow key={p.courseId} hover>
      <TableCell padding="checkbox">
        <Checkbox
          size="small"
          disabled={!p.match || Boolean(applied)}
          checked={Boolean(selected[p.courseId] && p.match)}
          onChange={(e) =>
            setSelected((s) => ({ ...s, [p.courseId]: e.target.checked }))
          }
        />
      </TableCell>
      <TableCell>
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          {p.courseName}
        </Typography>
        <Typography variant="caption" color="text.secondary">
          {[p.clubName, p.city, p.state].filter(Boolean).join(' · ') || '—'}
        </Typography>
      </TableCell>
      <TableCell>
        {p.match ? (
          <>
            <Typography variant="body2">{p.match.name}</Typography>
            <Typography variant="caption" color="text.secondary">
              {[p.match.city, p.match.state].filter(Boolean).join(', ')} ·{' '}
              {p.match.lat.toFixed(4)}, {p.match.lng.toFixed(4)}
            </Typography>
          </>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No match found
          </Typography>
        )}
      </TableCell>
      <TableCell sx={{ whiteSpace: 'nowrap' }}>
        {p.match && (
          <Chip
            size="small"
            label={`${p.confidence} ${p.score.toFixed(2)}`}
            color={CONFIDENCE_COLOR[p.confidence]}
          />
        )}
      </TableCell>
    </TableRow>
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Backfill coordinates</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Courses with no lat/lng can&apos;t be OSM-synced or mapped. These are
            matched by name against OpenGolfAPI. Check each match before
            applying — applying also resets OSM status to <code>pending</code>.
          </Typography>

          {preview.isPending && (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          )}

          {preview.isError && (
            <Alert severity="error">{(preview.error as Error).message}</Alert>
          )}

          {applied && (
            <Alert severity={applied.failed ? 'warning' : 'success'}>
              Updated {applied.updated} course{applied.updated === 1 ? '' : 's'}
              {applied.failed ? `, ${applied.failed} failed` : ''}. Run Resync OSM
              to build their layouts.
            </Alert>
          )}

          {apply.isError && <Alert severity="error">{(apply.error as Error).message}</Alert>}

          {preview.isSuccess && proposals.length === 0 && (
            <Alert severity="success">Every course already has coordinates.</Alert>
          )}

          {proposals.length > 0 && (
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell padding="checkbox" />
                  <TableCell>Course</TableCell>
                  <TableCell>OpenGolfAPI match</TableCell>
                  <TableCell>Confidence</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>{proposals.map(renderRow)}</TableBody>
            </Table>
          )}

          {preview.data && (
            <Typography variant="caption" color="text.secondary">
              {preview.data.attribution} —{' '}
              <Link href="https://opengolfapi.org/attribution" target="_blank" rel="noreferrer">
                attribution
              </Link>
            </Typography>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button
          variant="contained"
          onClick={onApply}
          disabled={chosen.length === 0 || apply.isPending || Boolean(applied)}
        >
          {apply.isPending ? 'Applying…' : `Apply ${chosen.length}`}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
