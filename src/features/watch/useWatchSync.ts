import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/lib/supabase';
import { useRoundStore } from '@/stores/roundStore';
import { useBagStore } from '@/stores/bagStore';
import { useWatchHintsStore } from '@/stores/watchHintsStore';
import { useHoleLayout } from '@/features/course/useHoleLayout';
import { metersToYards } from '@/features/course/distance';
import { haversineMeters } from '@/services/gpsService';
import { scoreVsPar } from '@/utils/format';
import { recommendClub } from '@/features/course/HoleLayout';
import { watchBridge, type WatchRoundState } from '@/services/watchBridge';
import { computeCompletedTotals } from '@/features/round/computeRoundTotals';
import { useSettingsStore } from '@/stores/settingsStore';

/**
 * Subscribe the watch to the current round. Activates WCSession on mount and
 * pushes a `WatchRoundState` snapshot whenever the underlying stores change.
 * Designed to live near the app root (above the router) so the watch keeps
 * its view in sync even when the user isn't on the hole-tracking screen.
 *
 * Push strategy: build a snapshot on every render and shallow-compare to the
 * last one we pushed. WCSession's `updateApplicationContext` coalesces queued
 * updates anyway, so we don't need to debounce aggressively — but skipping
 * no-op pushes avoids waking the watch's app for nothing.
 */
export function useWatchSync() {
  const active = useRoundStore((s) => s.active);
  const bag = useBagStore((s) => s.clubs);
  const selectedClubId = useWatchHintsStore((s) => s.selectedClubId);
  const recordingShot = useWatchHintsStore((s) => s.recordingShot);
  const atCourse = useWatchHintsStore((s) => s.atCourse);
  const autoTracking = useWatchHintsStore((s) => s.autoTracking);
  const lastShotSummary = useWatchHintsStore((s) => s.lastShotSummary);
  const liveSuggestedClubId = useWatchHintsStore((s) => s.liveSuggestedClubId);
  const liveOnGreen = useWatchHintsStore((s) => s.liveOnGreen);
  const shotDetection = useSettingsStore((s) => s.watchShotDetectionEnabled);

  // Layout query for the current hole — gives us the OSM par + centerline
  // distance for the distance-to-pin reading. Skips when there's no round.
  const currentHole = active?.holes[active.currentHoleIndex] ?? null;
  // useHoleLayout's signature requires holeNumber as a number; pass a sentinel
  // when no round is active so the hook returns `status: 'none'` cleanly.
  const layoutQuery = useHoleLayout(active?.courseId, currentHole?.holeNumber ?? 0);

  // ALL holes' OSM geometry for the course, fetched once. Lets the watch
  // snapshot include every hole's yardage + pin so the watch can navigate holes
  // locally (the phone's per-hole lazy layout query only covers the current
  // hole, and won't run while the phone is backgrounded).
  const holesMetaQuery = useQuery({
    queryKey: ['watch-holes-meta', active?.courseId],
    enabled: !!active?.courseId,
    staleTime: 1000 * 60 * 30,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('holes')
        .select('hole_number, par, centerline_distance_m, green_lat, green_lng, pin_lat, pin_lng')
        .eq('course_id', active!.courseId);
      if (error) throw error;
      const map: Record<number, HoleMeta> = {};
      for (const r of data ?? []) {
        map[r.hole_number as number] = {
          par: (r.par as number | null) ?? null,
          centerlineM: (r.centerline_distance_m as number | null) ?? null,
          greenLat: (r.green_lat as number | null) ?? null,
          greenLng: (r.green_lng as number | null) ?? null,
          pinLat: (r.pin_lat as number | null) ?? null,
          pinLng: (r.pin_lng as number | null) ?? null
        };
      }
      return map;
    }
  });

  // One-time WCSession activation. We don't gate on `active` — better to be
  // ready the moment a round starts than to negotiate the session mid-play.
  const activatedRef = useRef(false);
  useEffect(() => {
    if (activatedRef.current) return;
    activatedRef.current = true;
    watchBridge.activate().catch((err) => {
      console.warn('[watch-sync] activate failed', err);
    });
  }, []);

  // Build a fresh snapshot every render (cheap) and only ship if it diverges
  // from the previous one. JSON.stringify diff is fine here: payloads are
  // ~1KB and the comparison is microseconds vs. the cost of a watch wake.
  const lastSentRef = useRef<string>('');
  useEffect(() => {
    // Pin position for the current hole: per-round override wins over
    // the green centroid. Pushed to the watch so it can compute live
    // distance against its own GPS fix.
    const holeRow = layoutQuery.data?.hole;
    const pinLat = holeRow?.pin_lat ?? holeRow?.green_lat ?? null;
    const pinLng = holeRow?.pin_lng ?? holeRow?.green_lng ?? null;

    const snapshot = buildSnapshot({
      active,
      currentHole,
      osmPar: holeRow?.par ?? null,
      osmYards:
        holeRow?.centerline_distance_m != null
          ? Math.round(metersToYards(holeRow.centerline_distance_m))
          : null,
      bag,
      selectedClubId,
      recordingShot,
      shotDetection,
      atCourse,
      autoTracking,
      lastShotSummary,
      liveSuggestedClubId,
      liveOnGreen,
      holesMeta: holesMetaQuery.data ?? null,
      pinLat,
      pinLng
    });
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSentRef.current) return;
    lastSentRef.current = serialized;
    watchBridge.sendState(snapshot).catch((err) => {
      console.warn('[watch-sync] sendState failed', err);
    });
  }, [
    active,
    currentHole,
    layoutQuery.data,
    bag,
    selectedClubId,
    recordingShot,
    shotDetection,
    atCourse,
    autoTracking,
    lastShotSummary,
    liveSuggestedClubId,
    liveOnGreen,
    holesMetaQuery.data
  ]);
}

