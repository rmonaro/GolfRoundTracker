import { useState, useEffect, useRef } from 'react';
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
import {
  ensureGpsPermission,
  getCurrentPosition,
  haversineMeters,
  isGpsAvailable
} from '@/services/gpsService';
import { useNavigate, Navigate } from 'react-router-dom';
import { useRoundStore, type LocalHole, type LocalShot } from '@/stores/roundStore';
import { useBagStore } from '@/stores/bagStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useAutosaveHole } from '@/features/round/useAutosaveHole';
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
import { recommendClub } from '@/features/course/HoleLayout';
import { watchBridge, type WatchInboundMessage } from '@/services/watchBridge';
import { computeTotalScore } from '@/features/round/computeRoundTotals';
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
  type PenaltyType
} from '@/models';

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
  const [shotSheet, setShotSheet] = useState(false);
  const [editingShot, setEditingShot] = useState<LocalShot | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [shotsDrawerOpen, setShotsDrawerOpen] = useState(false);
  // GPS shot tracking — capture start on tap, stop captures end + opens
  // AddShotSheet pre-filled with the calculated distance.
  // GPS opt-in. Off by default so we don't prompt non-GPS users for location.
  const gpsEnabled = useSettingsStore((s) => s.gpsEnabled);

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

  const [tracking, setTracking] = useState<{ lat: number; lng: number } | null>(null);
  const [trackingBusy, setTrackingBusy] = useState(false);
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
  const [pendingGps, setPendingGps] = useState<{
    startLat: number;
    startLng: number;
    endLat: number;
    endLng: number;
    calculatedDistanceM: number;
    inferredLie?: import('@/models').Lie | null;
    inferredTargetResult?: import('@/models').TargetResult | null;
  } | null>(null);

  const onStartTracking = async () => {
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

      // Refuse to start tracking when the user clearly isn't at the course.
      // Skips the check when the course doesn't have lat/lng (can't verify).
      // 2 km threshold matches the at-course chip in the header.
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
          // Keep the fresh fix in userLoc so the header chip reflects reality.
          setUserLoc({ lat: pt.lat, lng: pt.lng });
          return;
        }
      }

      setUserLoc({ lat: pt.lat, lng: pt.lng });
      setTracking({ lat: pt.lat, lng: pt.lng });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not get start location';
      setTrackingError(
        /denied|permission/i.test(msg)
          ? 'Location permission denied. Enable it in device Settings.'
          : msg
      );
    } finally {
      setTrackingBusy(false);
    }
  };

  const onStopTracking = async () => {
    if (!tracking) return;
    setTrackingBusy(true);
    setTrackingError(null);
    try {
      const pt = await getCurrentPosition();
      const distM = haversineMeters(
        { ...tracking, accuracyM: 0, timestamp: 0 },
        { lat: pt.lat, lng: pt.lng, accuracyM: 0, timestamp: 0 }
      );
      setPendingGps({
        startLat: tracking.lat,
        startLng: tracking.lng,
        endLat: pt.lat,
        endLng: pt.lng,
        calculatedDistanceM: distM
      });
      setTracking(null);
      setEditingShot(null);
      setShotSheet(true);
    } catch (err) {
      setTrackingError(err instanceof Error ? err.message : 'Could not get end location');
    } finally {
      setTrackingBusy(false);
    }
  };

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

  // Round-wide totals for the Score pill in the map overlay. Pulls strokes +
  // penalties across every hole played so far. Par sums only holes with at
  // least one recorded shot — so an unplayed hole 18 doesn't drag the diff
  // toward "huge under par" early in the round. `scoreVsPar` returns "+3",
  // "-2", "E".
  const totalRoundScore = computeTotalScore(active.holes);
  const totalRoundPar = active.holes
    .filter((h) => h.shots.length > 0)
    .reduce((s, h) => s + h.par, 0);
  const totalRoundDiff = scoreVsPar(totalRoundScore, totalRoundPar);

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
  const shotEndPoints: Array<[number, number]> = hole.shots
    .filter((s) => s.endLat != null && s.endLng != null)
    .map((s) => [s.endLng as number, s.endLat as number]);

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

  // Did the last shot land within ~30 yards (≈27 m) of the green? This covers
  // "around the green" — a chip-shot landing zone where the next stroke is
  // almost certainly a putt or a chip, and the player wants the close-up
  // green view rather than the wide tee→green framing.
  const greenLat = layoutQuery.data?.hole.green_lat ?? null;
  const greenLng = layoutQuery.data?.hole.green_lng ?? null;
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

  // Pre-select the user's putter when on the green. Uses the first putter in
  // the bag (most users have only one). The user-driven `selectedClubId`
  // overrides this auto-pick, but when the user already picked the putter
  // this just re-affirms it.
  const putterAutoClubId = lastShotOnGreen
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
    !lastShotOnGreen && remainingYardsEarly != null && remainingYardsEarly > 0
      ? recommendClub(bagClubs, remainingYardsEarly, {
          excludeDriver: excludeDriverForRec
        })?.clubId ?? null
      : null;
  const defaultClubId = selectedClubId ?? putterAutoClubId ?? recommendedClubId;
  const selectedClub = bagClubs.find((c) => c.clubId === defaultClubId) ?? null;

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
  const remainingFeet = lastShotOnGreen
    ? lastShotMadePutt
      ? 0
      : lastShotEndDistFromGreenM != null
        ? Math.round(lastShotEndDistFromGreenM * 3.28084)
        : remainingYards != null
          ? remainingYards * 3
          : null
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
    calculatedDistance
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
        calculatedDistance
      });
      setShotSheet(false);
      setEditingShot(null);

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
            calculated_distance: calculatedDistance
          });
        } catch (err) {
          console.error('[shot] edit save failed', err);
        }
      }
      return;
    }

    // ADD path
    const nextNum = (hole.shots.length ?? 0) + 1;
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
      startLat,
      startLng,
      endLat,
      endLng,
      calculatedDistance
    });
    setShotSheet(false);

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
        calculated_distance: calculatedDistance
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

  const onDeleteShot = async (shot: LocalShot) => {
    removeShotLocal(hole.holeNumber, shot.tempId);
    if (shot.remoteId) {
      try {
        await roundRepo.deleteShot(shot.remoteId);
      } catch (err) {
        console.error('[shot] delete failed', err);
      }
    }
  };

  const goPrev = () => setCurrentHole(Math.max(0, idx - 1));
  const goNext = () => setCurrentHole(Math.min(active.holes.length - 1, idx + 1));

  // Watch → phone message handler. Refs keep the listener pinned to the
  // latest handler functions without re-subscribing on every render (a
  // resubscribe storm would silently double-fire the next watch message).
  const goPrevRef = useRef(goPrev);
  const goNextRef = useRef(goNext);
  const onSubmitShotRef = useRef(onSubmitShot);
  const bagClubsRef = useRef(bagClubs);
  useEffect(() => {
    goPrevRef.current = goPrev;
    goNextRef.current = goNext;
    onSubmitShotRef.current = onSubmitShot;
    bagClubsRef.current = bagClubs;
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
        if (msg.type === 'recordShot') {
          // Lie auto-fill mirrors AddShotSheet's logic. Distance left null —
          // the user can backfill on the phone if they care. GPS pair flows
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

          onSubmitShotRef
            .current({
              clubId: msg.clubId,
              clubCategory: club?.category ?? null,
              distance: null,
              distanceUnit: null,
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
              calculatedDistance: null
            })
            .catch((err) => {
              console.error('[watch] recordShot from watch failed', err);
            });
        }
      });
    })();
    return () => {
      handle?.remove().catch(() => undefined);
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
            aria-label="next hole"
            onClick={goNext}
            disabled={idx === active.holes.length - 1}
          >
            <ArrowForwardIosRoundedIcon />
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
          aimMode
          ballDistanceFromTeeM={ballDistanceFromTeeM}
          suggestedHandleDistanceM={suggestedHandleDistanceM}
          puttingMode={lastShotOnGreen && !holeComplete}
          bagClubs={bagClubs}
          landingPoint={
            pendingGps ? [pendingGps.endLng, pendingGps.endLat] : null
          }
          shotEndPoints={shotEndPoints}
          // Hide the aim UI while reviewing a tap (pendingGps), after the
          // hole is complete, OR while moving the pin — in all three states
          // the handle / line / distance pill would either be misleading or
          // compete with the active task.
          hideAim={!!pendingGps || holeComplete || pinEditMode}
          useTargetDot={nextShotOntoGreen}
          targetType={upcomingTargetType}
          showYardageMarkers={showYardageMarkers}
          pinOverride={
            // Course-wide shared pin (saved by any player; everyone inherits it).
            // Falls back to the legacy per-round override on the LocalHole for
            // any round that was started before the shared-pin migration.
            layoutQuery.data?.hole.pin_lat != null && layoutQuery.data?.hole.pin_lng != null
              ? [layoutQuery.data.hole.pin_lng, layoutQuery.data.hole.pin_lat]
              : hole.pinLat != null && hole.pinLng != null
                ? [hole.pinLng, hole.pinLat]
                : null
          }
          maxAimDistanceFromBallM={maxAimDistanceFromBallM}
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
        {(remainingYards != null || remainingFeet != null) && (
          <Box
            sx={{
              position: 'absolute',
              top: 12,
              left: 12,
              zIndex: 3,
              pointerEvents: 'none',
              bgcolor: 'rgba(11,20,16,0.88)',
              color: 'common.white',
              border: 1.5,
              borderColor: '#fbbf24',
              borderRadius: 1.5,
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

        {/* Club picker — bottom-left primary action. Shows the currently
            selected club (or "Select club" placeholder); tap to slide up the
            drawer with the full ClubPicker tier-1 / tier-2 UI. Pre-fills the
            AddShotSheet so the user can scout club choice before committing. */}
        <Button
          variant="contained"
          size="large"
          startIcon={<SportsGolfRoundedIcon />}
          onClick={() => setClubPickerOpen(true)}
          sx={{
            position: 'absolute',
            bottom: 'calc(16px + env(safe-area-inset-bottom))',
            left: 16,
            zIndex: 4,
            minHeight: 56,
            maxWidth: 'calc(100% - 180px)',
            bgcolor: 'rgba(11,20,16,0.85)',
            color: 'common.white',
            border: 1.5,
            borderColor: selectedClub ? '#fbbf24' : 'rgba(255,255,255,0.18)',
            backdropFilter: 'blur(6px)',
            WebkitBackdropFilter: 'blur(6px)',
            textTransform: 'none',
            fontWeight: 700,
            '&:hover': { bgcolor: 'rgba(11,20,16,0.95)' }
          }}
        >
          {selectedClub ? selectedClub.customName || selectedClub.name : 'Select club'}
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

        {/* Track GPS — only visible when GPS is enabled in Settings. Secondary
            FAB to the left of Add Shot. Toggles start-capture / stop-capture;
            on stop opens AddShotSheet pre-filled with the GPS distance. */}
        {gpsEnabled && (
          <Fab
            color={tracking ? 'error' : 'default'}
            aria-label={tracking ? 'stop tracking' : 'track shot with gps'}
            onClick={tracking ? onStopTracking : onStartTracking}
            disabled={trackingBusy}
            size="medium"
            sx={{
              position: 'absolute',
              bottom: 'calc(16px + env(safe-area-inset-bottom))',
              right: 88,
              zIndex: 4,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
            }}
          >
            {tracking ? <StopCircleRoundedIcon /> : <MyLocationRoundedIcon />}
          </Fab>
        )}
        {gpsEnabled && (tracking || trackingError) && (
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
              maxWidth: 200,
              textAlign: 'right'
            }}
          >
            {trackingError ?? 'Tracking… tap stop at ball'}
          </Box>
        )}

        {/* Made — one-tap putt record. Only on the green and before the hole
            is complete. Uses the player's putter, the current remaining feet
            as the putt distance, and records a made-putt shot directly —
            skipping the Add Shot sheet for the most common end-of-hole
            action. Sits above the Add Shot FAB to keep the FAB stack
            consistent on every hole. */}
        {!holeComplete &&
          lastShotOnGreen &&
          bagClubs.some((c) => c.category === 'putter') && (
            <Fab
              variant="extended"
              aria-label="record made putt"
              onClick={() => {
                const putter = bagClubs.find((c) => c.category === 'putter');
                if (!putter) return;
                void onSubmitShot({
                  clubId: putter.clubId,
                  clubCategory: 'putter',
                  distance: remainingFeet,
                  distanceUnit: remainingFeet != null ? 'feet' : null,
                  targetType: 'putt',
                  targetResult: 'made',
                  lie: 'green',
                  penaltyType: null,
                  derivedShotResult: 'made_putt',
                  notes: null,
                  startLat: null,
                  startLng: null,
                  endLat: null,
                  endLng: null,
                  calculatedDistance: null
                });
              }}
              sx={{
                position: 'absolute',
                bottom: 'calc(84px + env(safe-area-inset-bottom))',
                right: 16,
                zIndex: 4,
                bgcolor: '#2e7d32',
                color: 'common.white',
                fontWeight: 800,
                px: 2.5,
                '&:hover': { bgcolor: '#1b5e20' },
                boxShadow: '0 4px 12px rgba(0,0,0,0.4)'
              }}
            >
              <FlagCircleRoundedIcon sx={{ mr: 1 }} />
              Made
            </Fab>
          )}

        {/* Yardage markers toggle — small FAB above the Add Shot button.
            Tap to show the 100/150/200/250-yd distance markers from the
            green along the centerline. Tap again to hide. Hidden once the
            hole is complete. */}
        {!holeComplete && (
          <Fab
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

        {/* Add Shot — circular FAB, bottom-right. Hidden once the hole is
            complete (a made putt) so the user can't accidentally add a phantom
            shot. Use the header arrows to move on to the next hole. */}
        {!holeComplete && (
          <Fab
            color="primary"
            aria-label="add shot"
            onClick={() => {
              setEditingShot(null);
              setPendingGps(null);
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
          <Box
            sx={{
              position: 'absolute',
              bottom: 'calc(16px + env(safe-area-inset-bottom))',
              right: 16,
              zIndex: 4,
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
              onClick={() => setPendingGps(null)}
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
        borderRadius: 1.5,
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
