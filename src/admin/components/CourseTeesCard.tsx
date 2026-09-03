import { useMemo } from 'react';
import {
  Alert,
  Box,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { courseTeesRepo, dedupeTees } from '@/services/courseTeesRepo';
import type { CourseTeeSource } from '@/models';

const SOURCE_COLOR: Record<CourseTeeSource, 'default' | 'primary' | 'info' | 'warning'> = {
  manual: 'primary',
  api: 'info',
  opengolf: 'warning',
  osm: 'default'
};

/**
 * Every tee row on a course, including the cross-source duplicates the player
 * picker collapses. Rows the picker hides are dimmed and marked, so an admin
 * can see at a glance that two sources disagree about the same tee — which is
 * the case worth knowing about, since ratings drive handicap differentials.
 */
export function CourseTeesCard({ courseId }: { courseId: string }) {
  const { data: tees, isLoading } = useQuery({
    queryKey: ['course-tees', courseId],
    queryFn: () => courseTeesRepo.listAllForCourse(courseId)
  });

  const visibleIds = useMemo(
    () => new Set(dedupeTees(tees ?? []).map((t) => t.id)),
    [tees]
  );

  if (isLoading) {
    return (
      <Card elevation={0} sx={{ mt: 2 }}>
        <CardContent sx={{ display: 'grid', placeItems: 'center', py: 4 }}>
          <CircularProgress size={24} />
        </CardContent>
      </Card>
    );
  }

  const hidden = (tees?.length ?? 0) - visibleIds.size;

  return (
    <Card elevation={0} sx={{ mt: 2 }}>
      <CardContent>
        <Typography variant="subtitle1" gutterBottom>
          Tee sets ({tees?.length ?? 0})
        </Typography>

        {!tees?.length ? (
          <Typography variant="body2" color="text.secondary">
            No tee data — import a scorecard or re-import from GolfCourseAPI.
          </Typography>
        ) : (
          <>
            {hidden > 0 && (
              <Alert severity="info" sx={{ mb: 1.5 }}>
                {hidden} row{hidden === 1 ? '' : 's'} hidden from the start-round
                picker — another source already describes the same tee. The
                highest-ranked source wins: manual, then GolfCourseAPI, then
                OpenGolfAPI, then OSM.
              </Alert>
            )}
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Tee</TableCell>
                    <TableCell>Gender</TableCell>
                    <TableCell>Rating</TableCell>
                    <TableCell>Slope</TableCell>
                    <TableCell>Yards</TableCell>
                    <TableCell>Holes</TableCell>
                    <TableCell>Source</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {tees.map((t) => {
                    const shown = visibleIds.has(t.id);
                    return (
                      <TableRow key={t.id} sx={{ opacity: shown ? 1 : 0.45 }}>
                        <TableCell sx={{ fontWeight: shown ? 600 : 400 }}>
                          {t.tee_name}
                          {t.tee_color && (
                            <Chip size="small" label={t.tee_color} sx={{ ml: 0.5 }} />
                          )}
                        </TableCell>
                        <TableCell>{t.gender ?? '—'}</TableCell>
                        <TableCell>{t.course_rating ?? '—'}</TableCell>
                        <TableCell>{t.slope_rating ?? '—'}</TableCell>
                        <TableCell>{t.total_yards ?? '—'}</TableCell>
                        <TableCell>{t.holes?.length ?? '—'}</TableCell>
                        <TableCell sx={{ whiteSpace: 'nowrap' }}>
                          <Chip size="small" label={t.source} color={SOURCE_COLOR[t.source]} />
                          {!shown && (
                            <Typography
                              variant="caption"
                              color="text.secondary"
                              sx={{ ml: 0.5 }}
                            >
                              hidden
                            </Typography>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );
}
