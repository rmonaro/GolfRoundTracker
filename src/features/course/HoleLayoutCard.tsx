import { Box, Card, CardContent, CircularProgress, Typography } from '@mui/material';
import GolfCourseRoundedIcon from '@mui/icons-material/GolfCourseRounded';
import { useHoleLayout } from './useHoleLayout';
import { HoleLayout } from './HoleLayout';
import type { BagClub, Lie, TargetResult } from '@/models';

interface HoleLayoutCardProps {
  courseId: string | null | undefined;
  holeNumber: number;
  /** Fallback metadata when the layout isn't ready / available — shown so the card still feels informative. */
  par?: number | null;
  yardage?: number | null;
  /** When true: smaller markers, tighter padding, fills width — used inside HoleTracking. */
  compact?: boolean;
  /**
   * Tee-shot planning mode — hides the walkback markers and shows a draggable
   * distance-from-tee handle on the centerline. See HoleLayout for details.
   */
  aimMode?: boolean;
  /** Sum of prior shot distances in meters; passed to HoleLayout for ball position. */
  ballDistanceFromTeeM?: number;
  /** Optional initial-handle hint for aim mode (meters from tee along centerline). */
  suggestedHandleDistanceM?: number;
  /** Last shot ended on the green — zoom map to the green polygon. */
  puttingMode?: boolean;
  /** User's bag clubs — passed to aim mode for the club recommendation. */
  bagClubs?: BagClub[];
  /** Tap-to-record callback. See HoleLayoutProps.onShotLanded. */
  onShotLanded?: (data: {
    start: [number, number];
    end: [number, number];
    calculatedDistanceM: number;
    inferredLie: Lie | null;
    inferredTargetResult: TargetResult | null;
  }) => void;
}

export function HoleLayoutCard({
  courseId,
  holeNumber,
  compact = false,
  aimMode = false,
  ballDistanceFromTeeM = 0,
  suggestedHandleDistanceM,
  puttingMode = false,
  bagClubs,
  onShotLanded
}: HoleLayoutCardProps) {
  const { data, status } = useHoleLayout(courseId, holeNumber);

  // Don't render anything when there's no course at all (e.g. user-added course
  // pre-OSM-sync). Phase 6 enhancement will make sure the picker surfaces this.
  if (status === 'none') return null;

  if (status === 'ready' && data) {
    return (
      <Card
        elevation={0}
        square
        sx={{
          bgcolor: 'background.paper',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
          borderRadius: 0
        }}
      >
        <Box sx={{ flex: 1, minHeight: compact ? 160 : 240 }}>
          <HoleLayout
            layout={data}
            compact={compact}
            aimMode={aimMode}
            ballDistanceFromTeeM={ballDistanceFromTeeM}
            suggestedHandleDistanceM={suggestedHandleDistanceM}
            puttingMode={puttingMode}
            bagClubs={bagClubs}
            onShotLanded={onShotLanded}
          />
        </Box>
      </Card>
    );
  }

  // Fallback: pending or unavailable. Just a centered status message — the
  // par / yardage info now lives in the page header and the left "TO PIN"
  // overlay, so we don't need duplicate chips here.
  const message =
    status === 'pending'
      ? 'Hole layout syncing — try again shortly.'
      : status === 'loading'
        ? 'Loading layout…'
        : 'No layout available for this course.';

  return (
    <Card
      elevation={0}
      square
      sx={{
        bgcolor: 'background.paper',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 0
      }}
    >
      <CardContent
        sx={{
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1
        }}
      >
        {status === 'loading' ? (
          <CircularProgress size={20} />
        ) : (
          <GolfCourseRoundedIcon sx={{ color: 'text.secondary', fontSize: 32 }} />
        )}
        <Typography variant="caption" color="text.secondary" align="center">
          {message}
        </Typography>
      </CardContent>
    </Card>
  );
}
