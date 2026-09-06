import { useQuery } from '@tanstack/react-query';
import { holesRepo, type HoleLayoutData } from '@/services/holesRepo';
import { selectedTeeBox } from './teeBox';
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
  holeNumber: number,
  /**
   * Yardage for this hole from the tee the golfer actually selected.
   *
   * OSM maps every tee box but rarely labels the colours, so this is what
   * identifies which one is in play: the selected tee's box is the one whose
   * distance to the green matches its scorecard yardage. Omit it and the hole
   * keeps whichever box the OSM sync happened to store.
   */
  yardsFromSelectedTee?: number | null
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
  const raw = query.data?.data ?? null;

  // Move the hole's tee to the box the golfer actually plays from. Everything
  // downstream — the map's tee marker, the tee→green axis, distance-from-tee —
  // reads hole.tee_*, so overriding it here fixes all of them at once rather
  // than teaching each consumer about tee selection.
  const data = (() => {
    if (!raw) return null;
    const green: [number, number] | null =
      raw.hole.green_lng != null && raw.hole.green_lat != null
        ? [raw.hole.green_lng, raw.hole.green_lat]
        : null;
    const box = selectedTeeBox(
      raw.features,
      green,
      yardsFromSelectedTee,
      raw.hole.centerline as [number, number][] | null
    );
    if (!box) return raw;
    return { ...raw, hole: { ...raw.hole, tee_lng: box[0], tee_lat: box[1] } };
  })();

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
