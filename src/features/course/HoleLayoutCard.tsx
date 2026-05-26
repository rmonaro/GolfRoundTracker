import { Box, Card, CardContent, Chip, CircularProgress, Stack, Typography } from '@mui/material';
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
  par,
  yardage,
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
        sx={{
          bgcolor: 'background.paper',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden'
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
        {(par != null || yardage != null) && (
          <Stack
            direction="row"
            spacing={0.75}
            sx={{
              p: 0.75,
              borderTop: 1,
              borderColor: 'divider',
              bgcolor: 'background.paper'
            }}
          >
            {par != null && (
              <Chip
                size="small"
                label={`Par ${par}`}
                sx={{ fontWeight: 600 }}
              />
            )}
            {yardage != null && (
              <Chip size="small" label={`${yardage} yds`} sx={{ fontWeight: 600 }} />
            )}
            <Box sx={{ flex: 1 }} />
            <Chip
              size="small"
              label={`Hole ${holeNumber}`}
              color="primary"
              variant="outlined"
              sx={{ fontWeight: 700 }}
            />
          </Stack>
        )}
      </Card>
    );
  }

  // Fallback: pending or unavailable. Render a clean card with par/yardage chips.
  const message =
    status === 'pending'
      ? 'Hole layout syncing — try again shortly.'
      : status === 'loading'
        ? 'Loading layout…'
        : 'No layout available for this course.';

  return (
    <Card
      elevation={0}
      sx={{
        bgcolor: 'background.paper',
        height: '100%',
        display: 'flex',
        flexDirection: 'column'
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
        <Stack direction="row" spacing={0.75} mt={0.5}>
          {par != null && <Chip size="small" label={`Par ${par}`} />}
          {yardage != null && <Chip size="small" label={`${yardage} yds`} />}
        </Stack>
      </CardContent>
    </Card>
  );
}
