import { useEffect } from 'react';
import {
  Alert,
  Box,
  Button,
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
import { useScorecardApply, useScorecardPreview } from '@/admin/hooks/useCoursesApi';

interface ScorecardImportDialogProps {
  open: boolean;
  courseId: string;
  onClose: () => void;
}

const CONFIDENCE_COLOR = {
  exact: 'success',
  likely: 'info',
  weak: 'warning'
} as const;

/** "4 → 5" when the value changes, plain value when it doesn't, "—" for null. */
function Delta({ current, incoming }: { current: number | null; incoming: number | null }) {
  if (incoming == null) {
    return <Typography variant="body2" color="text.secondary">{current ?? '—'}</Typography>;
  }
  if (current == null) {
    return (
      <Typography variant="body2" color="success.main">
        — → <strong>{incoming}</strong>
      </Typography>
    );
  }
  if (current === incoming) {
    return <Typography variant="body2" color="text.secondary">{current}</Typography>;
  }
  return (
    <Typography variant="body2" color="warning.main">
      {current} → <strong>{incoming}</strong>
    </Typography>
  );
}

/**
 * Imports par + stroke index and named tee sets for one course from
 * OpenGolfAPI. The course is matched by name and then confirmed by distance —
 * a candidate more than 5km from the stored coordinates is rejected outright,
 * because two clubs can share a name but not a location.
 *
 * Preview lists every hole with current → incoming so the admin can see what
 * would change before writing. Geometry columns are never touched.
 */
export function ScorecardImportDialog({
  open,
  courseId,
  onClose
}: ScorecardImportDialogProps) {
  const queryClient = useQueryClient();
  const preview = useScorecardPreview();
  const apply = useScorecardApply();

  useEffect(() => {
    if (!open) {
      preview.reset();
      apply.reset();
      return;
    }
    preview.mutate(courseId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, courseId]);

  const data = preview.data;
  const changedCount = data?.holes.filter((h) => h.changed).length ?? 0;

  const onApply = () => {
    if (!data?.openGolfId) return;
    apply.mutate(
      { courseId, openGolfId: data.openGolfId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ['admin-course', courseId] });
          queryClient.invalidateQueries({ queryKey: ['hole-layout'] });
          queryClient.invalidateQueries({ queryKey: ['course-tees', courseId] });
        }
      }
    );
  };

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Import scorecard from OpenGolfAPI</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          {preview.isPending && (
            <Box sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
              <CircularProgress />
            </Box>
          )}

          {preview.isError && <Alert severity="error">{(preview.error as Error).message}</Alert>}

          {data && !data.openGolfId && (
            <Alert severity="warning">
              No confident match on OpenGolfAPI
              {data.matchName ? ` — closest was "${data.matchName}", but it is too far from this course's coordinates.` : '.'}
            </Alert>
          )}

          {data?.openGolfId && (
            <>
              <Stack direction="row" spacing={1} alignItems="center">
                <Typography variant="body2">
                  Matched <strong>{data.matchName}</strong>
                </Typography>
                <Chip
                  size="small"
                  label={data.confidence}
                  color={CONFIDENCE_COLOR[data.confidence]}
                />
              </Stack>

              {apply.isSuccess ? (
                <Alert severity="success">
                  Wrote {apply.data.holesUpdated} hole
                  {apply.data.holesUpdated === 1 ? '' : 's'} and {apply.data.teesUpserted} tee set
                  {apply.data.teesUpserted === 1 ? '' : 's'}.
                </Alert>
              ) : (
                <Alert severity={changedCount > 0 ? 'info' : 'success'}>
                  {changedCount > 0
                    ? `${changedCount} of ${data.holes.length} holes would change. Hole geometry is not touched.`
                    : 'Everything already matches — importing would change nothing.'}
                </Alert>
              )}

              {apply.isError && <Alert severity="error">{(apply.error as Error).message}</Alert>}

              {data.holes.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Holes
                  </Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Hole</TableCell>
                        <TableCell>Par</TableCell>
                        <TableCell>Stroke index</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.holes.map((h) => (
                        <TableRow key={h.holeNumber} selected={h.changed}>
                          <TableCell>{h.holeNumber}</TableCell>
                          <TableCell>
                            <Delta {...h.par} />
                          </TableCell>
                          <TableCell>
                            <Delta {...h.handicap} />
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}

              {data.tees.length > 0 && (
                <Box>
                  <Typography variant="subtitle2" gutterBottom>
                    Tee sets ({data.tees.length})
                  </Typography>
                  <Table size="small">
                    <TableHead>
                      <TableRow>
                        <TableCell>Tee</TableCell>
                        <TableCell>Gender</TableCell>
                        <TableCell>Rating</TableCell>
                        <TableCell>Slope</TableCell>
                        <TableCell>Yards</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {data.tees.map((t, i) => (
                        <TableRow key={`${t.teeName}-${t.gender}-${i}`}>
                          <TableCell>
                            {t.teeName}
                            {t.teeColor && (
                              <Chip size="small" label={t.teeColor} sx={{ ml: 0.5 }} />
                            )}
                          </TableCell>
                          <TableCell>{t.gender ?? '—'}</TableCell>
                          <TableCell>{t.courseRating ?? '—'}</TableCell>
                          <TableCell>{t.slope ?? '—'}</TableCell>
                          <TableCell>{t.yardage ?? '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Box>
              )}
            </>
          )}

          {data && (
            <Typography variant="caption" color="text.secondary">
              {data.attribution} —{' '}
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
          disabled={!data?.openGolfId || apply.isPending || apply.isSuccess}
        >
          {apply.isPending ? 'Importing…' : 'Import'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
