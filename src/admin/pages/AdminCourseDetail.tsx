import { useState } from 'react';
import {
  Alert,
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Stack,
  Typography
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Navigate, useParams } from 'react-router-dom';
import { adminCoursesRepo } from '@/services/adminCoursesRepo';
import { useResyncCourse } from '../hooks/useCoursesApi';
import { HoleLayoutCard } from '@/features/course/HoleLayoutCard';

export function AdminCourseDetail() {
  const queryClient = useQueryClient();
  const { id } = useParams<{ id: string }>();
  const [holeNumber, setHoleNumber] = useState(1);
  const resync = useResyncCourse();

  const { data: course, isLoading } = useQuery({
    queryKey: ['admin-course', id],
    enabled: !!id,
    queryFn: () => adminCoursesRepo.getOne(id!)
  });

  if (!id) return <Navigate to="/admin/courses" replace />;
  if (isLoading || !course) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', py: 6 }}>
        <CircularProgress />
      </Box>
    );
  }

  const onResync = () => {
    resync.mutate(course.id, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['admin-course', id] });
        queryClient.invalidateQueries({ queryKey: ['admin-all-courses'] });
        queryClient.invalidateQueries({ queryKey: ['admin-stats'] });
        queryClient.invalidateQueries({ queryKey: ['hole-layout'] });
      }
    });
  };

  return (
    <Stack spacing={2} sx={{ p: 2 }}>
      <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
        <CardContent>
          <Typography variant="h6">{course.name}</Typography>
          {course.club_name && (
            <Typography variant="body2" color="text.secondary">
              {course.club_name}
            </Typography>
          )}
          <Typography variant="caption" color="text.secondary">
            {[course.city, course.state, course.country].filter(Boolean).join(', ') || '—'}
          </Typography>
          <Stack direction="row" spacing={0.5} mt={1} flexWrap="wrap" useFlexGap>
            <Chip size="small" label={`source: ${course.source ?? '—'}`} />
            <Chip size="small" label={`osm: ${course.osm_status ?? '—'}`} />
            {course.course_api_id && <Chip size="small" label={`api id: ${course.course_api_id}`} />}
          </Stack>
          <Stack direction="row" spacing={1} mt={2}>
            <Button variant="outlined" onClick={onResync} disabled={resync.isPending}>
              {resync.isPending ? 'Syncing…' : 'Resync OSM'}
            </Button>
            <Button
              variant="text"
              disabled={!course.lat || !course.lng}
              onClick={() =>
                window.open(
                  `https://www.openstreetmap.org/?mlat=${course.lat}&mlon=${course.lng}#map=16/${course.lat}/${course.lng}`,
                  '_blank'
                )
              }
            >
              Open in OSM
            </Button>
          </Stack>
          {resync.error && (
            <Alert severity="error" sx={{ mt: 1 }}>
              {(resync.error as Error).message}
            </Alert>
          )}
          {resync.data && (
            <Alert severity={resync.data.ok ? 'success' : 'error'} sx={{ mt: 1 }}>
              {resync.data.status} — holes: {resync.data.holes ?? 0}, features: {resync.data.features ?? 0}
            </Alert>
          )}
        </CardContent>
      </Card>

      <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
        <CardContent>
          <Typography variant="subtitle1" mb={1}>
            Hole {holeNumber} preview
          </Typography>
          <Box sx={{ height: 320 }}>
            <HoleLayoutCard courseId={course.id} holeNumber={holeNumber} />
          </Box>
          <Stack direction="row" spacing={0.5} mt={1} flexWrap="wrap" useFlexGap>
            {Array.from({ length: 18 }, (_, i) => i + 1).map((n) => (
              <Button
                key={n}
                size="small"
                variant={holeNumber === n ? 'contained' : 'outlined'}
                onClick={() => setHoleNumber(n)}
                sx={{ minWidth: 36, px: 1 }}
              >
                {n}
              </Button>
            ))}
          </Stack>
        </CardContent>
      </Card>
    </Stack>
  );
}
