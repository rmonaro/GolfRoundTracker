import { useQuery } from '@tanstack/react-query';
import { holesRepo, type HoleLayoutData } from '@/services/holesRepo';
import type { CourseOsmStatus } from '@/models';

export type HoleLayoutStatus =
  | 'none'         // no courseId provided
  | 'loading'      // initial fetch
  | 'ready'        // data is here
  | 'unavailable'  // course is skip / no_coverage / has no hole row
  | 'pending';     // course is pending / failed — try again later

export interface UseHoleLayoutResult {
  data: HoleLayoutData | null;
  courseStatus: CourseOsmStatus | null;
  status: HoleLayoutStatus;
  isLoading: boolean;
}

export function useHoleLayout(
  courseId: string | null | undefined,
  holeNumber: number
): UseHoleLayoutResult {
  const enabled = !!courseId && holeNumber > 0;

  const query = useQuery({
    queryKey: ['hole-layout', courseId, holeNumber],
    enabled,
    staleTime: 1000 * 60 * 5,
    queryFn: () => holesRepo.getLayout(courseId!, holeNumber)
  });

  if (!enabled) {
    return { data: null, courseStatus: null, status: 'none', isLoading: false };
  }
  if (query.isLoading) {
    return { data: null, courseStatus: null, status: 'loading', isLoading: true };
  }

  const courseStatus = query.data?.courseStatus ?? null;
  const data = query.data?.data ?? null;

  let status: HoleLayoutStatus;
  if (courseStatus === 'skip' || courseStatus === 'no_coverage' || !data) {
    status = 'unavailable';
  } else if (courseStatus === 'pending' || courseStatus === 'failed') {
    status = 'pending';
  } else {
    status = 'ready';
  }

  return { data, courseStatus, status, isLoading: false };
}
