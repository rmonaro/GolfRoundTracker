import { useEffect, useRef } from 'react';
import { useRoundStore } from '@/stores/roundStore';
import { useBagStore } from '@/stores/bagStore';
import { useWatchHintsStore } from '@/stores/watchHintsStore';
import { useHoleLayout } from '@/features/course/useHoleLayout';
import { metersToYards } from '@/features/course/distance';
import { scoreVsPar } from '@/utils/format';
import { recommendClub } from '@/features/course/HoleLayout';
import { watchBridge, type WatchRoundState } from '@/services/watchBridge';
import { computeCompletedTotals } from '@/features/round/computeRoundTotals';

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

  // Layout query for the current hole — gives us the OSM par + centerline
  // distance for the distance-to-pin reading. Skips when there's no round.
  const currentHole = active?.holes[active.currentHoleIndex] ?? null;
  // useHoleLayout's signature requires holeNumber as a number; pass a sentinel
  // when no round is active so the hook returns `status: 'none'` cleanly.
  const layoutQuery = useHoleLayout(active?.courseId, currentHole?.holeNumber ?? 0);

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
    const snapshot = buildSnapshot({
      active,
      currentHole,
      osmPar: layoutQuery.data?.hole.par ?? null,
      osmYards:
        layoutQuery.data?.hole.centerline_distance_m != null
          ? Math.round(metersToYards(layoutQuery.data.hole.centerline_distance_m))
          : null,
      bag,
      selectedClubId,
      recordingShot
    });
    const serialized = JSON.stringify(snapshot);
    if (serialized === lastSentRef.current) return;
    lastSentRef.current = serialized;
    watchBridge.sendState(snapshot).catch((err) => {
      console.warn('[watch-sync] sendState failed', err);
    });
  }, [active, currentHole, layoutQuery.data, bag, selectedClubId, recordingShot]);
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
}

function buildSnapshot({
  active,
  currentHole,
  osmPar,
  osmYards,
  bag,
  selectedClubId,
  recordingShot
}: SnapshotInputs): WatchRoundState {
  if (!active || !currentHole) {
    return { active: false };
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

  // Slim the bag down to what the watch UI actually renders.
  const slimBag = bag.map((c) => ({
    clubId: c.clubId,
    name: c.customName || c.name,
    isPutter: c.category === 'putter',
    typicalYards: c.typicalDistanceYards ?? null
  }));

  // Putts on this hole — same heuristic the phone uses for the Score card.
  const puttsThisHole = currentHole.shots.filter((s) => s.targetType === 'putt').length;

  // Suggested club — mirrors the phone's recommender. Skipped when there's
  // no distance to work with or when the last shot landed on the green
  // (the phone hides the suggestion in that case too).
  const lastShot = currentHole.shots[currentHole.shots.length - 1];
  const ballOnGreen = lastShot?.lie === 'green';
  const suggested =
    distanceYards != null && distanceYards > 0 && !ballOnGreen
      ? recommendClub(bag, distanceYards, {
          excludeDriver: ballDistanceM > 0 && distanceYards > 200
        })
      : null;

  return {
    active: true,
    courseName: active.courseName,
    holeNumber: currentHole.holeNumber,
    holesPlayed: active.holesPlayed,
    par: osmPar ?? currentHole.par ?? null,
    distanceYards,
    // distanceFeet only makes sense on/near the green; we leave it for the
    // watch app to compute or omit. (Phone-side logic relies on lastShot GPS
    // which isn't always populated.)
    distanceFeet: null,
    scoreVsPar: watchScore,
    shotsThisHole: currentHole.shots.length,
    puttsThisHole,
    suggestedClubId: suggested?.clubId ?? null,
    selectedClubId,
    recordingShot,
    bag: slimBag
  };
}
