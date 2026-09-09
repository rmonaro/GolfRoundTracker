import { useMemo, type MutableRefObject } from 'react';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { spectatorFeed } from '@/services/spectatorFeed';
import { assignFeaturesToHole } from '@/services/holesRepo';
import { HoleLayout } from '@/features/course/HoleLayout';
import type { Shot } from '@/models';

interface SpectatorHoleMapProps {
  code: string;
  courseId: string;
  holeNumber: number;
  /** Shots on this hole, already ordered. */
  shots: Shot[];
  clubs: Record<string, string>;
  /**
   * Tighter markers and padding, for the inline card. False gives the
   * full-screen view the same framing the player's own round screen uses.
   */
  compact?: boolean;
  /** Receives a "frame the whole hole" fn so a parent can offer a recenter. */
  recenterRef?: MutableRefObject<(() => void) | null>;
}

/**
 * The hole map, for someone with no account.
 *
 * A spectator can't read `holes` or `hole_features` — those are readable by
 * authenticated users only — so the geometry comes from the edge function
 * instead of `useHoleLayout`. What arrives is the same `{ holes, features }`
 * the offline course cache holds, which means `assignFeaturesToHole` (the same
 * function the cached path uses) turns it into a single hole's layout and
 * `HoleLayout` renders it unchanged. One fetch per course, cached for the
 * session — a busy course is ~300 KB and the viewer will look at 18 holes of
 * it.
 */
export function SpectatorHoleMap({
  code,
  courseId,
  holeNumber,
  shots,
  clubs,
  compact = true,
  recenterRef
}: SpectatorHoleMapProps) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['spectator-layout', code, courseId],
    queryFn: () => spectatorFeed.layout(code, courseId),
    // Course geometry changes when an admin re-syncs OSM, which is not
    // something worth re-fetching during a round.
    staleTime: Infinity,
    gcTime: 60 * 60_000,
    retry: 1
  });

  const layout = useMemo(() => {
    if (!data) return null;
    const hole = data.holes.find((h) => h.hole_number === holeNumber);
    if (!hole) return null;
    return { hole, features: assignFeaturesToHole(hole, data.holes, data.features) };
  }, [data, holeNumber]);

  /** Recorded landing points, in shot order — the dots drawn on the hole. */
  const shotEndPoints = useMemo(
    () =>
      shots
        .filter((s) => s.end_lng != null && s.end_lat != null)
        .map((s) => [s.end_lng as number, s.end_lat as number] as [number, number]),
    [shots]
  );

  const shotLabels = useMemo(
    () =>
      shots
        .filter((s) => s.end_lng != null && s.end_lat != null)
        .map((s) => ({
          club: s.club_id ? (clubs[s.club_id] ?? null) : null,
          distance:
            s.calculated_distance != null
              ? String(Math.round(s.calculated_distance))
              : s.distance != null
                ? String(Math.round(s.distance))
                : null,
          distanceUnit: (s.distance_unit === 'feet' ? 'feet' : 'yards') as 'yards' | 'feet'
        })),
    [shots, clubs]
  );

  if (isLoading) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100%' }}>
        <CircularProgress size={20} />
      </Box>
    );
  }

  if (error || !layout) {
    return (
      <Box sx={{ display: 'grid', placeItems: 'center', height: '100%', px: 2 }}>
        <Typography variant="caption" color="text.secondary" align="center">
          No map available for this hole.
        </Typography>
      </Box>
    );
  }

  // READ ONLY, and that is a matter of which props are absent rather than a
  // flag: no `onShotLanded` (so a tap records nothing), no `aimMode`, no
  // `onShotEndPointMoved` (so the dots can't be dragged), no pin editing.
  // `interactive` is pan and zoom only — a spectator can look anywhere on the
  // hole, and change nothing.
  return (
    <HoleLayout
      layout={layout}
      compact={compact}
      interactive
      recenterRef={recenterRef}
      shotEndPoints={shotEndPoints}
      shotLabels={shotLabels}
    />
  );
}