/** Per-hole OSM geometry the watch needs to navigate holes locally. */
interface HoleMeta {
  par: number | null;
  centerlineM: number | null;
  greenLat: number | null;
  greenLng: number | null;
  pinLat: number | null;
  pinLng: number | null;
}

interface SnapshotInputs {
  active: ReturnType<typeof useRoundStore.getState>['active'];
  currentHole: ReturnType<typeof useRoundStore.getState>['active'] extends infer A
    ? A extends { holes: Array<infer H> }
      ? H
      : null
    : null;
  osmPar: number | null;
  osmYards: number | null;
  bag: ReturnType<typeof useBagStore.getState>['clubs'];
  selectedClubId: string | null;
  recordingShot: boolean;
  shotDetection: boolean;
  atCourse: boolean | null;
  autoTracking: boolean;
  lastShotSummary: WatchRoundState['lastShotSummary'];
  /** Live-position club suggestion for the current hole (overrides the
   *  recorded-shot suggestion below when present). */
  liveSuggestedClubId: string | null;
  /** True when the phone's live GPS position is on the green polygon — flips
   *  the watch into putting mode even before the approach shot is committed. */
  liveOnGreen: boolean;
  holesMeta: Record<number, HoleMeta> | null;
  pinLat: number | null;
  pinLng: number | null;
}

