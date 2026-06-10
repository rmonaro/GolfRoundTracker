import { useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useCourses } from '@/features/round/useStartRound';
import { useImportCourse } from '@/admin/hooks/useCoursesApi';
import { useAuthStore } from '@/stores/authStore';
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

  const matched = useMemo<Course | null>(() => {
    if (!externalCourseId) return null;
    return (
      courses.data?.find((c) => c.course_api_id === externalCourseId) ?? null
    );
  }, [courses.data, externalCourseId]);

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
    isLoadingCourses: courses.isLoading,
    isImporting: importCourse.isPending,
    importError: importCourse.error as Error | null,
    ensureCourse
  };
}
