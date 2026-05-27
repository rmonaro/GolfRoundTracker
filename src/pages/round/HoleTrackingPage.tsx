import { useState, useEffect } from 'react';
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
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import SportsGolfRoundedIcon from '@mui/icons-material/SportsGolfRounded';
import FormatListBulletedRoundedIcon from '@mui/icons-material/FormatListBulletedRounded';
import MyLocationRoundedIcon from '@mui/icons-material/MyLocationRounded';
import StopCircleRoundedIcon from '@mui/icons-material/StopCircleRounded';
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
import { computeTotalScore } from '@/features/round/computeRoundTotals';
import { scoreVsPar } from '@/utils/format';
import { roundRepo } from '@/services/roundRepo';
import { courseRepo } from '@/services/courseRepo';
import { useQuery } from '@tanstack/react-query';
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
  const navigate = useNavigate();
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

  // Pre-select the user's putter when on the green. Uses the first putter in
  // the bag (most users have only one). The user-driven `selectedClubId`
  // overrides this auto-pick, but when the user already picked the putter
  // this just re-affirms it.
  const putterAutoClubId = lastShotOnGreen
    ? bagClubs.find((c) => c.category === 'putter')?.clubId ?? null
    : null;
  const defaultClubId = selectedClubId ?? putterAutoClubId;
  const selectedClub = bagClubs.find((c) => c.clubId === defaultClubId) ?? null;

  // Reset the user club pick whenever the hole changes — each new hole starts
  // with a blank slate so the picker doesn't carry e.g. a wedge over to a tee
  // shot on the next hole.
  useEffect(() => {
    setSelectedClubId(null);
    setSelectedClubTier1(null);
  }, [hole.holeNumber]);

  // Auto-select the putter the moment the last recorded shot's lie is green.
  // Keyed off shot count + the last shot's lie so it fires once when a shot
  // lands on the green (vs. running on every render). User can still override
  // by tapping a different club in the main-screen picker.
  const lastShotLie = lastShot?.lie ?? null;
  useEffect(() => {
    if (lastShotLie !== 'green') return;
    const putterId = bagClubs.find((c) => c.category === 'putter')?.clubId ?? null;
    if (!putterId) return;
    setSelectedClubId(putterId);
    setSelectedClubTier1('putter');
    // bagClubs is stable across a session (Zustand store), so excluding it
    // from deps avoids an extra fire on initial mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hole.shots.length, lastShotLie]);

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
  const suggestedClub =
    remainingYards != null && !lastShotOnGreen
      ? recommendClub(bagClubs, remainingYards)
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
          <IconButton aria-label="finish" color="primary" onClick={finishRound}>
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
          puttingMode={lastShotOnGreen}
          bagClubs={bagClubs}
          landingPoint={
            pendingGps ? [pendingGps.endLng, pendingGps.endLat] : null
          }
          shotEndPoints={shotEndPoints}
          onShotLanded={
            holeComplete
              ? undefined
              : (data) => {
                  // Just stash the landing point — DON'T open the shot UI yet.
                  // The user gets a chance to move the marker by tapping
                  // elsewhere on the map, then commits via "Record Shot".
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
              left: '50%',
              transform: 'translateX(-50%)',
              // 20% narrower than full-width: 80% of the map width, centered.
              width: '80%',
              zIndex: 5,
              display: 'flex',
              gap: 1,
              bgcolor: 'rgba(11,20,16,0.92)',
              border: 1.5,
              borderColor: '#fbbf24',
              borderRadius: 2,
              // 20px horizontal padding per side; vertical kept tight.
              px: '20px',
              py: 1,
              backdropFilter: 'blur(6px)',
              WebkitBackdropFilter: 'blur(6px)',
              boxShadow: '0 4px 12px rgba(0,0,0,0.45)'
            }}
          >
            {/* LEFT — Cancel */}
            <Button
              size="small"
              onClick={() => setPendingGps(null)}
              sx={{
                color: 'common.white',
                minHeight: 40,
                textTransform: 'none'
              }}
            >
              Cancel
            </Button>
            {/* CENTER — Ball Landed read-out */}
            <Box
              sx={{
                flex: 1,
                alignSelf: 'center',
                minWidth: 0,
                textAlign: 'center'
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
            {/* RIGHT — Record Shot (fully rounded pill) */}
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
                // 100% rounded on both ends — `borderRadius: 999` is the
                // standard "pill" trick (any value greater than half the
                // element's height collapses to a full semicircle on each side).
                borderRadius: 999,
                px: 2.5
              }}
            >
              Record Shot
            </Button>
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
