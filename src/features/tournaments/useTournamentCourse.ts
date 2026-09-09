import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCourses } from '@/features/round/useStartRound';
import { useImportCourse } from '@/admin/hooks/useCoursesApi';
import { useAuthStore } from '@/stores/authStore';
import { courseRepo } from '@/services/courseRepo';
import type { Course } from '@/models';

/**
 * Match a TM tournament's `external_course_id` to a course in our library.
 * Both apps import from GolfCourseAPI, so the match key is the GolfCourseAPI id
 * stored on each side: TM `external_course_id` === GRT `courses.course_api_id`.
 *
 * Returns the local course if we already have it, plus an `ensureCourse()` that
 * imports it on demand (same edge-function path the Start Round picker uses) so
 * the tournament round can start with the correct, layout-rich course.
 */
export function useTournamentCourse(externalCourseId: string | null | undefined) {
  const userId = useAuthStore((s) => s.session?.user.id);
  const courses = useCourses();
  const importCourse = useImportCourse();
  const queryClient = useQueryClient();

  const fromList = useMemo<Course | null>(() => {
    if (!externalCourseId) return null;
    return (
      courses.data?.find((c) => c.course_api_id === externalCourseId) ?? null
    );
  }, [courses.data, externalCourseId]);

  // The browse list hides library courses with no tee sets or no polygons, so a
  // miss there does NOT mean we lack the course. Ask by id before concluding an
  // import is needed — otherwise every tournament on such a course re-imports
  // on every start.
  const byApiId = useQuery({
    queryKey: ['course-by-api-id', externalCourseId],
    enabled: !!externalCourseId && !fromList && !courses.isLoading,
    queryFn: () => courseRepo.findByApiId(externalCourseId as string)
  });

  const matched = fromList ?? byApiId.data ?? null;

  const ensureCourse = async (): Promise<Course | null> => {
    if (matched) return matched;
    if (!externalCourseId) return null;
    const res = await importCourse.mutateAsync(externalCourseId);
    await queryClient.invalidateQueries({ queryKey: ['courses', userId] });
    // The import returns the upserted row; cast through the shared Course shape.
    return (res.course as unknown as Course) ?? null;
  };

  return {
    course: matched,
    isLoadingCourses: courses.isLoading || byApiId.isLoading,
    isImporting: importCourse.isPending,
    importError: importCourse.error as Error | null,
    ensureCourse
  };
}
