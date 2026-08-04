// Downloaded-courses list. Courses are cached automatically when a round
// starts; this is where you see what's on the device, how much space it takes,
// and remove ones you're done with.
//
// Doubles as the measurement surface for the geometry payload — the plan
// (docs/OFFLINE_MODE.md §6 Phase 2) flags per-course size as the unknown that
// decides whether this approach scales, and `sizeBytes` is recorded at download
// time precisely so it can be read here rather than estimated.

import { useEffect, useState } from 'react';
import { Box, Button, Card, CardContent, Stack, Typography } from '@mui/material';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import CloudDoneRoundedIcon from '@mui/icons-material/CloudDoneRounded';
import dayjs from 'dayjs';
import {
  deleteCachedCourse,
  listCachedCourses,
  type CachedCourse
} from '@/services/courseCacheRepo';
import { CoursePackButton } from './CoursePackButton';

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function OfflineCoursesCard() {
  const [courses, setCourses] = useState<CachedCourse[] | null>(null);

  const refresh = () => {
    void listCachedCourses().then(setCourses);
  };

  useEffect(refresh, []);

  const onDelete = async (courseId: string) => {
    await deleteCachedCourse(courseId);
    refresh();
  };

  // Loading — render nothing rather than flashing an empty state.
  if (courses === null) return null;

  const totalBytes = courses.reduce((sum, c) => sum + c.sizeBytes, 0);

  return (
    <Card elevation={0} sx={{ bgcolor: 'background.paper', borderRadius: '5px' }}>
      <CardContent>
        <Typography
          variant="caption"
          color="text.secondary"
          sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
        >
          Offline courses
        </Typography>

        {courses.length === 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            No courses downloaded yet. A course is saved to this device
            automatically when you start a round there, so distances and the hole
            layout keep working without signal. Satellite imagery is a separate,
            larger download you can add per course.
          </Typography>
        ) : (
          <>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ display: 'block', mt: 0.5, mb: 1 }}
            >
              {courses.length} course{courses.length === 1 ? '' : 's'} ·{' '}
              {formatSize(totalBytes)} total
            </Typography>
            <Stack spacing={0.5}>
              {courses.map((c) => (
                <Stack
                  key={c.courseId}
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  sx={{ py: 0.5 }}
                >
                  <CloudDoneRoundedIcon sx={{ fontSize: 18, color: 'success.main' }} />
                  <Stack sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={600} noWrap>
                      {c.courseName ?? c.courseId}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap>
                      {c.holes.length} holes · {c.features.length} features ·{' '}
                      {formatSize(c.sizeBytes)} · saved{' '}
                      {dayjs(c.downloadedAt).format('D MMM')}
                    </Typography>
                    {/* Imagery is a separate, much larger download from the
                        geometry above, so it gets its own control. */}
                    <Box sx={{ mt: 0.5 }}>
                      <CoursePackButton
                        courseId={c.courseId}
                        courseName={c.courseName}
                        onChanged={refresh}
                      />
                    </Box>
                  </Stack>
                  <Button
                    size="small"
                    color="error"
                    aria-label={`Remove ${c.courseName ?? 'course'} from this device`}
                    onClick={() => void onDelete(c.courseId)}
                    sx={{ minWidth: 0, px: 1 }}
                  >
                    <DeleteOutlineRoundedIcon sx={{ fontSize: 18 }} />
                  </Button>
                </Stack>
              ))}
            </Stack>
          </>
        )}
      </CardContent>
    </Card>
  );
}