function buildSnapshot({
  active,
  currentHole,
  osmPar,
  osmYards,
  bag,
  selectedClubId,
  recordingShot,
  shotDetection,
  atCourse,
  autoTracking,
  lastShotSummary,
  liveSuggestedClubId,
  liveOnGreen,
  holesMeta,
  pinLat,
  pinLng
}: SnapshotInputs): WatchRoundState {
  // Slim the bag down to what the watch UI actually renders. Computed up front
  // so it's available even with no active round — practice mode runs off-round
  // and the watch's club picker needs the bag regardless of round state.
  const slimBag = bag.map((c) => ({
    clubId: c.clubId,
    name: c.customName || c.name,
    isPutter: c.category === 'putter',
    typicalYards: c.typicalDistanceYards ?? null
  }));

  if (!active || !currentHole) {
    // No round: still push the bag so Watch Practice can select a club.
    return { active: false, bag: slimBag };
  }

  // Yards remaining: full hole yardage minus sum of recorded shot distances
  // along the playing line. Clamped to 0 so an over-walk doesn't go negative.
  const displayYards = currentHole.yardage ?? osmYards;
  const ballDistanceM = currentHole.shots.reduce((acc, s) => {
    if (s.distance == null) return acc;
    const yds = s.distanceUnit === 'feet' ? s.distance / 3 : s.distance;
    return acc + yds * 0.9144;
  }, 0);
  const ballDistanceYds = ballDistanceM / 0.9144;
  const distanceYards =
    displayYards != null ? Math.max(0, Math.round(displayYards - ballDistanceYds)) : null;

  // Round-wide par vs score, completed-holes-only so the watch matches
  // the phone's running Score pill. Shows "--" until the first hole is
  // finalized.
  const completedTotals = computeCompletedTotals(active);
  const watchScore =
    completedTotals.completedCount === 0
      ? '--'
      : scoreVsPar(completedTotals.score, completedTotals.par);

  // Putts on this hole — same heuristic the phone uses for the Score card.
  const puttsThisHole = currentHole.shots.filter((s) => s.targetType === 'putt').length;

  // Suggested club — mirrors the phone's recommender. Skipped when there's
  // no distance to work with or when the last shot landed on the green
  // (the phone hides the suggestion in that case too).
  const lastShot = currentHole.shots[currentHole.shots.length - 1];
  // Manual putter pick is the deliberate escape hatch for fringe/off-green
  // putts — mirrors the phone so picking the putter on the watch flips it into
  // putting mode even when the ball isn't tagged on the green.
  const userPickedPutter =
    selectedClubId != null &&
    bag.find((c) => c.clubId === selectedClubId)?.category === 'putter';
  // Strict "ball is on the putting surface" — mirrors the phone's `ballOnGreen`.
  // Deliberately excludes any near-green distance heuristic so it doesn't flip
  // to putting mode when the player is merely AROUND the green on a chip.
  // `liveOnGreen` is the phone's live GPS-on-green hit-test, which is what lets
  // putting mode engage under auto-track before the approach shot is committed.
  const ballOnGreen =
    lastShot?.lie === 'green' ||
    (lastShot?.targetType === 'green' && lastShot?.targetResult === 'hit') ||
    userPickedPutter ||
    liveOnGreen;
  // Hole is done once the last shot is a made putt. Used to drop putting mode
  // so the watch stops offering Missed / Made on a holed-out hole (mirrors the
  // phone's showPuttPanel, which is gated on !holeComplete).
  const holeComplete =
    lastShot?.targetType === 'putt' && lastShot?.targetResult === 'made';
  // On the green when the last shot stuck the green or was a putt (and the hole
  // isn't already holed out) — the watch uses this to show distance-to-pin in
  // feet rather than yards AND to swap in the Missed / Made putt controls.
  const onGreen = (ballOnGreen || lastShot?.targetType === 'putt') && !holeComplete;
  // Precise putt distance (feet) = the ball's resting spot (last shot end) → the
  // pin. Sent so the watch shows the same value the phone does instead of its
  // own noisier live GPS reading. Null off the green / without GPS or a pin.
  const distanceFeet =
    onGreen &&
    lastShot?.endLat != null &&
    lastShot?.endLng != null &&
    pinLat != null &&
    pinLng != null
      ? Math.round(
          haversineMeters(
            { lat: lastShot.endLat, lng: lastShot.endLng, accuracyM: 0, timestamp: 0 },
            { lat: pinLat, lng: pinLng, accuracyM: 0, timestamp: 0 }
          ) * 3.28084
        )
      : null;
  const suggested =
    distanceYards != null && distanceYards > 0 && !ballOnGreen
      ? recommendClub(bag, distanceYards, {
          excludeDriver: ballDistanceM > 0 && distanceYards > 200
        })
      : null;
  // The phone's live-position suggestion (from the player's current GPS → pin)
  // wins for the current hole so the watch's club hint updates as they walk up
  // to the ball. Suppressed on the green, where no club is suggested.
  const currentSuggestedClubId =
    !ballOnGreen && liveSuggestedClubId != null
      ? liveSuggestedClubId
      : (suggested?.clubId ?? null);

  // Per-hole array so the watch can navigate holes locally (and show tee
  // yardage + suggested club) without a phone roundtrip. Mirrors the
  // current-hole math above for EVERY hole, using the batch OSM meta for
  // yardage/pin that the per-hole lazy layout query doesn't cover off-screen.
  const holesPreview = active.holes.map((h) => {
    const meta = holesMeta?.[h.holeNumber];
    const fullYards =
      h.yardage ??
      (meta?.centerlineM != null ? Math.round(metersToYards(meta.centerlineM)) : null);
    const ballM = h.shots.reduce((acc, s) => {
      if (s.distance == null) return acc;
      const yds = s.distanceUnit === 'feet' ? s.distance / 3 : s.distance;
      return acc + yds * 0.9144;
    }, 0);
    const yardage =
      fullYards != null ? Math.max(0, Math.round(fullYards - ballM / 0.9144)) : null;
    const last = h.shots[h.shots.length - 1];
    const onGreen = last?.lie === 'green';
    const suggestedClub =
      yardage != null && yardage > 0 && !onGreen
        ? recommendClub(bag, yardage, { excludeDriver: ballM > 0 && yardage > 200 })
        : null;
    return {
      holeNumber: h.holeNumber,
      par: meta?.par ?? h.par ?? null,
      yardage,
      suggestedClubId: suggestedClub?.clubId ?? null,
      shots: h.shots.length,
      putts: h.shots.filter((s) => s.targetType === 'putt').length,
      pinLat: h.pinLat ?? meta?.pinLat ?? meta?.greenLat ?? null,
      pinLng: h.pinLng ?? meta?.pinLng ?? meta?.greenLng ?? null
    };
  });

  return {
    active: true,
    courseName: active.courseName,
    holeNumber: currentHole.holeNumber,
    holesPlayed: active.holesPlayed,
    par: osmPar ?? currentHole.par ?? null,
    distanceYards,
    // Precise putt distance in feet (last shot end → pin) when on the green;
    // null elsewhere so the watch shows live yards.
    distanceFeet,
    scoreVsPar: watchScore,
    shotsThisHole: currentHole.shots.length,
    puttsThisHole,
    suggestedClubId: currentSuggestedClubId,
    selectedClubId,
    recordingShot,
    shotDetection,
    onGreen,
    // Hole holed-out (last shot a made putt). The watch shows the prev/next
    // hole arrows only when this is true — hidden during active play.
    holeComplete,
    atCourse: atCourse ?? undefined,
    autoTracking,
    lastShotSummary: lastShotSummary ?? undefined,
    holes: holesPreview,
    pinLat,
    pinLng,
    bag: slimBag
  };
}
