import { Box, Card, CardContent, CircularProgress, Typography } from '@mui/material';
import GolfCourseRoundedIcon from '@mui/icons-material/GolfCourseRounded';
import { useHoleLayout } from './useHoleLayout';
import { HoleLayout } from './HoleLayout';
import type { BagClub, Lie, TargetResult, TargetType } from '@/models';

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
  /** Pending landing point marker. See HoleLayoutProps.landingPoint. */
  landingPoint?: [number, number] | null;
  /** Recorded-shot end positions. See HoleLayoutProps.shotEndPoints. */
  shotEndPoints?: Array<[number, number]>;
  /** Per-shot label data (# / club / distance), aligned with shotEndPoints. */
  shotLabels?: Array<{ club: string | null; distance: string | null }>;
  /** Suppress aim handle / line while a landing-point pin is active. */
  hideAim?: boolean;
  /** Render the aim handle as a compact dot instead of the crosshair. */
  useTargetDot?: boolean;
  /** Per-round pin position override [lng, lat]. */
  pinOverride?: [number, number] | null;
  /** Bag-reach cap for initial aim position on shots off the tee. */
  maxAimDistanceFromBallM?: number;
  /** Upcoming shot's target type — drives tap-to-record hit classification. */
  targetType?: TargetType;
  /** Toggle the 100/150/200/250 centerline yardage markers in aim mode. */
  showYardageMarkers?: boolean;
  /** Live user position [lng, lat] for the auto-track "you are here" dot. */
  currentLocation?: [number, number] | null;
  /** Opaque key whose change clears the cached drag aim — bumped by the
   *  parent when stored par/yardage edits should re-anchor the handle. */
  aimResetKey?: string | number | null;
  /** Scales every yardage / feet display number on the map so the aim
   *  handle label matches the "TO PIN" panel after a player-overridden
   *  yardage. user_yardage / osm_yardage. */
  yardageScale?: number;
  /** Enables drag-to-move on each numbered shot dot. Fires with the
   *  index + new [lng, lat] on drag-end. */
  onShotEndPointMoved?: (index: number, newPos: [number, number]) => void;
  /** Recap replay trigger — bump to a fresh positive number to animate the
   *  tee → shots → pin line with sequential dot reveals. See HoleLayout. */
  recapToken?: number;
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
  onShotLanded,
  landingPoint = null,
  shotEndPoints = [],
  shotLabels = [],
  hideAim = false,
  useTargetDot = false,
  pinOverride = null,
  maxAimDistanceFromBallM,
  targetType,
  showYardageMarkers = false,
  currentLocation = null,
  aimResetKey = null,
  yardageScale = 1,
  onShotEndPointMoved,
  recapToken
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
            landingPoint={landingPoint}
            shotEndPoints={shotEndPoints}
            shotLabels={shotLabels}
            hideAim={hideAim}
            useTargetDot={useTargetDot}
            pinOverride={pinOverride}
            maxAimDistanceFromBallM={maxAimDistanceFromBallM}
            targetType={targetType}
            showYardageMarkers={showYardageMarkers}
            currentLocation={currentLocation}
            aimResetKey={aimResetKey}
            yardageScale={yardageScale}
            onShotEndPointMoved={onShotEndPointMoved}
            recapToken={recapToken}
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
