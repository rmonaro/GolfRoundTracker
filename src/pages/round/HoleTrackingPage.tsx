import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Drawer,
  Fab,
  IconButton,
  InputAdornment,
  Stack,
  TextField,
  Typography
} from '@mui/material';
import ArrowBackIosNewRoundedIcon from '@mui/icons-material/ArrowBackIosNewRounded';
import ArrowForwardIosRoundedIcon from '@mui/icons-material/ArrowForwardIosRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import FlagCircleRoundedIcon from '@mui/icons-material/FlagCircleRounded';
import EditLocationAltRoundedIcon from '@mui/icons-material/EditLocationAltRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import SportsGolfRoundedIcon from '@mui/icons-material/SportsGolfRounded';
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded';
import MyLocationRoundedIcon from '@mui/icons-material/MyLocationRounded';
import StopCircleRoundedIcon from '@mui/icons-material/StopCircleRounded';
import StraightenRoundedIcon from '@mui/icons-material/StraightenRounded';
import CenterFocusStrongRoundedIcon from '@mui/icons-material/CenterFocusStrongRounded';
import PlayArrowRoundedIcon from '@mui/icons-material/PlayArrowRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import HelpOutlineRoundedIcon from '@mui/icons-material/HelpOutlineRounded';
import {
  ensureGpsPermission,
  getCurrentPosition,
  haversineMeters,
  isGpsAvailable,
  watchPosition,
  type GpsPoint
} from '@/services/gpsService';
import { useAutoTrack, type ShotDetected } from '@/features/round/useAutoTrack';
import { RoundTour, type TourStep } from '@/features/round/RoundTour';
import { PuttModePanel } from '@/features/round/PuttModePanel';
import { useNavigate, Navigate } from 'react-router-dom';
import { useRoundStore, type LocalHole, type LocalShot } from '@/stores/roundStore';
import { useBagStore } from '@/stores/bagStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useWatchHintsStore } from '@/stores/watchHintsStore';
import { abbreviateClubName } from '@/features/bag/abbreviateClubName';
import { useAutosaveHole } from '@/features/round/useAutosaveHole';
import { useTmRoundSync } from '@/features/tournaments/useTmRoundSync';
import { useTournamentResumeReconcile } from '@/features/tournaments/useTournamentResumeReconcile';
import {
  AddShotSheet,
  ClubPicker,
  RESULT_LABELS,
  tier1ForCategory,
  type ClubTier1,
  type ShotEditDraft
} from '@/features/round/AddShotSheet';
import { PENALTY_LABELS } from '@/features/round/ShotSelectors';
import { HoleLayoutCard } from '@/features/course/HoleLayoutCard';
import { useHoleLayout } from '@/features/course/useHoleLayout';
import { metersToYards } from '@/features/course/distance';
import {
  recommendClub,
  classifyTap,
  teeToGreenBearing
} from '@/features/course/HoleLayout';
import { WindIndicator } from '@/components/ui/WindIndicator';
import { useWind } from '@/hooks/useWind';
import { bearingDeg } from '@/services/weatherService';
import { watchBridge, type WatchInboundMessage } from '@/services/watchBridge';
import { computeCompletedTotals, computeTotalScore } from '@/features/round/computeRoundTotals';
import { scoreVsPar } from '@/utils/format';
import { roundRepo } from '@/services/roundRepo';
import { bagRepo } from '@/services/bagRepo';
import { courseRepo } from '@/services/courseRepo';
import { holesRepo } from '@/services/holesRepo';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  STROKE_PENALTY_TYPES,
  type BagClub,
  type FairwayResult,
  type PenaltyType,
  type TargetType,
  type TargetResult
} from '@/models';

/** Human label for the watch's post-save overview, e.g. "Fairway" / "Left". */
function watchResultLabel(targetType: TargetType, r: TargetResult): string {
  switch (r) {
    case 'hit':
      return targetType === 'fairway' ? 'Fairway' : targetType === 'green' ? 'Green' : 'Hit';
    case 'left':
      return 'Left';
    case 'right':
      return 'Right';
    case 'long':
      return 'Long';
    case 'short':
      return 'Short';
    case 'made':
      return 'Made';
    case 'missed':
      return 'Missed';
    default:
      return 'Shot';
  }
}

export function HoleTrackingPage() {
  const active = useRoundStore((s) => s.active);
  const updateHole = useRoundStore((s) => s.updateHole);
  const setCurrentHole = useRoundStore((s) => s.setCurrentHole);
  const addShotLocal = useRoundStore((s) => s.addShot);
  const updateShotLocal = useRoundStore((s) => s.updateShot);
  const removeShotLocal = useRoundStore((s) => s.removeShot);
  const markShotSynced = useRoundStore((s) => s.markShotSynced);
  const bagClubs = useBagStore((s) => s.clubs);
  const setBagClubs = useBagStore((s) => s.setClubs);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  // Tournament rounds push live scores + shots to TM as the round is played.
  // No-op for normal rounds (the hook checks the active round's TM linkage).
  const { syncHole, finalizeRound } = useTmRoundSync();
  // Heal a stale/empty local store against the DB on resume (tournament rounds).
  useTournamentResumeReconcile();
  const [shotSheet, setShotSheet] = useState(false);
  const [editingShot, setEditingShot] = useState<LocalShot | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [shotsDrawerOpen, setShotsDrawerOpen] = useState(false);
  /** Phone-side mirror of the watch's tracking state. Set true when the
   *  watch sends trackingShot(active:true) and false on (active:false)
   *  or when a recordShot arrives (the shot is now saved). */
  const [watchTracking, setWatchTracking] = useState<{
    active: boolean;
    startLat: number | null;
    startLng: number | null;
    currentLat: number | null;
    currentLng: number | null;
  }>({
    active: false,
    startLat: null,
    startLng: null,
    currentLat: null,
    currentLng: null
  });
  // GPS shot tracking — capture start on tap, stop captures end + opens
  // AddShotSheet pre-filled with the calculated distance.
  // GPS opt-in. Off by default so we don't prompt non-GPS users for location.
  const gpsEnabled = useSettingsStore((s) => s.gpsEnabled);
  const watchShotDetectionEnabled = useSettingsStore((s) => s.watchShotDetectionEnabled);
  const roundTourCompleted = useSettingsStore((s) => s.roundTourCompleted);
  const setRoundTourCompleted = useSettingsStore((s) => s.setRoundTourCompleted);

  // At-course detection. Skipped entirely when GPS is disabled.
  const courseQuery = useQuery({
    queryKey: ['course', active?.courseId],
    enabled: !!active?.courseId && gpsEnabled,
    queryFn: () => (active?.courseId ? courseRepo.getOne(active.courseId) : null)
  });
  const [userLoc, setUserLoc] = useState<{ lat: number; lng: number } | null>(null);
  useEffect(() => {
    if (!gpsEnabled || !isGpsAvailable()) return;
    let mounted = true;
    (async () => {
      try {
        await ensureGpsPermission();
        const pt = await getCurrentPosition({ maximumAge: 30_000 });
        if (mounted) setUserLoc({ lat: pt.lat, lng: pt.lng });
      } catch {
        // Best-effort; at-course detection is non-critical.
      }
    })();
    return () => {
      mounted = false;
    };
  }, [gpsEnabled]);
  const atCourseStatus = (() => {
    const cLat = courseQuery.data?.lat;
    const cLng = courseQuery.data?.lng;
    if (cLat == null || cLng == null || !userLoc) return null;
    const distM = haversineMeters(
      { ...userLoc, accuracyM: 0, timestamp: 0 },
      { lat: cLat, lng: cLng, accuracyM: 0, timestamp: 0 }
    );
    // Courses span 1-2 km. 2 km buffer from the centroid is generous coverage.
    return { distM, atCourse: distM < 2000 };
  })();

  // Auto-track mode: when ON, a continuous GPS watch + state machine
  // detects shots automatically by spotting "walked >10m then stopped for
  // 8s" patterns. See useAutoTrack for the heuristic. The manual
  // start/stop tracking flow has been retired; the GPS FAB now toggles
  // auto-track instead.
  const [autoTrackEnabled, setAutoTrackEnabled] = useState(false);
  const [trackingBusy, setTrackingBusy] = useState(false);
  // Always-on "you are here" fix. Kept updated by its own GPS watch whenever
  // GPS is enabled and the user isn't auto-tracking (auto-track supplies its
  // own fix). This is what keeps the blue dot on the map at all times — it
  // never gets cleared by marking a position or recording a shot.
  const [liveFix, setLiveFix] = useState<GpsPoint | null>(null);
  const [trackingError, setTrackingError] = useState<string | null>(null);
  // Club pre-selection: the user picks a club on the main screen so the next
  // shot opens with it already chosen. Resets when the hole changes (see effect
  // below); within a hole it persists across multiple shots so the user can
  // line up two pitches in a row without re-tapping the picker.
  const [selectedClubId, setSelectedClubId] = useState<string | null>(null);
  const [selectedClubTier1, setSelectedClubTier1] = useState<ClubTier1 | null>(null);
  const [clubPickerOpen, setClubPickerOpen] = useState(false);
  // Pin-edit mode: when on, the next tap on the map sets this hole's pin
  // position (stored on the LocalHole as pinLat/pinLng) and exits the mode.
  // Hides the aim UI and disables tap-to-record-shot while active so the
  // tap is unambiguous.
  const [pinEditMode, setPinEditMode] = useState(false);
  const [showYardageMarkers, setShowYardageMarkers] = useState(false);
  // HoleLayout publishes its "recenter on the hole overview" action here so the
  // floating recenter button (above the yardage toggle) can call it.
  const recenterMapRef = useRef<(() => void) | null>(null);
  // Bumped by the post-hole "Recap" button to replay the shots as a growing
  // tee → landings → pin line with the numbered dots popping in one by one.
  const [recapToken, setRecapToken] = useState(0);
  // Newest confirmed ball-strike pushed from the watch. Fed to useAutoTrack,
  // where each strike auto-records a shot. Null until the watch sends one;
  // without a watch, no shots are auto-detected (manual Add Shot only).
  const [lastImpact, setLastImpact] = useState<{
    impactId: number;
    capturedAt: number;
  } | null>(null);
  // True while the watch strike stream is "live" — flipped on each roundImpact
  // and cleared by a staleness timeout. Gates impact-primary mode: only when
  // strikes are actually arriving do we hand detection to the watch. When no
  // watch is streaming, the phone only tracks position — it does not auto-detect
  // shots from its own GPS movement.
  const [strikeStreamLive, setStrikeStreamLive] = useState(false);
  const strikeStaleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Headless auto-commit handler, assigned below once onSubmitShot exists.
  // Routed through a ref so the (earlier-defined) useAutoTrack callback can
  // reach it without a temporal-dead-zone reference.
  const autoCommitRef = useRef<((shot: ShotDetected) => void) | null>(null);
  // Per-hole shot-verification dialog (auto-detected shots awaiting review).
  const [verifyOpen, setVerifyOpen] = useState(false);
  // Tracks which hole we've already auto-prompted for verification so closing
  // the dialog doesn't immediately reopen it on the next render.
  const promptedHoleRef = useRef<number | null>(null);
  const [pendingGps, setPendingGps] = useState<{
    startLat: number;
    startLng: number;
    endLat: number;
    endLng: number;
    calculatedDistanceM: number;
    inferredLie?: import('@/models').Lie | null;
    inferredTargetResult?: import('@/models').TargetResult | null;
  } | null>(null);

  // Enable/disable auto-tracking. On enable: check GPS availability +
  // permission + at-course, then arm the state machine. On disable: the
  // useAutoTrack hook tears down its watch via the enabled=false branch.
  // Shared by the on-screen FAB and the watch's synced Track toggle.
  const applyAutoTrack = async (enable: boolean) => {
    if (!enable) {
      setAutoTrackEnabled(false);
      setTrackingError(null);
      return;
    }
    if (autoTrackEnabled) return;
    if (!isGpsAvailable()) {
      setTrackingError('GPS not available on this device');
      return;
    }
    setTrackingBusy(true);
    setTrackingError(null);
    try {
      const status = await ensureGpsPermission();
      if (status.location !== 'granted' && status.coarseLocation !== 'granted') {
        setTrackingError('Location permission denied. Enable it in device Settings.');
        return;
      }
      const pt = await getCurrentPosition();
      // Bail if the user is far from the course — auto-track is pointless
      // unless they're actually playing. 2km matches the at-course chip.
      const cLat = courseQuery.data?.lat;
      const cLng = courseQuery.data?.lng;
      if (cLat != null && cLng != null) {
        const distM = haversineMeters(
          { lat: pt.lat, lng: pt.lng, accuracyM: 0, timestamp: 0 },
          { lat: cLat, lng: cLng, accuracyM: 0, timestamp: 0 }
        );
        if (distM > 2000) {
          const miles = (distM / 1609.344).toFixed(1);
          setTrackingError(
            `You're ${miles} mi from ${active?.courseName ?? 'the course'} — tracking won't start.`
          );
          setUserLoc({ lat: pt.lat, lng: pt.lng });
          return;
        }
      }
      setUserLoc({ lat: pt.lat, lng: pt.lng });
      setAutoTrackEnabled(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not get current location';
      setTrackingError(
        /denied|permission/i.test(msg)
          ? 'Location permission denied. Enable it in device Settings.'
          : msg
      );
    } finally {
      setTrackingBusy(false);
    }
  };
  const onToggleAutoTrack = () => applyAutoTrack(!autoTrackEnabled);

  if (!active) return <Navigate to="/round" replace />;

  const idx = Math.max(0, Math.min(active.holes.length - 1, active.currentHoleIndex));
  const hole = active.holes[idx];

  // Derived values — everything reads off the shot list now.
  //   strokes        = total shots logged
  //   putts          = shots whose club category is putter
  //   penaltyStrokes = shots tagged with a stroke-adding penalty (excludes Bunker)
  //   fairwayResult  = shot 1's fairway target outcome on par 4/5 (else 'na')
  //   sand           = any shot landed in / from a bunker
  //   gir            = (strokes - putts) <= (par - 2), i.e. on green in regulation
  const strokes = hole.shots.length;
  const putts = hole.shots.filter((s) => isPutterShot(s, bagClubs)).length;
  const penaltyStrokes = hole.shots.filter((s) => isStrokePenalty(s.penaltyType)).length;
  const fairwayResult = deriveFairwayResult(hole);
  const sand = hole.shots.some((s) => s.lie === 'bunker' || s.penaltyType === 'bunker');
  const gir = strokes > 0 && (strokes - putts) <= Math.max(1, hole.par - 2);

  const holeScore = strokes + penaltyStrokes;

  // Round-wide totals for the Score pill in the map overlay. Only counts
  // holes the user has navigated past — the in-progress hole's running
  // strokes don't move the round total. Displays "--" until the first
  // hole is finished so the user doesn't see a misleading "E" at the
  // very start.
  const completedTotals = computeCompletedTotals(active);
  const totalRoundDiff =
    completedTotals.completedCount === 0
      ? '--'
      : scoreVsPar(completedTotals.score, completedTotals.par);

  // Cumulative distance traveled along the playing line. Used by HoleLayout's
  // aim mode to project the ball's current position along the centerline so
  // the aim line for shot N+1 originates from where the ball actually is.
  // Putts (distanceUnit = 'feet') are kept in feet→yards form for consistency.
  const ballDistanceFromTeeM = hole.shots.reduce((acc, s) => {
    if (s.distance == null) return acc;
    const yds = s.distanceUnit === 'feet' ? s.distance / 3 : s.distance;
    return acc + yds * 0.9144;
  }, 0);

  // Recorded shot end positions (in chronological order) for rendering the
  // numbered amber dots on the map. Shots without GPS coords are dropped so
  // we don't render markers at [null, null]. The LAST one also becomes the
  // aim-line origin in HoleLayout, overriding the centerline walk.
  //
  // Memoized so the array identity is stable when the underlying shot list
  // hasn't actually changed — otherwise the HoleLayout map effect, which
  // has shotEndPoints in its deps, would tear down and recreate the entire
  // Mapbox instance on every parent render (e.g. every tap that sets
  // pendingGps).
  const shotEndPoints: Array<[number, number]> = useMemo(
    () =>
      hole.shots
        .filter((s) => s.endLat != null && s.endLng != null)
        .map((s) => [s.endLng as number, s.endLat as number] as [number, number]),
    [hole.shots]
  );

  // Per-dot info-box labels (# / club / distance), aligned 1:1 with
  // shotEndPoints (same filter + order). Club is abbreviated; distance is
  // preformatted — yards for full shots, feet for putts.
  const shotLabels = useMemo(
    () =>
      hole.shots
        .filter((s) => s.endLat != null && s.endLng != null)
        .map((s) => {
          const club = s.clubId ? bagClubs.find((c) => c.clubId === s.clubId) ?? null : null;
          const clubName = club
            ? abbreviateClubName(club.customName?.trim() || club.name, club.category)
            : null;
          const distance =
            s.distance == null
              ? null
              : s.distanceUnit === 'feet'
                ? `${Math.round(s.distance)}ft`
                : `${Math.round(s.distance)}y`;
          return { club: clubName, distance };
        }),
    [hole.shots, bagClubs]
  );

  // Smart aim-handle hint: on 3rd+ shots, when the ball isn't on the green,
  // seed the handle at "ball position + previous shot distance" along the
  // centerline. Better starting point than the pin for short approach work.
  const lastShot = hole.shots[hole.shots.length - 1];
  const lastShotDistanceM =
    lastShot?.distance != null
      ? (lastShot.distanceUnit === 'feet' ? lastShot.distance / 3 : lastShot.distance) *
        0.9144
      : 0;

  // Layout query first so the on-the-green check below can use the green's
  // canonical coords to test how close the last shot landed. TanStack Query
  // dedupes this call with HoleLayoutCard's own fetch.
  const layoutQuery = useHoleLayout(active.courseId, hole.holeNumber);

  // Pin override (course-wide shared pin → legacy per-round → null).
  // Memoized for the same reason as shotEndPoints — a fresh [lng,lat] array
  // on every render would invalidate the HoleLayout map effect's deps and
  // cause a full Mapbox rebuild on every tap.
  const sharedPinLng = layoutQuery.data?.hole.pin_lng ?? null;
  const sharedPinLat = layoutQuery.data?.hole.pin_lat ?? null;
  const localPinLng = hole.pinLng;
  const localPinLat = hole.pinLat;
  const pinOverride = useMemo<[number, number] | null>(() => {
    if (sharedPinLng != null && sharedPinLat != null) return [sharedPinLng, sharedPinLat];
    if (localPinLng != null && localPinLat != null) return [localPinLng, localPinLat];
    return null;
  }, [sharedPinLng, sharedPinLat, localPinLng, localPinLat]);

  // Did the last shot land within ~30 yards (≈27 m) of the green? This covers
  // "around the green" — a chip-shot landing zone where the next stroke is
  // almost certainly a putt or a chip, and the player wants the close-up
  // green view rather than the wide tee→green framing.
  const greenLat = layoutQuery.data?.hole.green_lat ?? null;
  const greenLng = layoutQuery.data?.hole.green_lng ?? null;
  // Tee coords — the start anchor for shot 1's GPS auto-measure (the player is
  // at the tee before the drive, so the drive's start is the tee).
  const teeLat = layoutQuery.data?.hole.tee_lat ?? null;
  const teeLng = layoutQuery.data?.hole.tee_lng ?? null;
  const AROUND_GREEN_THRESHOLD_M = 27;
  let lastShotEndDistFromGreenM: number | null = null;
  if (
    lastShot?.endLat != null &&
    lastShot?.endLng != null &&
    greenLat != null &&
    greenLng != null
  ) {
    lastShotEndDistFromGreenM = haversineMeters(
      { lat: lastShot.endLat, lng: lastShot.endLng, accuracyM: 0, timestamp: 0 },
      { lat: greenLat, lng: greenLng, accuracyM: 0, timestamp: 0 }
    );
  }
  const lastShotAroundGreen =
    lastShotEndDistFromGreenM != null &&
    lastShotEndDistFromGreenM <= AROUND_GREEN_THRESHOLD_M;

  // The player is "on the green" (i.e. should see the zoomed-green view, no
  // aim target, putter auto-selected) when any of these are true:
  //   • the last recorded shot's lie is green (e.g. approach stuck the green)
  //   • the last recorded shot was a putt (even a miss → still on the green)
  //   • the user manually picked a putter on the main-screen club selector
  //   • the last shot's GPS end position is within ~30 yds of the pin
  //     (catches "near miss" / chip-shot situations where the player is
  //     effectively around the green even if the lie wasn't tagged)
  const lastShotClub = lastShot
    ? bagClubs.find((c) => c.clubId === lastShot.clubId) ?? null
    : null;
  const lastShotWasPutt = lastShotClub?.category === 'putter';
  const selectedClubObj = selectedClubId
    ? bagClubs.find((c) => c.clubId === selectedClubId) ?? null
    : null;
  const userPickedPutter = selectedClubObj?.category === 'putter';
  const lastShotOnGreen =
    lastShot?.lie === 'green' ||
    lastShotWasPutt ||
    userPickedPutter ||
    lastShotAroundGreen;
  const suggestedHandleDistanceM =
    hole.shots.length >= 2 && !lastShotOnGreen && lastShotDistanceM > 0
      ? ballDistanceFromTeeM + lastShotDistanceM
      : undefined;

  // Longest carry in the bag (any non-putter club with a recorded typical
  // distance). Drives the aim-handle bag-reach cap below — on shots off the
  // tee, the default aim won't sit further out than the player can actually
  // reach. Drives are included since the user CAN swing one off the deck
  // even if it's not recommended.
  const maxBagCarryYds = bagClubs.reduce((acc, c) => {
    if (c.category === 'putter') return acc;
    if (c.typicalDistanceYards == null) return acc;
    return Math.max(acc, c.typicalDistanceYards);
  }, 0);
  // Skip the cap entirely on shot 1 (driver handles it) by passing undefined
  // when the ball is still at the tee.
  const maxAimDistanceFromBallM =
    ballDistanceFromTeeM > 0 && maxBagCarryYds > 0
      ? maxBagCarryYds * 0.9144
      : undefined;

  // Display yardage + remaining yards needed early so the recommended-club
  // computation below can hand the right distance to `recommendClub`. These
  // are also read by the TO PIN overlay further down.
  const osmYardsEarly =
    layoutQuery.data?.hole.centerline_distance_m != null
      ? Math.round(metersToYards(layoutQuery.data.hole.centerline_distance_m))
      : null;
  const displayYardsEarly = hole.yardage ?? osmYardsEarly;
  const ballDistanceYdsEarly = ballDistanceFromTeeM / 0.9144;
  const remainingYardsEarly =
    displayYardsEarly != null
      ? Math.max(0, Math.round(displayYardsEarly - ballDistanceYdsEarly))
      : null;

  // Strict "ball is actually on the putting surface" check — used only for
  // the putter auto-select below. Excludes the "within ~30 yds of the pin"
  // heuristic that `lastShotOnGreen` includes for the broader UI (zoom,
  // aim suppression); chips from the fringe or rough should suggest a
  // wedge, not a putter, even when you're close to the pin.
  //   • last shot's lie was explicitly green
  //   • last shot was a putt (you were on the green when it was taken)
  //   • last shot was an approach to the green tagged as a hit
  //   • the user already picked the putter for the next shot
  const ballOnGreen =
    lastShot?.lie === 'green' ||
    lastShotWasPutt ||
    (lastShot?.targetType === 'green' && lastShot?.targetResult === 'hit') ||
    userPickedPutter;

  // Pre-select the user's putter when on the green. Uses the first putter in
  // the bag (most users have only one). The user-driven `selectedClubId`
  // overrides this auto-pick, but when the user already picked the putter
  // this just re-affirms it.
  const putterAutoClubId = ballOnGreen
    ? bagClubs.find((c) => c.category === 'putter')?.clubId ?? null
    : null;
  // Auto-recommend club based on remaining distance to the pin. Only fires
  // off-green (putters handle themselves above) and only when we have a
  // distance to work with. The recommendation is bag-relative: closest
  // typicalDistanceYards to remainingYards. Slots into `defaultClubId` as
  // the LAST fallback so a manual pick or putter auto-select still wins.
  //
  // Driver exclusion rule: once the ball is off the tee (anywhere past
  // ballDistanceFromTeeM > 0) AND the remaining shot is long (> 200 yds),
  // never suggest the driver — you don't swing one off the deck. The
  // recommender falls back to the longest non-driver in the bag (typically
  // a 3-wood or hybrid). For shot 1 from the tee we still allow the driver.
  const excludeDriverForRec =
    ballDistanceFromTeeM > 0 &&
    remainingYardsEarly != null &&
    remainingYardsEarly > 200;
  const recommendedClubId =
    !ballOnGreen && remainingYardsEarly != null && remainingYardsEarly > 0
      ? recommendClub(bagClubs, remainingYardsEarly, {
          excludeDriver: excludeDriverForRec
        })?.clubId ?? null
      : null;
  const defaultClubId = selectedClubId ?? putterAutoClubId ?? recommendedClubId;
  const selectedClub = bagClubs.find((c) => c.clubId === defaultClubId) ?? null;

  // Mirror the phone's local UI state into the watch hints store so the
  // root-level useWatchSync can include it in the next snapshot push.
  // `recordingShot` flips true whenever the user has either staged a landing
  // point (pendingGps) or opened the shot-record sheet — those are the two
  // states where the watch should switch to "Recording: <club>" mode.
  const setWatchSelectedClubId = useWatchHintsStore((s) => s.setSelectedClubId);
  const setWatchRecordingShot = useWatchHintsStore((s) => s.setRecordingShot);
  const setWatchAtCourse = useWatchHintsStore((s) => s.setAtCourse);
  const setWatchAutoTracking = useWatchHintsStore((s) => s.setAutoTracking);
  const setWatchLastShotSummary = useWatchHintsStore((s) => s.setLastShotSummary);
  useEffect(() => {
    setWatchSelectedClubId(defaultClubId ?? null);
  }, [defaultClubId, setWatchSelectedClubId]);
  useEffect(() => {
    setWatchRecordingShot(shotSheet || pendingGps != null);
  }, [shotSheet, pendingGps, setWatchRecordingShot]);
  // Mirror at-course + auto-track state into the watch snapshot so the watch can
  // hide its controls off-course and render Track as a synced toggle.
  const watchAtCourse = atCourseStatus ? atCourseStatus.atCourse : null;
  useEffect(() => {
    setWatchAtCourse(watchAtCourse);
  }, [watchAtCourse, setWatchAtCourse]);
  useEffect(() => {
    setWatchAutoTracking(autoTrackEnabled);
  }, [autoTrackEnabled, setWatchAutoTracking]);
  // Reset the user club pick whenever the hole changes — each new hole starts
  // with a blank slate so the picker doesn't carry e.g. a wedge over to a tee
  // shot on the next hole.
  useEffect(() => {
    setSelectedClubId(null);
    setSelectedClubTier1(null);
    setPinEditMode(false);
  }, [hole.holeNumber]);

  // The Move Pin button is hidden when the player isn't on the green. If
  // they leave the green while pin-edit mode is active (rare — usually they'd
  // tap to set first), clear the flag so subsequent map taps aren't
  // misinterpreted as pin placements.
  useEffect(() => {
    if (!lastShotOnGreen && pinEditMode) setPinEditMode(false);
  }, [lastShotOnGreen, pinEditMode]);

  // Auto-select the putter whenever the last recorded shot signals the ball
  // is on the green. Three signals — any one is enough:
  //   • lie === 'green'                                (explicit)
  //   • targetType === 'green' && targetResult === 'hit' (approach stuck it)
  //   • targetType === 'putt'                           (a putt was taken;
  //                                                       next shot is another
  //                                                       putt, made or missed)
  // Keyed off shot count + the relevant per-shot fields so it fires once per
  // arrival on the green. User can still override by tapping a different
  // club in the main-screen picker.
  const lastShotLie = lastShot?.lie ?? null;
  const lastShotTargetType = lastShot?.targetType ?? null;
  const lastShotTargetResult = lastShot?.targetResult ?? null;
  useEffect(() => {
    const onGreenSignal =
      lastShotLie === 'green' ||
      (lastShotTargetType === 'green' && lastShotTargetResult === 'hit') ||
      lastShotTargetType === 'putt';
    if (!onGreenSignal) return;
    const putterId = bagClubs.find((c) => c.category === 'putter')?.clubId ?? null;
    if (!putterId) return;
    setSelectedClubId(putterId);
    setSelectedClubTier1('putter');
    // bagClubs is stable across a session (Zustand store), so excluding it
    // from deps avoids an extra fire on initial mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hole.shots.length, lastShotLie, lastShotTargetType, lastShotTargetResult]);

  // Yardage display rules (header chip + HoleLayoutCard chips):
  //   1. Prefer the user-entered hole.yardage (explicit override via HoleDetailsDialog)
  //   2. Fall back to the OSM centerline_distance_m from the cached layout row,
  //      converted to yards. This is the same value the amber-line label shows.
  //   3. Otherwise null — chips show "—" / "0 yds" depending on consumer.
  const osmYards = layoutQuery.data?.hole.centerline_distance_m != null
    ? Math.round(metersToYards(layoutQuery.data.hole.centerline_distance_m))
    : null;
  const displayYards = hole.yardage ?? osmYards;
  // Prefer the course-level (OSM) par when we have it — that's the
  // authoritative value for the hole. Falls back to the local round's stored
  // par (which is seeded from the course's total_par / holesPlayed default
  // when the round was created) and finally null for the "—" display.
  const osmPar = layoutQuery.data?.hole.par ?? null;
  const displayPar = osmPar ?? hole.par;

  // Heal mis-seeded per-hole par. Old rounds were started with every hole
  // initialised to course-average par, which means a par-3 hole could have
  // a stored par of 2 or 4 — making scoreVsPar wrong (3 strokes on a "par
  // 2" reads as "+1" instead of "E"). Once we know the authoritative OSM
  // par, push it back into the local hole; autosave then persists the
  // correction to round_holes.par.
  useEffect(() => {
    if (osmPar != null && osmPar !== hole.par) {
      updateHole(hole.holeNumber, { par: osmPar });
    }
  }, [osmPar, hole.par, hole.holeNumber, updateHole]);

  // Target type for the upcoming shot — drives tap-to-record classification
  // on the map. Mirrors the rules in AddShotSheet.pickTargetType: putter →
  // putt; shot #1 on par 4/5 → fairway; otherwise → green.
  const upcomingShotNumber = hole.shots.length + 1;
  const upcomingTargetType: import('@/models').TargetType =
    selectedClub?.category === 'putter'
      ? 'putt'
      : upcomingShotNumber === 1 && (displayPar ?? hole.par) !== 3
        ? 'fairway'
        : 'green';

  // Classify a GPS landing point against the mapped course features — the same
  // point-in-polygon walk + green-relative direction logic the map-tap flow
  // uses (classifyTap). GPS-detected shots (auto-track), the manual "Record
  // Shot" button, and watch auto-commit all run through this so the sheet
  // pre-fills the correct lie (fairway/green/bunker/etc.) AND target result
  // (hit/left/right/short/long) from where the player actually is, instead of
  // defaulting to rough or guessing from the target type. Reads layoutQuery
  // .data live so a long-lived callback still sees loaded features. Returns
  // nulls when features aren't loaded yet, leaving both for the user to pick.
  const inferShotAt = useCallback(
    (
      lat: number | null,
      lng: number | null
    ): {
      lie: import('@/models').Lie | null;
      targetResult: import('@/models').TargetResult | null;
    } => {
      const data = layoutQuery.data;
      const feats = data?.features;
      if (!feats || feats.length === 0 || lat == null || lng == null) {
        return { lie: null, targetResult: null };
      }
      // Direction is measured relative to the pin: prefer the shared/local pin
      // override, falling back to the green centroid (same as the map render).
      const green: [number, number] | null = pinOverride
        ? pinOverride
        : data!.hole.green_lng != null && data!.hole.green_lat != null
          ? [data!.hole.green_lng, data!.hole.green_lat]
          : null;
      // Without a green we can still classify the lie (polygon hit-test needs
      // no bearing); the directional result just isn't meaningful, so skip it.
      if (!green) {
        return { lie: classifyTap([lng, lat], feats, 0, [lng, lat], upcomingTargetType).lie, targetResult: null };
      }
      const bearing = teeToGreenBearing(data!.hole) ?? 0;
      return classifyTap(
        [lng, lat],
        feats,
        bearing,
        green,
        upcomingTargetType,
        data!.hole.centerline
      );
    },
    [layoutQuery.data, pinOverride, upcomingTargetType]
  );

  // Last shot end (used to seed auto-track's "ball is here" anchor). When
  // there's no last shot, useAutoTrack bootstraps from the first GPS fix
  // — fine for shot 1 since the user is at the tee.
  const lastShotForAutoTrack = hole.shots[hole.shots.length - 1];
  const autoTrackInitialBallPos = useMemo<{ lat: number; lng: number } | null>(() => {
    if (lastShotForAutoTrack?.endLat != null && lastShotForAutoTrack?.endLng != null) {
      return { lat: lastShotForAutoTrack.endLat, lng: lastShotForAutoTrack.endLng };
    }
    return null;
  }, [lastShotForAutoTrack?.endLat, lastShotForAutoTrack?.endLng]);

  // Impact-primary mode: shot detection is handed to the watch when GPS + the
  // shot-detection setting are on AND the strike stream is live. When off, no
  // auto-detection happens — the phone only tracks position; shots are logged
  // manually via the Add Shot button.
  const impactPrimary = gpsEnabled && watchShotDetectionEnabled && strikeStreamLive;

  const autoTrack = useAutoTrack({
    enabled: autoTrackEnabled,
    initialBallPos: autoTrackInitialBallPos,
    // The latest confirmed strike from the watch — drives detection.
    lastImpact,
    // Strikes drive detection; emitted shots carry source:'impact'.
    impactPrimary,
    onShotDetected: (shot) => {
      // Auto-recording is WATCH-driven only. A watch strike (source:'impact')
      // closes the in-flight shot → auto-commit it UNVERIFIED (no sheet
      // interruption; reviewed at hole-complete / round summary).
      //
      // The phone deliberately does NOT auto-detect shots from its own GPS
      // movement ("walked then stopped") — it just keeps the live position.
      // Non-watch shots are logged manually via the Add Shot button, which
      // fills the yardage from the GPS last→current distance.
      autoCommitRef.current?.(shot);
    }
  });

  // Keep the auto-track ball anchor in sync with the latest persisted shot.
  // Without this, a shot saved via the normal Add Shot flow (or Made) would
  // leave the auto-tracker still anchored at the OLD ball position, and the
  // next walk would compute distance from there.
  useEffect(() => {
    if (!autoTrackEnabled) return;
    if (autoTrackInitialBallPos) autoTrack.setBallPos(autoTrackInitialBallPos);
    // setBallPos is stable (useCallback in the hook); excluding it keeps
    // this effect's identity matched to actual ball-pos changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoTrackEnabled, autoTrackInitialBallPos?.lat, autoTrackInitialBallPos?.lng]);

  // Always-on live-location watch. Runs whenever GPS is enabled — including
  // during auto-track — so the "you are here" dot is ALWAYS on the map for the
  // player to tap and mark a shot. It feeds `liveFix`, the guaranteed fallback
  // in the currentLocation priority chain below auto-track's own (accurate) fix.
  //
  // Accuracy is intentionally NOT filtered here: the default watch drops fixes
  // worse than 25m, which on a course (tree cover, cold-start lock, valleys)
  // routinely hid the dot entirely. The dot is just a "tap roughly here" marker
  // — the player taps to set the precise spot — so a coarse fix is far better
  // than no dot. Strict accuracy still applies to auto-track's shot DETECTION
  // watch; this relaxation only affects where the dot is drawn. The generous
  // 100m cap still rejects clearly-bogus fixes (e.g. web IP geolocation).
  useEffect(() => {
    if (!gpsEnabled) {
      return;
    }
    const stop = watchPosition((fix) => setLiveFix(fix), { maxAccuracyM: 100 });
    return stop;
  }, [gpsEnabled]);

  // --- First-run guided tour of the round screen ---
  const [tourOpen, setTourOpen] = useState(false);
  // Guards the auto-open so it fires at most once per mount.
  const tourAutoStartedRef = useRef(false);
  const tourSteps = useMemo<TourStep[]>(
    () => [
      {
        selector: null,
        title: 'Welcome to your round',
        body: "Here's a quick tour of how to track each hole. It takes about 20 seconds."
      },
      {
        selector: '[data-tour="map"]',
        title: 'The hole & your position',
        body: 'The map shows the hole layout. Your live GPS position is the blue dot — tap anywhere on the map to drop a marker where your shot landed.'
      },
      {
        selector: '.grt-aim-handle',
        title: 'Aim where you want',
        body: 'This is your aim target. Drag it on the map to your intended landing spot — the distance to it updates as you move it, so you can plan your shot.'
      },
      {
        selector: '[data-tour="topin"]',
        title: 'Distance to the pin',
        body: 'This updates as you play and suggests a club for the distance. Live wind shows just below it.'
      },
      {
        selector: '[data-tour="club"]',
        title: 'Pick your club',
        body: 'Tap to choose the club you’re hitting. The highlighted suggestion is based on your distance to the pin.'
      },
      {
        selector: '[data-tour="track"]',
        title: 'Track — auto-record your shots',
        body: 'Tap Track to start following your position for the round. With your Apple Watch on, each swing is then recorded automatically as you play — no tapping per shot. Tap Track again to stop. This button only appears when GPS is turned on in Settings.'
      },
      {
        selector: '[data-tour="addshot"]',
        title: 'Log a shot manually',
        body: 'No watch? Tap Add Shot once you’ve walked up to your ball — the distance from your last shot is filled in from GPS automatically.'
      },
      {
        selector: '[data-tour="measure"]',
        title: 'Show distances',
        body: 'Tap the ruler to show the 100/150/200-yard distance markers down the hole. Tap again to hide them.'
      },
      {
        selector: '[data-tour="recenter"]',
        title: 'Recenter the map',
        body: 'Panned or zoomed in? Tap this to snap the map back and re-frame the whole hole.'
      },
      {
        // Selector-less (centered): the putting panel only renders once the
        // ball is on the green, so it isn't in the DOM during the first-run
        // tour. A centered step always shows; on the green it'd be skipped by
        // the engine anyway if we anchored it.
        selector: null,
        title: 'Putting on the green',
        body: 'Once you reach the green, a putting panel appears with your live distance to the flag. Tap Missed or Made for each putt — use − / + to nudge the distance if GPS reads a touch high. The hole finishes when you tap Made.'
      },
      {
        selector: '[data-tour="nav"]',
        title: 'Move between holes',
        body: 'Use the arrows up top to switch holes. Finish a hole by recording your made putt, then move on.'
      }
    ],
    []
  );

  const closeTour = useCallback(() => {
    setTourOpen(false);
    setRoundTourCompleted(true);
  }, [setRoundTourCompleted]);

  // Auto-launch the walkthrough the first time a user reaches the round screen,
  // once the hole layout has loaded so the anchored controls exist in the DOM.
  useEffect(() => {
    if (roundTourCompleted) return;
    if (tourAutoStartedRef.current) return;
    if (!layoutQuery.data) return;
    tourAutoStartedRef.current = true;
    // Small delay so the floating controls have painted before we measure them.
    const t = setTimeout(() => setTourOpen(true), 600);
    return () => clearTimeout(t);
  }, [roundTourCompleted, layoutQuery.data]);

  // Distance from ball to pin, in yards. On shot 1 this equals the full hole
  // yardage; on later shots it's full minus what the player has already
  // covered along the centerline. Clamped to 0 so a slight over-walk doesn't
  // show negative yards. The left-side TO PIN panel uses this (not the full
  // hole yardage) so the suggested-club hint stays accurate as play progresses.
  const ballDistanceYds = ballDistanceFromTeeM / 0.9144;
  const remainingYards =
    displayYards != null ? Math.max(0, Math.round(displayYards - ballDistanceYds)) : null;

  // Putting distance: when the player is on/around the green the yards reading
  // is too coarse (a 30-yd reading covers everything from a long putt to a
  // tap-in). Switch the TO PIN panel to feet, computed from the most precise
  // source available:
  //   1. Made putt → 0 (ball is in the cup; ignore any tap location drift)
  //   2. Last shot's GPS end position → green coord (haversine, then m → ft)
  //   3. Fallback: yards-to-pin × 3 (rough, when no GPS available)
  const lastShotMadePutt =
    lastShotWasPutt && lastShot?.targetResult === 'made';
  // Hole-out signal — once the last shot is a made putt the hole is done,
  // and we lock down the tap-to-record + Add Shot affordances so the user
  // can't accidentally add a phantom shot after the ball is in the cup.
  // They can still navigate to the next/prev hole via the header arrows.
  const holeComplete = lastShotMadePutt;

  // Auto-detected shots on this hole still awaiting the golfer's confirmation.
  const unverifiedShots = useMemo(
    () => hole.shots.filter((s) => s.verified === false),
    [hole.shots]
  );
  // Putts already recorded on this hole — shown in the on-green putting panel.
  const puttsThisHole = useMemo(
    () => hole.shots.filter((s) => s.targetType === 'putt').length,
    [hole.shots]
  );
  // The on-green putting panel is the dedicated Missed / Made recorder. It
  // shows once the ball is on the green (and a putter is in the bag) and stays
  // up until the hole is made. While it's up the right-side FAB stack lifts
  // clear of it (it's full-width, anchored at the same bottom slot).
  const showPuttPanel =
    !holeComplete && lastShotOnGreen && bagClubs.some((c) => c.category === 'putter');
  // When a hole completes with unverified auto shots, prompt the review once.
  useEffect(() => {
    if (!holeComplete) return;
    if (promptedHoleRef.current === hole.holeNumber) return;
    if (hole.shots.some((s) => s.verified === false)) {
      promptedHoleRef.current = hole.holeNumber;
      setVerifyOpen(true);
    }
  }, [holeComplete, hole.holeNumber, hole.shots]);

  // "Next shot lands on the green" — the player is close enough to the pin
  // that this swing is an approach (≤ 200 yds remaining). On approach shots
  // the crosshair-target obscures the green polygon the player is trying to
  // read, so we swap it for a compact dot. Putting mode owns its own no-
  // target state; holeComplete locks the aim out entirely.
  const APPROACH_RANGE_YDS = 200;
  const nextShotOntoGreen =
    !lastShotOnGreen &&
    !holeComplete &&
    remainingYards != null &&
    remainingYards > 0 &&
    remainingYards <= APPROACH_RANGE_YDS;
  // On the green the "to pin" reading should be the distance from WHERE THE
  // USER IS to the actual pin, in feet — so it tracks them as they walk to the
  // ball. Prefer the live GPS fix → pin; fall back to the last shot's end → pin,
  // then a rough yards×3. The pin is the precise (shared/per-round) pin when set,
  // else the green centroid. (Previously this used last-shot-end → green CENTROID,
  // which read stale + offset — e.g. 21 ft when the user was ~5 ft from the pin.)
  const pinLatEff = sharedPinLat ?? localPinLat ?? greenLat;
  const pinLngEff = sharedPinLng ?? localPinLng ?? greenLng;
  const feetToPinFrom = (lat: number | null, lng: number | null): number | null =>
    lat != null && lng != null && pinLatEff != null && pinLngEff != null
      ? Math.round(
          haversineMeters(
            { lat, lng, accuracyM: 0, timestamp: 0 },
            { lat: pinLatEff, lng: pinLngEff, accuracyM: 0, timestamp: 0 }
          ) * 3.28084
        )
      : null;
  const liveFeetToPin = feetToPinFrom(liveFix?.lat ?? null, liveFix?.lng ?? null);
  // The ball rests where the last shot ended, so that → pin is the putt distance
  // (stable as the player walks around reading it). Prefer it; fall back to the
  // live fix when the last shot has no GPS, then a rough yards×3.
  const lastShotEndFeetToPin = feetToPinFrom(
    lastShot?.endLat ?? null,
    lastShot?.endLng ?? null
  );
  const remainingFeet = lastShotOnGreen
    ? lastShotMadePutt
      ? 0
      : lastShotEndFeetToPin ??
        liveFeetToPin ??
        (remainingYards != null ? remainingYards * 3 : null)
    : null;

  // Putters are filtered out of the recommendation — the panel hides the
  // suggestion entirely once the ball is on the green (lastShotOnGreen).
  // The driver exclusion mirrors the defaultClubId recommendation above so
  // the TO PIN panel and the bottom-left club button never disagree.
  const suggestedClub =
    remainingYards != null && !lastShotOnGreen
      ? recommendClub(bagClubs, remainingYards, {
          excludeDriver:
            ballDistanceFromTeeM > 0 && remainingYards > 200
        })
      : null;

  // Live wind, resolved against the direction the player is hitting. Target
  // bearing: from the current position to the pin/green when we have a fix,
  // else the static tee→green line so it still reads on un-located holes.
  const windPinLat = sharedPinLat ?? greenLat;
  const windPinLng = sharedPinLng ?? greenLng;
  const windTargetBearing =
    liveFix && windPinLat != null && windPinLng != null
      ? bearingDeg(liveFix.lat, liveFix.lng, windPinLat, windPinLng)
      : layoutQuery.data?.hole
        ? teeToGreenBearing(layoutQuery.data.hole)
        : null;
  const windPos =
    liveFix ??
    userLoc ??
    (teeLat != null && teeLng != null ? { lat: teeLat, lng: teeLng } : null);
  const { wind, relative: windRelative } = useWind(
    windPos?.lat,
    windPos?.lng,
    windTargetBearing,
    gpsEnabled
  );

  // Push derived values back into the local hole so autosave persists them.
  // Without this, the round_holes columns would stay stale because the user
  // never edits them directly anymore — everything flows from the shot list.
  useEffect(() => {
    if (
      hole.strokes !== strokes ||
      hole.putts !== putts ||
      hole.penaltyStrokes !== penaltyStrokes ||
      hole.fairwayResult !== fairwayResult ||
      hole.sand !== sand ||
      hole.gir !== gir
    ) {
      updateHole(hole.holeNumber, {
        strokes,
        putts,
        penaltyStrokes,
        fairwayResult,
        sand,
        gir
      });
    }
  }, [
    strokes,
    putts,
    penaltyStrokes,
    fairwayResult,
    sand,
    gir,
    hole.strokes,
    hole.putts,
    hole.penaltyStrokes,
    hole.fairwayResult,
    hole.sand,
    hole.gir,
    hole.holeNumber,
    updateHole
  ]);

  useAutosaveHole(hole.holeNumber);

  const onSubmitShot = async ({
    clubId,
    distance,
    distanceUnit,
    targetType,
    targetResult,
    lie,
    penaltyType,
    derivedShotResult,
    notes,
    startLat,
    startLng,
    endLat,
    endLng,
    calculatedDistance,
    verified = true
  }: {
    clubId: string | null;
    clubCategory: import('@/models').ClubCategory | null;
    distance: number | null;
    distanceUnit: import('@/models').DistanceUnit | null;
    targetType: import('@/models').TargetType;
    targetResult: import('@/models').TargetResult;
    lie: import('@/models').Lie | null;
    penaltyType: PenaltyType | null;
    derivedShotResult: import('@/models').ShotResult;
    notes: string | null;
    startLat: number | null;
    startLng: number | null;
    endLat: number | null;
    endLng: number | null;
    calculatedDistance: number | null;
    /** False for auto-detected shots (await review). Manual/sheet saves omit
     *  it → true. The EDIT path always confirms (verified true) regardless. */
    verified?: boolean;
  }) => {
    // The pendingGps prop is read by AddShotSheet on open; clear it now so a
    // subsequent manual Add Shot doesn't reuse stale GPS.
    setPendingGps(null);

    if (editingShot) {
      // EDIT path — update the existing shot in place.
      updateShotLocal(hole.holeNumber, editingShot.tempId, {
        clubId,
        shotResult: derivedShotResult,
        targetType,
        targetResult,
        lie,
        penaltyType,
        distance,
        distanceUnit,
        notes,
        startLat,
        startLng,
        endLat,
        endLng,
        calculatedDistance,
        // Editing a shot in the sheet IS a verification — the golfer has
        // eyes on it and saved, so clear any pending-review flag.
        verified: true
      });
      setShotSheet(false);
      setEditingShot(null);
      syncHole(hole.holeNumber);

      if (editingShot.remoteId) {
        try {
          await roundRepo.updateShot(editingShot.remoteId, {
            club_id: clubId,
            shot_result: derivedShotResult,
            target_type: targetType,
            target_result: targetResult,
            lie,
            penalty_type: penaltyType,
            distance,
            distance_unit: distanceUnit,
            notes,
            start_lat: startLat,
            start_lng: startLng,
            end_lat: endLat,
            end_lng: endLng,
            calculated_distance: calculatedDistance,
            verified: true
          });
        } catch (err) {
          console.error('[shot] edit save failed', err);
        }
      }
      return;
    }

    // Impact-primary: a MANUAL add (e.g. a putt on the green) means the player
    // has reached the ball — so close any pending auto shot FIRST (the approach
    // that landed where they're now standing) and commit it. autoCommit's local
    // store write is synchronous (pre-await), so the manual shot below reads the
    // updated count and the two land in the right order. Guarded to manual
    // saves (verified) so the auto path itself doesn't recurse.
    if (verified && impactPrimary && autoTrack.hasPendingShot()) {
      const pending = autoTrack.resolvePendingShot();
      if (pending) autoCommitRef.current?.(pending);
    }

    // ADD path. Read the shot count FRESH from the store (not the closed-over
    // `hole`) so two saves in the same tick — e.g. an auto-resolve of the
    // pending shot immediately followed by a manual save — get sequential
    // numbers instead of colliding on the same one.
    const freshHole = useRoundStore
      .getState()
      .active?.holes.find((h) => h.holeNumber === hole.holeNumber);
    const nextNum = (freshHole?.shots.length ?? hole.shots.length ?? 0) + 1;
    const tempId = `tmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    addShotLocal(hole.holeNumber, {
      tempId,
      shotNumber: nextNum,
      clubId,
      shotResult: derivedShotResult,
      targetType,
      targetResult,
      lie,
      penaltyType,
      distance,
      distanceUnit,
      notes,
      createdAt: new Date().toISOString(),
      verified,
      startLat,
      startLng,
      endLat,
      endLng,
      calculatedDistance
    });
    setShotSheet(false);
    // Live-push this hole to TM (tournament rounds only; debounced + no-op otherwise).
    syncHole(hole.holeNumber);

    try {
      // Ensure the hole row exists so we have a holeId to point the shot at.
      if (!hole.holeId) {
        const saved = await roundRepo.upsertHole({
          round_id: active.roundId,
          hole_number: hole.holeNumber,
          par: hole.par,
          yardage: hole.yardage,
          strokes: nextNum,
          putts,
          penalty_strokes: hole.penaltyStrokes,
          fairway_result: hole.fairwayResult,
          sand: hole.sand,
          gir: hole.gir,
          clubs_used: hole.clubsUsed
        });
        useRoundStore.getState().applyHoleIds([saved]);
      }
      const holeId = useRoundStore
        .getState()
        .active?.holes.find((h) => h.holeNumber === hole.holeNumber)?.holeId;
      if (!holeId) return;

      const persisted = await roundRepo.addShot({
        round_id: active.roundId,
        hole_id: holeId,
        shot_number: nextNum,
        club_id: clubId,
        shot_result: derivedShotResult,
        target_type: targetType,
        target_result: targetResult,
        lie,
        penalty_type: penaltyType,
        distance,
        distance_unit: distanceUnit,
        notes,
        start_lat: startLat,
        start_lng: startLng,
        end_lat: endLat,
        end_lng: endLng,
        calculated_distance: calculatedDistance,
        verified
      });
      markShotSynced(hole.holeNumber, tempId, persisted.id);

      // Auto-record typical yardage the first time a non-putter club is
      // used. The recommender depends on `typicalDistanceYards` to suggest
      // sensible clubs off the tee / fairway, so every new club acquired
      // mid-round backfills its baseline distance from the first shot.
      // Subsequent shots leave the existing value alone — the user can
      // refine it in My Bag → club edit if needed.
      if (
        clubId != null &&
        distance != null &&
        distance > 0 &&
        distanceUnit === 'yards'
      ) {
        const club = bagClubs.find((c) => c.clubId === clubId);
        // Skip putters (typical putt distance has no useful meaning) and
        // clubs that already have a recorded yardage.
        if (
          club &&
          club.category !== 'putter' &&
          club.typicalDistanceYards == null
        ) {
          try {
            await bagRepo.updateBagClub(club.bagId, {
              typical_distance_yards: distance
            });
            // Optimistically reflect the new yardage in the bag store so the
            // next recommendation cycle sees it without waiting on a refetch.
            setBagClubs(
              bagClubs.map((c) =>
                c.bagId === club.bagId
                  ? { ...c, typicalDistanceYards: distance }
                  : c
              )
            );
          } catch (err) {
            console.warn('[shot] typical yardage backfill failed', err);
          }
        }
      }
    } catch (err) {
      console.error('[shot] save failed', err);
    }
  };

  // Phase 2 auto-commit: turn a strike-detected shot into an UNVERIFIED row,
  // reusing the same save pipeline as the manual sheet. Club/result/lie are
  // best-effort defaults (selected club, optimistic "hit") — the golfer
  // reviews and edits before verifying at hole-complete / round summary.
  const autoCommitShot = (shot: ShotDetected) => {
    const club = bagClubs.find((c) => c.clubId === selectedClubId) ?? null;
    const tType = upcomingTargetType;
    // Classify lie + target result from the actual landing point against the
    // mapped features first; only fall back to the target-type lie guess /
    // optimistic 'hit' result when features aren't loaded or the point matched
    // no polygon. The golfer still reviews this before verifying.
    const inferred = inferShotAt(shot.endLat, shot.endLng);
    const tResult: import('@/models').TargetResult = inferred.targetResult ?? 'hit';
    const lie: import('@/models').Lie | null =
      inferred.lie ??
      (tType === 'green' ? 'green' : tType === 'fairway' ? 'fairway' : null);
    const derived: import('@/models').ShotResult =
      tType === 'fairway' ? 'fairway' : 'green';
    void onSubmitShot({
      clubId: selectedClubId,
      clubCategory: club?.category ?? null,
      distance: Math.round(shot.distanceM * 1.0936133),
      distanceUnit: 'yards',
      targetType: tType,
      targetResult: tResult,
      lie,
      penaltyType: null,
      derivedShotResult: derived,
      notes: null,
      startLat: shot.startLat,
      startLng: shot.startLng,
      endLat: shot.endLat,
      endLng: shot.endLng,
      calculatedDistance: shot.distanceM,
      verified: false
    });
  };
  // Keep the ref the useAutoTrack callback reads pointed at the latest closure.
  useEffect(() => {
    autoCommitRef.current = autoCommitShot;
  });

  // Monotonic id for the watch's post-save overview so each summary shows once.
  const watchShotSummaryIdRef = useRef(0);
  // Record a shot the WATCH logged at the user's current GPS (Track-off "I'm at
  // my ball", or the Add Shot button). Mirrors autoCommitShot but uses the
  // watch's club + end position; the START is the hole's prior ball position
  // (last shot end / tee) so distance + inferred lie/result match the phone's
  // own GPS-aware add. Auto-saves UNVERIFIED (golfer reviews at hole-complete)
  // and pushes a brief club·result·distance summary back for the watch overview.
  const recordWatchAutoShot = (msg: {
    clubId: string | null;
    startLat?: number | null;
    startLng?: number | null;
    endLat?: number | null;
    endLng?: number | null;
  }) => {
    const endLat = msg.endLat ?? null;
    const endLng = msg.endLng ?? null;
    if (endLat == null || endLng == null) return;
    const ballStart =
      msg.startLat != null && msg.startLng != null
        ? { lat: msg.startLat, lng: msg.startLng }
        : autoTrackInitialBallPos ??
          (teeLat != null && teeLng != null ? { lat: teeLat, lng: teeLng } : null);

    const club = bagClubs.find((c) => c.clubId === msg.clubId) ?? null;
    const tType = upcomingTargetType;
    const inferred = inferShotAt(endLat, endLng);
    const tResult: import('@/models').TargetResult = inferred.targetResult ?? 'hit';
    const lie: import('@/models').Lie | null =
      inferred.lie ??
      (tType === 'green' ? 'green' : tType === 'fairway' ? 'fairway' : null);
    const derived: import('@/models').ShotResult =
      tType === 'fairway' ? 'fairway' : 'green';

    const calculatedDistanceM = ballStart
      ? haversineMeters(
          { lat: ballStart.lat, lng: ballStart.lng, accuracyM: 0, timestamp: 0 },
          { lat: endLat, lng: endLng, accuracyM: 0, timestamp: 0 }
        )
      : null;
    const distanceYds =
      calculatedDistanceM != null ? Math.round(calculatedDistanceM * 1.0936133) : null;

    void onSubmitShot({
      clubId: msg.clubId,
      clubCategory: club?.category ?? null,
      distance: distanceYds,
      distanceUnit: distanceYds != null ? 'yards' : null,
      targetType: tType,
      targetResult: tResult,
      lie,
      penaltyType: null,
      derivedShotResult: derived,
      notes: null,
      startLat: ballStart?.lat ?? null,
      startLng: ballStart?.lng ?? null,
      endLat,
      endLng,
      calculatedDistance: calculatedDistanceM,
      verified: false
    });

    watchShotSummaryIdRef.current += 1;
    setWatchLastShotSummary({
      id: watchShotSummaryIdRef.current,
      clubName: club ? club.customName || club.name : 'Shot',
      result: watchResultLabel(tType, tResult),
      distanceText: distanceYds != null ? `${distanceYds} yds` : '—'
    });
  };

  // Close + commit any in-flight auto shot (e.g. on hole exit). End position
  // defaults to the latest GPS fix inside resolvePendingShot.
  const flushPendingAutoShot = () => {
    if (!impactPrimary || !autoTrack.hasPendingShot()) return;
    const pending = autoTrack.resolvePendingShot();
    if (pending) autoCommitShot(pending);
  };

  // Drop a stale in-flight shot if impact-primary turns off (setting toggled,
  // watch dropped) so it can't surface later against the wrong hole.
  useEffect(() => {
    if (!impactPrimary) autoTrack.clearPendingShot();
  }, [impactPrimary, autoTrack]);

  // Record a putt from the on-green putting panel. The distance (feet to the
  // flag) is the panel's shown reading — GPS → pin, optionally ± corrected —
  // and `made` holes out. Start = where the player is standing now (the ball);
  // every putt is drawn toward the cup, so end = the pin. onSubmitShot itself
  // closes any pending auto approach shot first (verified save), keeping order.
  // (The watch records its own putts via the recordShot inbound handler.)
  const recordPutt = (made: boolean, distanceFeet: number | null) => {
    const putter = bagClubs.find((c) => c.category === 'putter');
    if (!putter) return;
    const startLat = liveFix?.lat ?? lastShot?.endLat ?? null;
    const startLng = liveFix?.lng ?? lastShot?.endLng ?? null;
    void onSubmitShot({
      clubId: putter.clubId,
      clubCategory: 'putter',
      distance: distanceFeet,
      distanceUnit: distanceFeet != null ? 'feet' : null,
      targetType: 'putt',
      targetResult: made ? 'made' : 'missed',
      lie: 'green',
      penaltyType: null,
      derivedShotResult: made ? 'made_putt' : 'putt',
      notes: null,
      startLat,
      startLng,
      endLat: pinLatEff,
      endLng: pinLngEff,
      calculatedDistance: distanceFeet != null ? distanceFeet * 0.3048 : null
    });
  };

  const onDeleteShot = async (shot: LocalShot) => {
    removeShotLocal(hole.holeNumber, shot.tempId);
    syncHole(hole.holeNumber);
    if (shot.remoteId) {
      try {
        await roundRepo.deleteShot(shot.remoteId);
      } catch (err) {
        console.error('[shot] delete failed', err);
      }
    }
  };

  // Confirm an auto-detected shot — clears its pending-review flag locally and
  // in Supabase. Used by the per-hole verification dialog.
  const verifyShot = async (shot: LocalShot) => {
    updateShotLocal(hole.holeNumber, shot.tempId, { verified: true });
    if (shot.remoteId) {
      try {
        await roundRepo.updateShot(shot.remoteId, { verified: true });
      } catch (err) {
        console.error('[verify] mark verified failed', err);
      }
    }
  };
  const verifyAllOnHole = async () => {
    for (const s of hole.shots) {
      if (s.verified === false) await verifyShot(s);
    }
  };

  const goPrev = () => {
    flushPendingAutoShot();
    setCurrentHole(Math.max(0, idx - 1));
  };
  const goNext = () => {
    flushPendingAutoShot();
    setCurrentHole(Math.min(active.holes.length - 1, idx + 1));
  };

  // Watch → phone message handler. Refs keep the listener pinned to the
  // latest handler functions without re-subscribing on every render (a
  // resubscribe storm would silently double-fire the next watch message).
  const goPrevRef = useRef(goPrev);
  const goNextRef = useRef(goNext);
  const onSubmitShotRef = useRef(onSubmitShot);
  const bagClubsRef = useRef(bagClubs);
  const applyAutoTrackRef = useRef(applyAutoTrack);
  const recordWatchAutoShotRef = useRef(recordWatchAutoShot);
  useEffect(() => {
    goPrevRef.current = goPrev;
    goNextRef.current = goNext;
    onSubmitShotRef.current = onSubmitShot;
    bagClubsRef.current = bagClubs;
    applyAutoTrackRef.current = applyAutoTrack;
    recordWatchAutoShotRef.current = recordWatchAutoShot;
  });
  useEffect(() => {
    let handle: { remove: () => Promise<void> } | null = null;
    (async () => {
      handle = await watchBridge.onMessage((msg: WatchInboundMessage) => {
        if (msg.type === 'navigateHole') {
          if (msg.direction === 'prev') goPrevRef.current();
          else if (msg.direction === 'next') goNextRef.current();
          return;
        }
        if (msg.type === 'setAutoTrack') {
          // Watch toggled round-wide auto-tracking. Run the same gated
          // enable/disable as the phone FAB; the resulting state echoes back
          // to the watch via the snapshot's `autoTracking`.
          void applyAutoTrackRef.current(msg.active);
          return;
        }
        if (msg.type === 'autoShot') {
          // Watch logged a shot at the user's current GPS (Track-off at the
          // ball, or Add Shot). Infer fairway/left/right from the landing
          // point, auto-save, and push a summary back for the watch overview.
          recordWatchAutoShotRef.current({
            clubId: msg.clubId,
            startLat: msg.startLat,
            startLng: msg.startLng,
            endLat: msg.endLat,
            endLng: msg.endLng
          });
          return;
        }
        if (msg.type === 'trackingShot') {
          // Mirror the watch's tracking state on the phone. When
          // active=true and currentLat/Lng are present (periodic
          // updates while the user walks), update the live-position
          // fields so the phone map can render a "you are here" dot
          // for the watch user — same affordance as phone-side Track.
          setWatchTracking((prev) => {
            if (!msg.active) {
              return {
                active: false,
                startLat: null,
                startLng: null,
                currentLat: null,
                currentLng: null
              };
            }
            return {
              active: true,
              startLat: msg.startLat ?? prev.startLat,
              startLng: msg.startLng ?? prev.startLng,
              currentLat: msg.currentLat ?? prev.currentLat,
              currentLng: msg.currentLng ?? prev.currentLng
            };
          });
          return;
        }
        if (msg.type === 'roundImpact') {
          // A confirmed ball-strike from the watch. Drives both the Phase 1
          // gate (lastImpact) and Phase 2 impact-primary activation
          // (strikeStreamLive). New object identity each message so the hook
          // treats it as a fresh strike.
          setLastImpact({ impactId: msg.impactId, capturedAt: msg.capturedAt });
          // Mark the stream live and (re)arm a staleness timeout — if strikes
          // stop arriving (watch off / out of range), impact-primary relaxes
          // back to Phase 1 GPS tracking after the window.
          setStrikeStreamLive(true);
          if (strikeStaleTimerRef.current) clearTimeout(strikeStaleTimerRef.current);
          strikeStaleTimerRef.current = setTimeout(
            () => setStrikeStreamLive(false),
            12 * 60 * 1000
          );
          return;
        }
        if (msg.type === 'selectClub') {
          // Watch user changed clubs from the home-view picker (not as
          // part of recording a shot). Update the phone's selected
          // club so suggested-club logic + the next shot's default
          // reflect the pick. The snapshot re-sends the change back to
          // the watch via the regular useWatchSync flow.
          setSelectedClubId(msg.clubId);
          // Sync the tier-1 dropdown so the manual club picker on the
          // phone reflects the new selection too.
          const club = bagClubsRef.current.find((c) => c.clubId === msg.clubId);
          if (club) setSelectedClubTier1(tier1ForCategory(club.category));
          return;
        }
        if (msg.type === 'recordShot') {
          // The watch finished a shot — if a tracking session was open,
          // it's done now. Clear the indicator before processing the
          // shot save below.
          setWatchTracking({
            active: false,
            startLat: null,
            startLng: null,
            currentLat: null,
            currentLng: null
          });
          // Lie auto-fill mirrors AddShotSheet's logic. GPS pair flows
          // through so the next aim line + lastShotEndDistFromGreen reads
          // the actual landing position.
          const club = bagClubsRef.current.find((c) => c.clubId === msg.clubId) ?? null;
          let lie: import('@/models').Lie | null = null;
          if (msg.targetType === 'green' && msg.targetResult === 'hit') lie = 'green';
          else if (msg.targetType === 'fairway' && msg.targetResult === 'hit') lie = 'fairway';
          else if (msg.targetType === 'putt' && msg.targetResult === 'made') lie = 'green';

          // Mirror deriveShotResult from AddShotSheet without importing it
          // (avoid circular deps).
          let shotResult: import('@/models').ShotResult;
          if (msg.targetType === 'putt') {
            shotResult = msg.targetResult === 'made' ? 'made_putt' : 'putt';
          } else if (msg.targetType === 'green') {
            shotResult =
              msg.targetResult === 'hit'
                ? 'green'
                : (msg.targetResult as import('@/models').ShotResult);
          } else {
            shotResult =
              msg.targetResult === 'hit'
                ? 'fairway'
                : (msg.targetResult as import('@/models').ShotResult);
          }

          // Compute the shot distance from the watch's GPS pair so the
          // Hole Overview shows real yardage (or feet, for putts) instead
          // of "—". The watch already sends start_lat/lng + end_lat/lng
          // when it captures a shot via the club picker; do the haversine
          // here so the saved row mirrors what the phone-tap flow stores.
          let watchDistance: number | null = null;
          let watchDistanceUnit: import('@/models').DistanceUnit | null = null;
          let watchCalculatedDistanceM: number | null = null;
          if (msg.targetType === 'putt' && msg.distanceFeet != null) {
            // Putts from the watch's on-green panel carry the player-seen (and
            // possibly ± nudged) feet-to-flag directly — GPS can't measure a
            // putt, so this is the source of truth. Mirror the phone panel,
            // which stores feet + the meter equivalent.
            watchDistance = msg.distanceFeet;
            watchDistanceUnit = 'feet';
            watchCalculatedDistanceM = msg.distanceFeet * 0.3048;
          } else if (
            msg.startLat != null &&
            msg.startLng != null &&
            msg.endLat != null &&
            msg.endLng != null
          ) {
            watchCalculatedDistanceM = haversineMeters(
              { lat: msg.startLat, lng: msg.startLng, accuracyM: 0, timestamp: 0 },
              { lat: msg.endLat, lng: msg.endLng, accuracyM: 0, timestamp: 0 }
            );
            if (msg.targetType === 'putt') {
              // Putts in feet — matches the rest of the app's convention.
              watchDistance = Math.round(watchCalculatedDistanceM * 3.28084);
              watchDistanceUnit = 'feet';
            } else {
              watchDistance = Math.round(watchCalculatedDistanceM * 1.0936133);
              watchDistanceUnit = 'yards';
            }
          }

          onSubmitShotRef
            .current({
              clubId: msg.clubId,
              clubCategory: club?.category ?? null,
              distance: watchDistance,
              distanceUnit: watchDistanceUnit,
              targetType: msg.targetType,
              targetResult: msg.targetResult,
              lie,
              penaltyType: null,
              derivedShotResult: shotResult,
              notes: null,
              startLat: msg.startLat ?? null,
              startLng: msg.startLng ?? null,
              endLat: msg.endLat ?? null,
              endLng: msg.endLng ?? null,
              calculatedDistance: watchCalculatedDistanceM
            })
            .catch((err) => {
              console.error('[watch] recordShot from watch failed', err);
            });
        }
      });
    })();
    return () => {
      handle?.remove().catch(() => undefined);
      if (strikeStaleTimerRef.current) clearTimeout(strikeStaleTimerRef.current);
    };
  }, []);

  const finishRound = async () => {
    const score = computeTotalScore(active.holes);
    try {
      await roundRepo.update(active.roundId, {
        score,
        score_vs_par: score - active.totalPar,
        completed_at: new Date().toISOString()
      });
    } catch (err) {
      console.error('[round] finish failed', err);
    }
    // Tournament rounds: final push of every played hole with SUBMITTED so TM
    // locks the scorecard. Best-effort; never blocks navigation to the summary.
    try {
      await finalizeRound();
    } catch (err) {
      console.error('[round] TM finalize failed', err);
    }
    navigate(`/round/summary/${active.roundId}`, { replace: true });
  };

  // Peek-at-stats: opens the summary page in read-only mode WITHOUT marking
  // the round complete. Plain navigate (no replace) so the back button
  // returns the user to their current hole.
  const viewStats = () => {
    navigate(`/round/summary/${active.roundId}`);
  };

  // Lock the document scroll while the hole tracking page is mounted. The
  // page itself is height: 100dvh + overflow: hidden, but on iOS PWAs the
  // body still rubber-bands without position:fixed — even with
  // overscroll-behavior: none. Anchor body via top/right/bottom/left: 0 so
  // it reliably extends through the safe areas (height: 100% alone doesn't
  // include them on iOS). Snapshot + restore on unmount so other roots
  // (Settings, Bag, etc.) keep their scroll.
  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const prev = {
      htmlOverflow: html.style.overflow,
      bodyPosition: body.style.position,
      bodyOverflow: body.style.overflow,
      bodyTop: body.style.top,
      bodyRight: body.style.right,
      bodyBottom: body.style.bottom,
      bodyLeft: body.style.left,
      bodyWidth: body.style.width,
      bodyHeight: body.style.height,
      bodyTouchAction: body.style.touchAction
    };
    html.style.overflow = 'hidden';
    body.style.position = 'fixed';
    body.style.overflow = 'hidden';
    body.style.top = '0';
    body.style.right = '0';
    body.style.bottom = '0';
    body.style.left = '0';
    body.style.width = '';
    body.style.height = '';
    body.style.touchAction = 'none';
    return () => {
      html.style.overflow = prev.htmlOverflow;
      body.style.position = prev.bodyPosition;
      body.style.overflow = prev.bodyOverflow;
      body.style.top = prev.bodyTop;
      body.style.right = prev.bodyRight;
      body.style.bottom = prev.bodyBottom;
      body.style.left = prev.bodyLeft;
      body.style.width = prev.bodyWidth;
      body.style.height = prev.bodyHeight;
      body.style.touchAction = prev.bodyTouchAction;
    };
  }, []);

  // Auto-finish the round when a putt is holed on the final hole. Guarded by
  // a ref so it only fires once per page lifetime — if the user returns to
  // edit a shot after the round closed, we don't re-stamp completed_at.
  const autoFinishedRef = useRef(false);
  const isLastHole = idx === active.holes.length - 1;
  useEffect(() => {
    if (autoFinishedRef.current) return;
    if (!holeComplete || !isLastHole) return;
    autoFinishedRef.current = true;
    void finishRound();
    // finishRound is stable in this component (recreated each render but with
    // the same closure shape); excluding it avoids needing useCallback and
    // doesn't introduce a stale-closure bug — score/holes are read fresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [holeComplete, isLastHole]);

  return (
    <Box
      sx={{
        height: '100dvh',
        bgcolor: 'background.default',
        overflow: 'hidden',
        position: 'relative'
      }}
    >
      <Box
        sx={{
          position: 'sticky',
          top: 0,
          zIndex: 5,
          bgcolor: 'background.default',
          pt: 'env(safe-area-inset-top)',
          borderBottom: 1,
          borderColor: 'divider'
        }}
      >
        <Stack direction="row" alignItems="center" px={1} py={1} spacing={0.25}>
          <IconButton aria-label="exit" onClick={() => navigate('/round')}>
            <CloseRoundedIcon />
          </IconButton>
          <IconButton aria-label="prev hole" onClick={goPrev} disabled={idx === 0}>
            <ArrowBackIosNewRoundedIcon />
          </IconButton>
          <Box
            onClick={() => setDetailsOpen(true)}
            sx={{
              flex: 1,
              textAlign: 'center',
              minWidth: 0,
              cursor: 'pointer',
              userSelect: 'none'
            }}
          >
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{
                textTransform: 'uppercase',
                letterSpacing: 0.6,
                display: 'block',
                lineHeight: 1
              }}
              noWrap
            >
              {active.courseName}
              {atCourseStatus && (
                <Box
                  component="span"
                  sx={{
                    ml: 0.75,
                    px: 0.6,
                    py: 0.05,
                    borderRadius: 0.75,
                    fontSize: '0.62rem',
                    fontWeight: 700,
                    bgcolor: atCourseStatus.atCourse
                      ? 'rgba(46,125,50,0.25)'
                      : 'rgba(237,108,2,0.22)',
                    color: atCourseStatus.atCourse ? 'success.light' : 'warning.light',
                    border: 1,
                    borderColor: atCourseStatus.atCourse
                      ? 'rgba(46,125,50,0.6)'
                      : 'rgba(237,108,2,0.55)'
                  }}
                >
                  {atCourseStatus.atCourse
                    ? '● AT COURSE'
                    : `● ${(atCourseStatus.distM / 1609.344).toFixed(1)} MI AWAY`}
                </Box>
              )}
            </Typography>
            <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }} noWrap>
              {`Hole ${hole.holeNumber} · Par ${displayPar ?? '—'} · ${
                displayYards ?? '—'
              } yds`}
            </Typography>
          </Box>
          <IconButton
            data-tour="nav"
            aria-label="next hole"
            onClick={goNext}
            disabled={idx === active.holes.length - 1}
          >
            <ArrowForwardIosRoundedIcon />
          </IconButton>
          <IconButton
            aria-label="how to use this screen"
            onClick={() => setTourOpen(true)}
          >
            <HelpOutlineRoundedIcon />
          </IconButton>
          <IconButton aria-label="view round stats" color="primary" onClick={viewStats}>
            <FlagCircleRoundedIcon />
          </IconButton>
        </Stack>
      </Box>

      {/* Full-screen map with floating overlays. Header lives in the sticky
          top bar (hole / par / yardage / nav); the bottom nav has been folded
          into the map via View Shots + Add Shot floating buttons. */}
      <Box
        data-tour="map"
        sx={{
          position: 'relative',
          height: 'calc(100dvh - 64px - env(safe-area-inset-top))',
          minHeight: 480
        }}
      >
        <HoleLayoutCard
          courseId={active.courseId}
          holeNumber={hole.holeNumber}
          par={hole.par}
          yardage={displayYards}
          compact
          interactive
          recenterRef={recenterMapRef}
          aimMode
          ballDistanceFromTeeM={ballDistanceFromTeeM}
          suggestedHandleDistanceM={suggestedHandleDistanceM}
          puttingMode={lastShotOnGreen && !holeComplete}
          bagClubs={bagClubs}
          landingPoint={
            pendingGps ? [pendingGps.endLng, pendingGps.endLat] : null
          }
          shotEndPoints={shotEndPoints}
          shotLabels={shotLabels}
          // Shot replay — bumped by the post-hole Recap button below.
          recapToken={recapToken}
          // Hide the aim UI while reviewing a tap (pendingGps), after the
          // hole is complete, OR while moving the pin — in all three states
          // the handle / line / distance pill would either be misleading or
          // compete with the active task.
          hideAim={!!pendingGps || holeComplete || pinEditMode}
          useTargetDot={nextShotOntoGreen}
          targetType={upcomingTargetType}
          showYardageMarkers={showYardageMarkers}
          pinOverride={pinOverride}
          maxAimDistanceFromBallM={maxAimDistanceFromBallM}
          // Live "you are here" dot, shown at all times while GPS is on.
          // Live "you are here" dot — always the FRESHEST phone fix so it never
          // freezes. Auto-track's fix is accuracy-filtered (25m) and can stall
          // under tree cover; `liveFix` (relaxed 100m) keeps flowing. Pick
          // whichever has the newer timestamp instead of always preferring
          // auto-track, then fall back to the WATCH-reported position.
          currentLocation={(() => {
            const a = autoTrackEnabled ? autoTrack.latestFix : null;
            const b = liveFix;
            const phone = a && b ? (a.timestamp >= b.timestamp ? a : b) : (a ?? b);
            if (phone) return [phone.lng, phone.lat] as [number, number];
            if (
              watchTracking.active &&
              watchTracking.currentLat != null &&
              watchTracking.currentLng != null
            ) {
              return [watchTracking.currentLng, watchTracking.currentLat] as [number, number];
            }
            return null;
          })()}
          // Reset the cached aim drag whenever the player edits par or
          // yardage. The handle re-anchors at the new defaults so the
          // aim distance reflects the corrected hole length instead of
          // staying stuck at the old drag position.
          aimResetKey={`${hole.par ?? '-'}-${hole.yardage ?? '-'}`}
          // Scale on-map yardage displays (aim label) so they match the
          // player's overridden hole length. Falls back to 1.0 (no
          // scaling) when no override is active or OSM data is missing.
          yardageScale={
            hole.yardage != null && osmYards != null && osmYards > 0
              ? hole.yardage / osmYards
              : 1
          }
          onShotLanded={
            holeComplete
              ? undefined
              : (data) => {
                  // Pin-edit mode reuses the same tap stream — set the new
                  // pin position and exit the mode. Everything that uses the
                  // pin (flag marker, aim line endpoint, putting bounds,
                  // distance-to-pin) picks up the override on next render.
                  if (pinEditMode) {
                    // Persist to the shared course-wide pin so every other
                    // player on this course inherits the new position. Bail
                    // gracefully if the layout isn't loaded — there's no hole
                    // row to update yet.
                    const holeId = layoutQuery.data?.hole.id;
                    if (holeId) {
                      void (async () => {
                        try {
                          await holesRepo.setPin(holeId, data.end[0], data.end[1]);
                          queryClient.invalidateQueries({
                            queryKey: ['hole-layout', active?.courseId, hole.holeNumber]
                          });
                        } catch {
                          // Swallow — the user can retry by moving the pin again.
                        }
                      })();
                    }
                    setPinEditMode(false);
                    return;
                  }
                  // Normal flow — stash the landing point; user commits via
                  // "Record Shot".
                  setPendingGps({
                    startLat: data.start[1],
                    startLng: data.start[0],
                    endLat: data.end[1],
                    endLng: data.end[0],
                    calculatedDistanceM: data.calculatedDistanceM,
                    inferredLie: data.inferredLie,
                    inferredTargetResult: data.inferredTargetResult
                  });
                }
          }
        />

        {/* Remaining yardage — fixed left panel. Replaces the on-map bubble so
            it stays legible regardless of zoom / rotation. Underneath: the
            suggested club for that distance (skipped on the green and when no
            club in the bag has a recorded typical distance). Hidden entirely
            when no yardage is known (e.g. unsynced course). */}
        {/* Left column — To Pin yardage with the live wind readout beneath it. */}
        <Stack
          spacing={1}
          alignItems="center"
          sx={{
            position: 'absolute',
            top: 12,
            left: 12,
            zIndex: 3,
            pointerEvents: 'none'
          }}
        >
          {(remainingYards != null || remainingFeet != null) && (
            <Box
              data-tour="topin"
              sx={{
                bgcolor: 'rgba(11,20,16,0.88)',
                color: 'common.white',
                border: 1.5,
                borderColor: '#fbbf24',
                borderRadius: '5px',
                px: 1.25,
                py: 0.5,
                boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
                lineHeight: 1.1,
                textAlign: 'center',
                minWidth: 90
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  fontSize: '0.6rem',
                  fontWeight: 700,
                  letterSpacing: 0.6,
                  color: '#fbbf24',
                  textTransform: 'uppercase'
                }}
              >
                To Pin
              </Typography>
              <Typography
                sx={{
                  fontSize: '1.1rem',
                  fontWeight: 800
                }}
              >
                {lastShotOnGreen && remainingFeet != null
                  ? `${remainingFeet} ft`
                  : `${remainingYards} yds`}
              </Typography>
              {suggestedClub && (
                <Typography
                  sx={{
                    fontSize: '0.75rem',
                    fontWeight: 700,
                    color: '#fbbf24',
                    mt: 0.25
                  }}
                >
                  {suggestedClub.customName || suggestedClub.name}
                </Typography>
              )}
            </Box>
          )}
          {windPos && <WindIndicator wind={wind} relative={windRelative} tone="dark" circle />}
        </Stack>

        {/* Stat pills — top-right column. Score is the headline value (accent). */}
        <Stack
          spacing={1}
          sx={{
            position: 'absolute',
            top: 12,
            right: 12,
            zIndex: 3,
            pointerEvents: 'none'
          }}
        >
          <StatPill label="Score" value={totalRoundDiff} accent />
          <StatPill label="Shots" value={strokes} />
          <StatPill label="Putts" value={putts} />
          <StatPill label="Penalty" value={penaltyStrokes} />
        </Stack>

        {/* Move Pin — small icon button on the top-center. Visible only once
            the player is on the green (avoids accidental taps while still
            playing the hole, and matches when the precise pin actually
            matters). Tap to enter pin-edit mode; the next tap on the map
            saves the new pin position to the shared course library so every
            other player inherits it. While active, shows a banner + Reset
            to clear the override and revert to the course coord. */}
        {!holeComplete && lastShotOnGreen && (
          <IconButton
            aria-label={pinEditMode ? 'cancel pin move' : 'move pin position'}
            onClick={() => setPinEditMode((v) => !v)}
            size="small"
            sx={{
              position: 'absolute',
              top: 12,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 3,
              bgcolor: pinEditMode ? '#fbbf24' : 'rgba(11,20,16,0.85)',
              color: pinEditMode ? '#0b1410' : 'common.white',
              border: 1.5,
              borderColor: '#fbbf24',
              boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
              '&:hover': {
                bgcolor: pinEditMode ? '#f59e0b' : 'rgba(11,20,16,0.95)'
              }
            }}
          >
            <EditLocationAltRoundedIcon fontSize="small" />
          </IconButton>
        )}

        {pinEditMode && (
          <Box
            sx={{
              position: 'absolute',
              top: 56,
              left: '50%',
              transform: 'translateX(-50%)',
              zIndex: 4,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              bgcolor: 'rgba(11,20,16,0.92)',
              color: 'common.white',
              border: 1.5,
              borderColor: '#fbbf24',
              borderRadius: 999,
              px: 1.5,
              py: 0.5,
              boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
              fontSize: '0.8rem',
              fontWeight: 700,
              whiteSpace: 'nowrap'
            }}
          >
            Tap green to set pin
            {(layoutQuery.data?.hole.pin_lat != null ||
              layoutQuery.data?.hole.pin_lng != null ||
              hole.pinLat != null ||
              hole.pinLng != null) && (
              <Button
                size="small"
                onClick={() => {
                  const holeId = layoutQuery.data?.hole.id;
                  if (holeId) {
                    void (async () => {
                      try {
                        await holesRepo.setPin(holeId, null, null);
                        queryClient.invalidateQueries({
                          queryKey: ['hole-layout', active?.courseId, hole.holeNumber]
                        });
                      } catch {
                        // ignore; user can retry
                      }
                    })();
                  }
                  // Also clear any legacy per-round override.
                  if (hole.pinLat != null || hole.pinLng != null) {
                    updateHole(hole.holeNumber, { pinLat: null, pinLng: null });
                  }
                  setPinEditMode(false);
                }}
                sx={{
                  color: '#fbbf24',
                  textTransform: 'none',
                  ml: 1,
                  minWidth: 0,
                  px: 0.5
                }}
              >
                Reset
              </Button>
            )}
          </Box>
        )}

        {/* Club picker — bottom-left primary action. Compact circular
            tag with the abbreviated club name ("7I", "PW", "56W", etc.)
            so it doesn't compete with the map for screen space. Tap to
            slide up the drawer with the full ClubPicker tier-1 / tier-2
            UI. Empty placeholder is "+" when nothing's selected. */}
        <Button
          data-tour="club"
          onClick={() => setClubPickerOpen(true)}
          sx={{
            position: 'absolute',
            bottom: 'calc(16px + env(safe-area-inset-bottom))',
            left: 16,
            zIndex: 4,
            width: 56,
            height: 56,
            minWidth: 56,
            borderRadius: '50%',
            p: 0,
            bgcolor: 'rgba(11,20,16,0.85)',
            color: 'common.white',
            border: 1.5,
            borderColor: selectedClub ? '#fbbf24' : 'rgba(255,255,255,0.18)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            textTransform: 'none',
            fontWeight: 800,
            fontSize: '0.95rem',
            lineHeight: 1,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            '&:hover': { bgcolor: 'rgba(11,20,16,0.95)' }
          }}
        >
          <Box
            component="span"
            sx={{
              fontSize: '0.5rem',
              fontWeight: 700,
              letterSpacing: 0.6,
              opacity: 0.7,
              lineHeight: 1,
              mb: 0.25
            }}
          >
            CLUB
          </Box>
          <Box component="span" sx={{ lineHeight: 1 }}>
            {selectedClub
              ? abbreviateClubName(
                  selectedClub.customName || selectedClub.name,
                  selectedClub.category
                )
              : '+'}
          </Box>
        </Button>

        {/* View Shots — bottom-left, stacked above the club picker. Only
            renders once shots exist; opens the shots tracker drawer. */}
        {hole.shots.length > 0 && (
          <Button
            variant="contained"
            size="small"
            startIcon={<FormatListBulletedRoundedIcon />}
            onClick={() => setShotsDrawerOpen(true)}
            sx={{
              position: 'absolute',
              bottom: 'calc(84px + env(safe-area-inset-bottom))',
              left: 16,
              zIndex: 4,
              minHeight: 40,
              bgcolor: 'rgba(11,20,16,0.85)',
              color: 'common.white',
              border: 1,
              borderColor: 'rgba(255,255,255,0.18)',
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              '&:hover': { bgcolor: 'rgba(11,20,16,0.95)' }
            }}
          >
            Shots ({hole.shots.length})
          </Button>
        )}

        {/* Auto-track GPS FAB. Only when GPS is enabled in Settings.
            Tap to arm continuous position tracking, which lets the watch's
            ball-strikes auto-record onto your current location. The phone does
            not detect shots from its own movement. Tap again to disarm. */}
        {gpsEnabled && (
          <Fab
            data-tour="track"
            variant="extended"
            color={autoTrackEnabled ? 'error' : 'default'}
            aria-label={autoTrackEnabled ? 'stop auto-tracking' : 'start auto-tracking'}
            onClick={onToggleAutoTrack}
            disabled={trackingBusy}
            size="medium"
            sx={{
              position: 'absolute',
              bottom: 'calc(16px + env(safe-area-inset-bottom))',
              right: 88,
              zIndex: 4,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              // Pill shape with a clear outline so the labeled button reads
              // as a distinct control rather than blending into the map.
              borderRadius: '5px',
              border: '1.5px solid #fbbf24',
              textTransform: 'none',
              fontWeight: 800,
              px: 1.5
            }}
          >
            {autoTrackEnabled ? (
              <StopCircleRoundedIcon sx={{ mr: 0.75 }} />
            ) : (
              <MyLocationRoundedIcon sx={{ mr: 0.75 }} />
            )}
            Track
          </Fab>
        )}
        {gpsEnabled && (autoTrackEnabled || trackingError) && (
          <Box
            sx={{
              position: 'absolute',
              bottom: 'calc(76px + env(safe-area-inset-bottom))',
              right: 16,
              zIndex: 4,
              bgcolor: 'rgba(11,20,16,0.85)',
              color: trackingError ? 'error.light' : 'common.white',
              px: 1.25,
              py: 0.5,
              borderRadius: 1,
              fontSize: '0.7rem',
              fontWeight: 600,
              maxWidth: 220,
              textAlign: 'right'
            }}
          >
            {trackingError ?? 'Auto-track ON — watch will record shots'}
          </Box>
        )}

        {/* Watch is tracking a shot — separate from phone-side auto-track.
            Lives at the top of the map so it doesn't compete with the
            auto-track indicator at the bottom-right. The amber border
            mirrors the watch's Track button color. */}
        {watchTracking.active && (
          <Box
            sx={{
              position: 'absolute',
              top: 'calc(env(safe-area-inset-top) + 8px)',
              left: 16,
              right: 16,
              zIndex: 5,
              bgcolor: 'rgba(11,20,16,0.92)',
              border: '1.5px solid #fbbf24',
              borderRadius: '5px',
              px: 1.25,
              py: 0.75,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              boxShadow: '0 4px 12px rgba(0,0,0,0.45)'
            }}
          >
            <MyLocationRoundedIcon sx={{ color: '#fbbf24', fontSize: 18 }} />
            <Box sx={{ flex: 1, minWidth: 0 }}>
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  color: '#fbbf24',
                  textTransform: 'uppercase'
                }}
              >
                Watch
              </Typography>
              <Typography sx={{ color: 'common.white', fontSize: '0.8rem', fontWeight: 600 }}>
                Tracking shot — tap End Shot on the watch when at ball
              </Typography>
            </Box>
          </Box>
        )}

        {/* On-green putting panel — the full Missed / Made recorder with a
            live GPS → flag distance and a quick ± correction. Replaces the old
            single "Made" Fab; it captures both outcomes and the putt distance,
            and stays up until the hole is made. */}
        {showPuttPanel && (
          <PuttModePanel
            holeNumber={hole.holeNumber}
            liveFeetToPin={remainingFeet}
            puttsThisHole={puttsThisHole}
            onPutt={recordPutt}
          />
        )}

        {/* Yardage markers toggle — small FAB above the Add Shot button.
            Tap to show the 100/150/200/250-yd distance markers from the
            green along the centerline. Tap again to hide. Hidden once the
            hole is complete, and while the putting panel is up (the green-from
            markers are meaningless once the ball is on the green). */}
        {!holeComplete && !showPuttPanel && (
          <Fab
            data-tour="measure"
            size="small"
            aria-label={showYardageMarkers ? 'hide yardage markers' : 'show yardage markers'}
            onClick={() => setShowYardageMarkers((v) => !v)}
            sx={{
              position: 'absolute',
              bottom: lastShotOnGreen
                ? 'calc(152px + env(safe-area-inset-bottom))'
                : 'calc(84px + env(safe-area-inset-bottom))',
              right: 16,
              zIndex: 4,
              bgcolor: showYardageMarkers ? '#fbbf24' : 'rgba(11,20,16,0.85)',
              color: showYardageMarkers ? '#0b1410' : '#fbbf24',
              border: '1.5px solid #fbbf24',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              '&:hover': {
                bgcolor: showYardageMarkers ? '#f59e0b' : 'rgba(11,20,16,0.95)'
              }
            }}
          >
            <StraightenRoundedIcon fontSize="small" />
          </Fab>
        )}

        {/* Recenter map — small FAB stacked directly on top of the yardage
            toggle. Re-frames the hole overview after the user has panned /
            pinch-zoomed the map. Sits one slot (68px) above the ruler button. */}
        {!holeComplete && (
          <Fab
            data-tour="recenter"
            size="small"
            aria-label="recenter map on hole"
            onClick={() => recenterMapRef.current?.()}
            sx={{
              position: 'absolute',
              // While the putting panel is up the yardage toggle is hidden and
              // the full-width panel fills the lower slots, so sit just above it.
              bottom: showPuttPanel
                ? 'calc(244px + env(safe-area-inset-bottom))'
                : lastShotOnGreen
                  ? 'calc(220px + env(safe-area-inset-bottom))'
                  : 'calc(152px + env(safe-area-inset-bottom))',
              right: 16,
              zIndex: 4,
              bgcolor: 'rgba(11,20,16,0.85)',
              color: '#fbbf24',
              border: '1.5px solid #fbbf24',
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
              '&:hover': { bgcolor: 'rgba(11,20,16,0.95)' }
            }}
          >
            <CenterFocusStrongRoundedIcon fontSize="small" />
          </Fab>
        )}

        {/* Add Shot — circular FAB, bottom-right. Hidden once the hole is
            complete (a made putt) so the user can't accidentally add a phantom
            shot. Use the header arrows to move on to the next hole. */}
        {!holeComplete && (
          <Fab
            data-tour="addshot"
            color="primary"
            aria-label="add shot"
            onClick={() => {
              setEditingShot(null);
              // Auto-measure the shot the player just played. They've hit and
              // walked up to the ball, so their CURRENT position (liveFix) is
              // where this shot ended; the start is where the ball was — the
              // previous shot's landing, or the tee for shot 1. Haversine
              // between them gives the distance (e.g. a 210-yd drive) which
              // pre-fills the sheet. This makes the manual "+" flow GPS-aware
              // without auto-track. Putts are skipped (GPS noise dwarfs a putt)
              // and we fall back to blank manual entry when GPS, an anchor, or
              // a live fix is unavailable.
              const ballStart =
                autoTrackInitialBallPos ??
                (teeLat != null && teeLng != null
                  ? { lat: teeLat, lng: teeLng }
                  : null);
              if (
                gpsEnabled &&
                upcomingTargetType !== 'putt' &&
                ballStart &&
                liveFix
              ) {
                const calculatedDistanceM = haversineMeters(
                  { lat: ballStart.lat, lng: ballStart.lng, accuracyM: 0, timestamp: 0 },
                  { lat: liveFix.lat, lng: liveFix.lng, accuracyM: 0, timestamp: 0 }
                );
                // The player has walked to the ball, so liveFix is where the
                // shot ended. Classify that point against the mapped features
                // so the sheet pre-fills the correct lie + target result.
                const inferred = inferShotAt(liveFix.lat, liveFix.lng);
                setPendingGps({
                  startLat: ballStart.lat,
                  startLng: ballStart.lng,
                  endLat: liveFix.lat,
                  endLng: liveFix.lng,
                  calculatedDistanceM,
                  inferredLie: inferred.lie,
                  inferredTargetResult: inferred.targetResult
                });
              } else {
                setPendingGps(null);
              }
              setShotSheet(true);
            }}
            sx={{
              position: 'absolute',
              bottom: 'calc(16px + env(safe-area-inset-bottom))',
              right: 16,
              zIndex: 4,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
            }}
          >
            <AddRoundedIcon />
          </Fab>
        )}

        {/* Hole-complete banner — replaces the Add Shot FAB / Confirm bar once
            a putt is made. Pure status; no actions inside the map area. */}
        {holeComplete && (
          <Stack
            direction="column"
            spacing={1}
            alignItems="flex-end"
            sx={{
              position: 'absolute',
              bottom: 'calc(16px + env(safe-area-inset-bottom))',
              right: 16,
              zIndex: 4
            }}
          >
            {/* Recap — replays the hole's shots as a growing tee → landings →
                pin line with the numbered dots popping in one by one. Only
                shown when there are GPS-tracked shots to animate. */}
            {shotEndPoints.length > 0 && (
              <Button
                variant="contained"
                size="small"
                startIcon={<PlayArrowRoundedIcon />}
                onClick={() => setRecapToken((t) => t + 1)}
                sx={{
                  textTransform: 'none',
                  fontWeight: 800,
                  borderRadius: 999,
                  px: 2,
                  bgcolor: 'rgba(11,20,16,0.92)',
                  color: '#fbbf24',
                  border: 1.5,
                  borderColor: '#fbbf24',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
                  '&:hover': { bgcolor: 'rgba(11,20,16,1)' }
                }}
              >
                Recap shots
              </Button>
            )}
            {unverifiedShots.length > 0 && (
              <Button
                variant="contained"
                size="small"
                startIcon={<CheckCircleRoundedIcon />}
                onClick={() => setVerifyOpen(true)}
                sx={{
                  textTransform: 'none',
                  fontWeight: 800,
                  borderRadius: 999,
                  px: 2,
                  bgcolor: '#fbbf24',
                  color: '#0b1410',
                  boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
                  '&:hover': { bgcolor: '#f59e0b' }
                }}
              >
                Verify {unverifiedShots.length}
              </Button>
            )}
            <Box
              sx={{
                px: 1.5,
                py: 0.75,
                bgcolor: 'rgba(46,125,50,0.9)',
                color: 'common.white',
                borderRadius: 1.5,
                border: 1.5,
                borderColor: 'rgba(165,214,167,0.55)',
                boxShadow: '0 2px 6px rgba(0,0,0,0.45)',
                fontWeight: 800,
                fontSize: '0.85rem',
                letterSpacing: 0.4
              }}
            >
              HOLE COMPLETE
            </Box>
          </Stack>
        )}

        {/* Pending landing-point confirm bar. Appears above the FABs when the
            user has tapped a spot but not yet committed. Tap the map again to
            move it; tap Record Shot to open the shot sheet pre-filled with
            the tapped position, lie, and direction; tap Cancel to clear. */}
        {pendingGps && (
          <Box
            sx={{
              position: 'absolute',
              bottom: 'calc(84px + env(safe-area-inset-bottom))',
              // Full-width — pin to both edges of the map area.
              left: 0,
              right: 0,
              zIndex: 5,
              display: 'flex',
              alignItems: 'center',
              gap: 1,
              bgcolor: 'rgba(11,20,16,0.92)',
              border: 1.5,
              borderColor: '#fbbf24',
              // No corner radius — bar runs edge-to-edge.
              borderRadius: 0,
              px: '20px',
              py: 1,
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.45)'
            }}
          >
            {/* LEFT — Ball Landed read-out */}
            <Box
              sx={{
                flex: 1,
                alignSelf: 'center',
                minWidth: 0,
                textAlign: 'left'
              }}
            >
              <Typography
                variant="caption"
                sx={{
                  display: 'block',
                  fontSize: '0.65rem',
                  fontWeight: 700,
                  letterSpacing: 0.5,
                  color: '#fbbf24',
                  textTransform: 'uppercase'
                }}
              >
                Ball Landed
              </Typography>
              <Typography
                sx={{ color: 'common.white', fontSize: '0.95rem', fontWeight: 700 }}
              >
                {Math.round(metersToYards(pendingGps.calculatedDistanceM))} yds
              </Typography>
            </Box>
            {/* RIGHT — Record (fully rounded pill) then Close (X) */}
            <Button
              variant="contained"
              size="small"
              color="primary"
              onClick={() => {
                setEditingShot(null);
                setShotSheet(true);
              }}
              sx={{
                minHeight: 40,
                textTransform: 'none',
                fontWeight: 700,
                borderRadius: 999,
                px: 2.5
              }}
            >
              Record
            </Button>
            <IconButton
              aria-label="cancel landing point"
              onClick={() => {
                // pendingGps only ever comes from a manual map tap / Add Shot
                // now — shot detection is watch-driven, so cancelling just
                // clears the staged landing point.
                setPendingGps(null);
              }}
              size="small"
              sx={{ color: 'common.white' }}
            >
              <CloseRoundedIcon />
            </IconButton>
          </Box>
        )}
      </Box>

      {/* Club picker drawer — slides up from the bottom-left button. Reuses
          the same ClubPicker component that lives inside AddShotSheet so the
          tier-1 / tier-2 affordance is identical in both places. Auto-closes
          when a leaf club is picked. */}
      <Drawer
        anchor="bottom"
        open={clubPickerOpen}
        onClose={() => setClubPickerOpen(false)}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: '70dvh',
            bgcolor: 'background.default'
          }
        }}
      >
        <Box sx={{ p: 2, pb: 'calc(16px + env(safe-area-inset-bottom))' }}>
          <Stack
            direction="row"
            alignItems="center"
            justifyContent="space-between"
            sx={{ mb: 1.5 }}
          >
            <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
              Pick a club
            </Typography>
            <IconButton size="small" onClick={() => setClubPickerOpen(false)}>
              <CloseRoundedIcon />
            </IconButton>
          </Stack>
          {bagClubs.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
              No clubs in your bag yet — add some in My Bag.
            </Typography>
          ) : (
            <ClubPicker
              bagClubs={bagClubs}
              clubId={selectedClubId}
              tier1={selectedClubTier1}
              onChange={(nextClubId, nextTier1) => {
                setSelectedClubId(nextClubId);
                setSelectedClubTier1(nextTier1);
                // Close the drawer on a concrete club pick. A tier-1 tap that
                // expands a multi-club group (and leaves clubId null) keeps
                // the drawer open so the user can pick the leaf club next.
                if (nextClubId) setClubPickerOpen(false);
              }}
            />
          )}
        </Box>
      </Drawer>

      {/* Shots tracker drawer — opened by the View Shots button on the map. */}
      <Drawer
        anchor="bottom"
        open={shotsDrawerOpen}
        onClose={() => setShotsDrawerOpen(false)}
        PaperProps={{
          sx: {
            borderTopLeftRadius: 16,
            borderTopRightRadius: 16,
            maxHeight: '85dvh',
            bgcolor: 'background.default'
          }
        }}
      >
        <Box sx={{ p: 2, pb: 'calc(16px + env(safe-area-inset-bottom))' }}>
          <ShotsCard
            shots={hole.shots}
            bagClubs={bagClubs}
            onAdd={() => {
              setShotsDrawerOpen(false);
              setEditingShot(null);
              setShotSheet(true);
            }}
            onEdit={(shot) => {
              setShotsDrawerOpen(false);
              setEditingShot(shot);
              setShotSheet(true);
            }}
            onDelete={onDeleteShot}
          />
        </Box>
      </Drawer>

      <AddShotSheet
        open={shotSheet}
        shotNumber={editingShot ? editingShot.shotNumber : hole.shots.length + 1}
        editing={
          editingShot
            ? ({
                clubId: editingShot.clubId,
                distance: editingShot.distance,
                distanceUnit: editingShot.distanceUnit,
                targetType: editingShot.targetType,
                targetResult: editingShot.targetResult,
                lie: editingShot.lie,
                penaltyType: editingShot.penaltyType,
                notes: editingShot.notes,
                startLat: editingShot.startLat ?? null,
                startLng: editingShot.startLng ?? null,
                endLat: editingShot.endLat ?? null,
                endLng: editingShot.endLng ?? null,
                calculatedDistance: editingShot.calculatedDistance ?? null
              } satisfies ShotEditDraft)
            : null
        }
        holePar={hole.par}
        bagClubs={bagClubs}
        defaultClubId={defaultClubId}
        defaultGps={pendingGps}
        onClose={() => {
          setShotSheet(false);
          setEditingShot(null);
          setPendingGps(null);
        }}
        onSubmit={onSubmitShot}
      />

      <HoleDetailsDialog
        open={detailsOpen}
        par={hole.par}
        yardage={hole.yardage}
        onClose={() => setDetailsOpen(false)}
        onSubmit={({ par, yardage }) => {
          updateHole(hole.holeNumber, { par, yardage });
          setDetailsOpen(false);
        }}
      />

      {/* Per-hole verification of auto-detected shots. Auto-opens at
          hole-complete; reopenable via the "Verify N" button. Each shot can be
          confirmed as-is, edited (opens the shot sheet — saving marks it
          verified), or deleted (false positive). */}
      <Dialog
        open={verifyOpen}
        onClose={() => setVerifyOpen(false)}
        fullWidth
        maxWidth="xs"
        PaperProps={{ sx: { bgcolor: 'background.default', borderRadius: 2 } }}
      >
        <DialogTitle sx={{ fontWeight: 800, pb: 0.5 }}>
          Verify shots
          <Typography variant="caption" color="text.secondary" display="block" sx={{ fontWeight: 500 }}>
            Auto-detected from your watch — confirm, edit, or remove.
          </Typography>
        </DialogTitle>
        <DialogContent dividers>
          {unverifiedShots.length === 0 ? (
            <Stack alignItems="center" spacing={1} sx={{ py: 3 }}>
              <CheckCircleRoundedIcon sx={{ color: 'success.main', fontSize: 36 }} />
              <Typography variant="body2" color="text.secondary">
                All shots verified.
              </Typography>
            </Stack>
          ) : (
            <Stack spacing={1}>
              {unverifiedShots.map((s) => {
                const club =
                  bagClubs.find((c) => c.clubId === s.clubId) ?? null;
                const clubLabel = club
                  ? club.customName || club.name
                  : 'No club';
                const distLabel =
                  s.distance != null
                    ? `${s.distance} ${s.distanceUnit === 'feet' ? 'ft' : 'yds'}`
                    : '—';
                const resultLabel = [s.targetType, s.targetResult]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <Box
                    key={s.tempId}
                    sx={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      p: 1,
                      borderRadius: 1.5,
                      bgcolor: 'background.paper',
                      border: 1,
                      borderColor: 'rgba(251,191,36,0.4)'
                    }}
                  >
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography sx={{ fontWeight: 700, fontSize: '0.9rem' }}>
                        Shot {s.shotNumber} · {clubLabel}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        {distLabel}
                        {resultLabel ? ` · ${resultLabel}` : ''}
                      </Typography>
                    </Box>
                    <IconButton
                      aria-label="edit shot"
                      size="small"
                      onClick={() => {
                        setEditingShot(s);
                        setShotSheet(true);
                        setVerifyOpen(false);
                      }}
                    >
                      <EditRoundedIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      aria-label="delete shot"
                      size="small"
                      onClick={() => void onDeleteShot(s)}
                    >
                      <DeleteOutlineRoundedIcon fontSize="small" />
                    </IconButton>
                    <IconButton
                      aria-label="verify shot"
                      size="small"
                      onClick={() => void verifyShot(s)}
                      sx={{ color: 'success.main' }}
                    >
                      <CheckCircleRoundedIcon fontSize="small" />
                    </IconButton>
                  </Box>
                );
              })}
            </Stack>
          )}
        </DialogContent>
        <DialogActions sx={{ px: 2, py: 1.5 }}>
          {unverifiedShots.length > 0 && (
            <Button
              onClick={() => void verifyAllOnHole()}
              variant="contained"
              startIcon={<CheckCircleRoundedIcon />}
              sx={{ textTransform: 'none', fontWeight: 700, borderRadius: '6px' }}
            >
              Verify all
            </Button>
          )}
          <Button
            onClick={() => setVerifyOpen(false)}
            sx={{ textTransform: 'none', fontWeight: 700 }}
          >
            Done
          </Button>
        </DialogActions>
      </Dialog>

      <RoundTour open={tourOpen} steps={tourSteps} onClose={closeTour} />
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Shots card + timeline (rendered inside the View Shots drawer)
// ---------------------------------------------------------------------------

interface ShotsCardProps {
  shots: LocalShot[];
  bagClubs: BagClub[];
  onAdd: () => void;
  onEdit: (shot: LocalShot) => void;
  onDelete: (shot: LocalShot) => void;
}

function ShotsCard({ shots, bagClubs, onAdd, onEdit, onDelete }: ShotsCardProps) {
  return (
    <Card elevation={0} sx={{ bgcolor: 'background.paper' }}>
      <CardContent>
        <Stack direction="row" alignItems="center" justifyContent="space-between" mb={shots.length ? 2 : 0}>
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.6 }}
            >
              Shots
            </Typography>
            <Typography variant="h6">{shots.length} logged</Typography>
          </Box>
          <Button
            variant="contained"
            startIcon={<AddRoundedIcon />}
            size="large"
            onClick={onAdd}
            sx={{ minHeight: 48 }}
          >
            Add Shot
          </Button>
        </Stack>

        {shots.length === 0 ? (
          <Stack
            alignItems="center"
            sx={{
              border: '1px dashed',
              borderColor: 'divider',
              borderRadius: 2,
              py: 3,
              mt: 2
            }}
          >
            <SportsGolfRoundedIcon sx={{ color: 'text.secondary', fontSize: 32 }} />
            <Typography variant="body2" color="text.secondary" mt={1}>
              Tap "Add Shot" to log each swing.
            </Typography>
          </Stack>
        ) : (
          <Box sx={{ position: 'relative' }}>
            <Stack spacing={1.25}>
              {shots
                .slice()
                .sort((a, b) => a.shotNumber - b.shotNumber)
                .map((shot) => (
                  <ShotRow
                    key={shot.tempId}
                    shot={shot}
                    bagClubs={bagClubs}
                    onEdit={() => onEdit(shot)}
                    onDelete={() => onDelete(shot)}
                  />
                ))}
            </Stack>
          </Box>
        )}
      </CardContent>
    </Card>
  );
}

function ShotRow({
  shot,
  bagClubs,
  onEdit,
  onDelete
}: {
  shot: LocalShot;
  bagClubs: BagClub[];
  onEdit: () => void;
  onDelete: () => void;
}) {
  const club = bagClubs.find((c) => c.clubId === shot.clubId);
  const clubLabel = club ? club.customName || club.name : 'Club';
  const distanceLabel =
    shot.distance != null
      ? `${shot.distance} ${shot.distanceUnit === 'feet' ? 'ft' : 'yds'}`
      : null;
  const resultLabel = describeShotOutcome(shot) ?? RESULT_LABELS[shot.shotResult];
  const lieLabel = shot.lie && !lieMatchesResult(shot)
    ? `→ ${capitalize(shot.lie)}`
    : null;
  const penaltyLabel = shot.penaltyType ? PENALTY_LABELS[shot.penaltyType] : null;

  return (
    <Stack
      direction="row"
      alignItems="center"
      spacing={1}
      onClick={onEdit}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          onEdit();
        }
      }}
      sx={{
        bgcolor: 'action.hover',
        borderRadius: 2,
        px: 1.25,
        py: 1,
        cursor: 'pointer',
        transition: 'background-color 120ms',
        '&:hover': { bgcolor: 'action.selected' },
        '&:focus-visible': {
          outline: '2px solid',
          outlineColor: 'primary.main',
          outlineOffset: 2
        }
      }}
    >
      <Box
        sx={{
          width: 32,
          height: 32,
          borderRadius: '50%',
          bgcolor: 'primary.main',
          color: 'primary.contrastText',
          display: 'grid',
          placeItems: 'center',
          fontWeight: 800,
          fontSize: 14,
          flexShrink: 0
        }}
      >
        {shot.shotNumber}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography variant="body2" sx={{ fontWeight: 600 }} noWrap>
          {clubLabel}
          {distanceLabel && (
            <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500, ml: 0.75 }}>
              · {distanceLabel}
            </Box>
          )}
          <Box component="span" sx={{ color: 'primary.light', fontWeight: 600, ml: 0.75 }}>
            · {resultLabel}
          </Box>
          {lieLabel && (
            <Box component="span" sx={{ color: 'text.secondary', fontWeight: 500, ml: 0.75 }}>
              {lieLabel}
            </Box>
          )}
          {penaltyLabel && (
            <Box
              component="span"
              sx={{
                color: 'warning.main',
                fontWeight: 700,
                ml: 0.75,
                fontSize: '0.8rem',
                textTransform: 'uppercase',
                letterSpacing: 0.4
              }}
            >
              · {penaltyLabel}
            </Box>
          )}
        </Typography>
        {shot.notes && (
          <Typography variant="caption" color="text.secondary" noWrap>
            {shot.notes}
          </Typography>
        )}
      </Box>
      <IconButton
        size="small"
        aria-label="delete shot"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        color="error"
      >
        <DeleteOutlineRoundedIcon fontSize="small" />
      </IconButton>
    </Stack>
  );
}

// ---------------------------------------------------------------------------
// Map overlay stat pill — rangefinder-style readout floating on top of the
// hole layout. Three of these stack on the right side of the map.
// ---------------------------------------------------------------------------

function StatPill({
  label,
  value,
  subValue,
  accent = false
}: {
  label: string;
  /** Main pill value. Numbers for counts (shots / putts / penalties), strings
      for formatted reads like the par diff "+3", "-2", "E". */
  value: number | string;
  /** Optional small line under the value. */
  subValue?: string;
  accent?: boolean;
}) {
  return (
    <Box
      sx={{
        bgcolor: accent ? 'rgba(46,125,50,0.85)' : 'rgba(11,20,16,0.78)',
        color: 'common.white',
        borderRadius: '5px',
        border: 1,
        borderColor: accent ? 'rgba(165,214,167,0.55)' : 'rgba(255,255,255,0.18)',
        backdropFilter: 'blur(6px)',
        WebkitBackdropFilter: 'blur(6px)',
        px: 1.25,
        py: 0.6,
        minWidth: 64,
        textAlign: 'center',
        boxShadow: '0 2px 6px rgba(0,0,0,0.35)'
      }}
    >
      <Typography
        variant="caption"
        sx={{
          display: 'block',
          opacity: 0.85,
          fontSize: '0.62rem',
          letterSpacing: 0.6,
          textTransform: 'uppercase',
          lineHeight: 1
        }}
      >
        {label}
      </Typography>
      <Typography
        variant={accent ? 'h5' : 'h6'}
        sx={{ fontWeight: 800, lineHeight: 1.1, mt: 0.25, color: 'common.white' }}
      >
        {value}
      </Typography>
      {subValue && (
        <Typography
          variant="caption"
          sx={{
            display: 'block',
            fontSize: '0.7rem',
            fontWeight: 700,
            lineHeight: 1,
            mt: 0.25,
            color: '#fbbf24'
          }}
        >
          {subValue}
        </Typography>
      )}
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Hole details dialog
// ---------------------------------------------------------------------------

interface HoleDetailsDialogProps {
  open: boolean;
  par: number;
  yardage: number | null;
  onClose: () => void;
  onSubmit: (values: { par: number; yardage: number | null }) => void;
}

function HoleDetailsDialog({ open, par, yardage, onClose, onSubmit }: HoleDetailsDialogProps) {
  const [parValue, setParValue] = useState<number>(par);
  const [yardsValue, setYardsValue] = useState<string>(yardage != null ? String(yardage) : '');

  useEffect(() => {
    if (!open) return;
    setParValue(par);
    setYardsValue(yardage != null ? String(yardage) : '');
  }, [open, par, yardage]);

  const yardsTrimmed = yardsValue.trim();
  const yardsNum = yardsTrimmed === '' ? null : Number(yardsTrimmed);
  const yardsValid = yardsNum == null || (Number.isFinite(yardsNum) && yardsNum >= 0 && yardsNum <= 999);

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="xs">
      <DialogTitle>Hole details</DialogTitle>
      <DialogContent>
        <Stack spacing={3} mt={1}>
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.6, display: 'block', mb: 1 }}
            >
              Par
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 1 }}>
              {[3, 4, 5].map((n) => {
                const active = parValue === n;
                return (
                  <Button
                    key={n}
                    onClick={() => setParValue(n)}
                    variant={active ? 'contained' : 'outlined'}
                    sx={{
                      minHeight: 72,
                      fontSize: '1.75rem',
                      fontWeight: 800,
                      borderRadius: 2
                    }}
                  >
                    {n}
                  </Button>
                );
              })}
            </Box>
          </Box>
          <Box>
            <Typography
              variant="caption"
              color="text.secondary"
              sx={{ textTransform: 'uppercase', letterSpacing: 0.6, display: 'block', mb: 1 }}
            >
              Yardage
            </Typography>
            <TextField
              value={yardsValue}
              onChange={(e) => setYardsValue(e.target.value)}
              placeholder="385"
              type="number"
              autoFocus
              inputProps={{ inputMode: 'numeric', min: 0, max: 999, step: 5 }}
              error={!yardsValid}
              helperText={!yardsValid ? 'Enter a value between 0 and 999.' : ' '}
              InputProps={{
                endAdornment: <InputAdornment position="end">yds</InputAdornment>
              }}
            />
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ p: 2 }}>
        <Button onClick={onClose}>Cancel</Button>
        <Button
          variant="contained"
          disabled={!yardsValid}
          onClick={() =>
            onSubmit({
              par: parValue,
              yardage: yardsNum
            })
          }
        >
          Save
        </Button>
      </DialogActions>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function isPutterShot(shot: LocalShot, bagClubs: BagClub[]): boolean {
  if (!shot.clubId) return false;
  const club = bagClubs.find((c) => c.clubId === shot.clubId);
  return club?.category === 'putter';
}

/** True for penalty types that ADD a stroke (OB, Water, Lost Ball, Unplayable, Wrong Ball). */
function isStrokePenalty(penaltyType: PenaltyType | null | undefined): boolean {
  if (!penaltyType) return false;
  return (STROKE_PENALTY_TYPES as readonly string[]).includes(penaltyType);
}

/**
 * Derive the legacy fairway_result enum value from the first shot of the hole.
 * Par 3 holes don't have a fairway → always 'na'.
 * If the user hasn't taken the tee shot yet, return null.
 */
function deriveFairwayResult(hole: LocalHole): FairwayResult | null {
  if (hole.par === 3) return 'na';
  const tee = hole.shots.find((s) => s.shotNumber === 1);
  if (!tee) return null;
  if (tee.targetType !== 'fairway') return null;
  switch (tee.targetResult) {
    case 'hit':
      return 'hit';
    case 'left':
      return 'left';
    case 'right':
      return 'right';
    case 'short':
      return 'short';
    case 'long':
      return 'long';
    default:
      return null;
  }
}

/** Human-readable outcome built from target_type + target_result. Falls back to RESULT_LABELS. */
function describeShotOutcome(shot: LocalShot): string | null {
  if (!shot.targetType || !shot.targetResult) return null;
  if (shot.targetType === 'putt') {
    if (shot.targetResult === 'made') return 'Made';
    return `Missed ${capitalize(shot.targetResult)}`;
  }
  if (shot.targetType === 'green') {
    return shot.targetResult === 'hit' ? 'Hit Green' : capitalize(shot.targetResult);
  }
  // fairway
  return shot.targetResult === 'hit' ? 'Fairway' : capitalize(shot.targetResult);
}

/** Skip showing the lie chip when it's the obvious consequence of hitting the target. */
function lieMatchesResult(shot: LocalShot): boolean {
  if (!shot.lie || !shot.targetResult) return false;
  if (shot.targetResult === 'hit' && shot.targetType === 'green' && shot.lie === 'green') return true;
  if (shot.targetResult === 'hit' && shot.targetType === 'fairway' && shot.lie === 'fairway') return true;
  if (shot.targetResult === 'made' && shot.lie === 'green') return true;
  return false;
}

function capitalize(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}
