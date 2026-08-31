import { useEffect, useRef, useState } from 'react';
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
import { isUsablyOnline } from '@/services/connectivity';
import { getCachedCourse } from '@/services/courseCacheRepo';
import { buildWatchCourseMap, type WatchCourseMap } from '@/services/watchCourseMap';

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
  const courseMapEnabled = useSettingsStore((s) => s.watchCourseMapEnabled);
  const mapSatellite = useSettingsStore((s) => s.watchMapSatellite);

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
      // `enabled` guarantees this, but narrow it explicitly — courseId is
      // nullable on the round, and the cache lookup is strict about it.
      const courseId = active?.courseId;
      if (!courseId) return {} as Record<number, HoleMeta>;

      const toMeta = (
        rows: Array<Record<string, unknown>>
      ): Record<number, HoleMeta> => {
        const map: Record<number, HoleMeta> = {};
        for (const r of rows) {
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
      };

      // Offline: the downloaded course carries full hole rows, which is a
      // superset of the columns selected below. Without this the watch loses
      // every distance the moment the phone drops signal — even though the
      // watch computes distances from its OWN GPS and only needs these coords.
      if (!isUsablyOnline()) {
        const cached = await getCachedCourse(courseId);
        if (cached) return toMeta(cached.holes as unknown as Array<Record<string, unknown>>);
      }

      const { data, error } = await supabase
        .from('holes')
        .select('hole_number, par, centerline_distance_m, green_lat, green_lng, pin_lat, pin_lng')
        .eq('course_id', courseId);
      if (error) throw error;
      return toMeta((data ?? []) as Array<Record<string, unknown>>);
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

  // Ship the course's hole geometry to the watch ONCE per course, so the watch
  // can draw the hole behind its on-course screen on its own.
  //
  // Deliberately not part of the snapshot: this is bulk reference data, not
  // live state. It goes out as a queued file transfer (see
  // `watchBridge.sendCourseMap`), which means it survives the phone being
  // killed and lands whenever the watch is next reachable — so a golfer who
  // starts a round in the car park has the map by the first tee even if the
  // watch was asleep at the moment we sent it.
  //
  // Fires on courseId, not on every round: the geometry for a course doesn't
  // change between rounds, and the watch keeps its own on-disk copy.
  const sentCourseMapRef = useRef<string | null>(null);
  // What happened to the course-map transfer, mirrored to the watch so a
  // missing map can say WHY instead of just being absent.
  const [courseMapStatus, setCourseMapStatus] = useState<string | null>(null);
  // The built course, kept so the CURRENT hole's geometry can ride along on the
  // ordinary state snapshot.
  //
  // Belt-and-braces on top of the per-hole transfer, because two separate
  // queued-delivery APIs (`transferFile`, then `transferUserInfo`) were accepted
  // by the phone and never arrived on the watch, while `updateApplicationContext`
  // — the channel every yardage on that screen already rides — worked
  // throughout. Sending the hole you are standing on over the proven channel
  // means the map is correct for the hole that matters even if the bulk
  // transfer never lands. The bulk transfer is still what gives all 18 holes
  // offline and survives a phone that's switched off.
  const [builtCourseMap, setBuiltCourseMap] = useState<WatchCourseMap | null>(null);
  const courseId = active?.courseId ?? null;
  useEffect(() => {
    if (!courseMapEnabled) return;
    if (!courseId) return;
    if (sentCourseMapRef.current === courseId) return;
    sentCourseMapRef.current = courseId;
    setBuiltCourseMap((prev) => (prev?.courseId === courseId ? prev : null));
    let cancelled = false;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;

    // Retry rather than give up on a failure.
    //
    // The original code reset the ref on failure and assumed "something will
    // re-run this" — nothing does: the effect's only deps are courseId and the
    // setting, neither of which changes again during a round. So a single
    // transient failure meant the geometry was never sent at all, for the whole
    // round. Attempts are bounded and spaced, because the failures worth
    // retrying (WCSession still activating, watch app not yet installed) all
    // resolve within seconds, and the ones that don't (course has no geometry)
    // are not retried at all.
    const attempt = async (remaining: number) => {
      try {
        const map = await buildWatchCourseMap(courseId);
        if (cancelled) return;
        if (map) setBuiltCourseMap(map);
        if (!map) {
          // Nothing to send — this course has no synced geometry. Not a
          // failure, and retrying would never produce a different answer.
          setCourseMapStatus('noGeometry');
          return;
        }
        const res = await watchBridge.sendCourseMap(courseId, map);
        if (cancelled) return;
        if (res.sent) {
          // Keep the native reason verbatim — it carries the WCSession state
          // (activation / paired / installed / reachable), which is the only
          // thing that distinguishes "handed to WatchConnectivity" from "still
          // sitting in our own queue". Collapsing them made those two look
          // identical on the watch and hid exactly the bug that was happening.
          setCourseMapStatus(res.reason ?? 'sent');
          return;
        }
        setCourseMapStatus(`retry:${res.reason ?? 'failed'}`);
        if (remaining > 0) {
          retryTimer = setTimeout(() => void attempt(remaining - 1), 4000);
        } else {
          setCourseMapStatus(`failed:${res.reason ?? 'unknown'}`);
          sentCourseMapRef.current = null;
        }
      } catch (err) {
        console.warn('[watch-sync] course map send failed', err);
        if (cancelled) return;
        if (remaining > 0) {
          retryTimer = setTimeout(() => void attempt(remaining - 1), 4000);
        } else {
          setCourseMapStatus('failed:build');
          sentCourseMapRef.current = null;
        }
      }
    };
    void attempt(3);

    return () => {
      cancelled = true;
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [courseId, courseMapEnabled]);

  // Build a fresh snapshot every render (cheap) and only ship if it diverges
  // from the previous one. JSON.stringify diff is fine here: payloads are
  // ~1KB and the comparison is microseconds vs. the cost of a watch wake.
  const lastSentRef = useRef<string>('');
  useEffect(() => {
    // Pin position for the current hole. Pushed to the watch so it can compute
    // live distance against its own GPS fix.
    //
    // Precedence mirrors HoleTrackingPage's `pinLatEff`: a flag moved during
    // THIS round wins, then the shared course pin, then the green centroid.
    // The round-local value is written synchronously when the flag is moved
    // (from either the phone or the watch's "Set flag here"), so the watch's
    // putt distance follows the flag on the very next push instead of waiting
    // on — or missing entirely — the layout refetch.
    const holeRow = layoutQuery.data?.hole;
    const pinLat =
      currentHole?.pinLat ?? holeRow?.pin_lat ?? holeRow?.green_lat ?? null;
    const pinLng =
      currentHole?.pinLng ?? holeRow?.pin_lng ?? holeRow?.green_lng ?? null;

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
      pinLng,
      courseMapEnabled,
      courseMapStatus,
      builtCourseMap,
      mapSatellite
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
    holesMetaQuery.data,
    courseMapEnabled,
    courseMapStatus,
    builtCourseMap,
    mapSatellite
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
  /** User setting — mirrored so the watch can skip MapKit entirely when off. */
  courseMapEnabled: boolean;
  /** Outcome of the course-map transfer, so a watch with no map can say why. */
  courseMapStatus: string | null;
  /** Full course geometry, when it has been built for this round. */
  builtCourseMap: WatchCourseMap | null;
  /** Ask the watch for satellite imagery rather than the standard base map. */
  mapSatellite: boolean;
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
  pinLng,
  courseMapEnabled,
  courseMapStatus,
  builtCourseMap,
  mapSatellite
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

  // Geometry for the hole in play, picked out of the course we already built
  // for the bulk transfer — no extra work, just a different delivery route.
  const currentHoleGeometry =
    courseMapEnabled && builtCourseMap?.courseId === active.courseId
      ? builtCourseMap.holes.find((h) => h.n === currentHole.holeNumber) ?? null
      : null;

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
      // The CURRENT hole takes the fully-resolved pin computed above. The watch
      // reads its distances off this per-hole array in preference to the
      // top-level pin, and `holesMeta` is a 30-minute-cached batch query — so
      // without this a flag moved mid-round left the watch measuring to the old
      // pin (or the green centroid) until that cache expired.
      pinLat:
        h.holeNumber === currentHole.holeNumber
          ? pinLat
          : h.pinLat ?? meta?.pinLat ?? meta?.greenLat ?? null,
      pinLng:
        h.holeNumber === currentHole.holeNumber
          ? pinLng
          : h.pinLng ?? meta?.pinLng ?? meta?.greenLng ?? null,
      // Landing positions for this hole's recorded shots, in play order, so the
      // watch map can dot them and join them into a shot-progress line. Shots
      // with no GPS are simply absent — the watch is never handed a made-up
      // position (which is also why this can be shorter than `shots`).
      shotPoints: h.shots
        .filter((s) => s.endLat != null && s.endLng != null)
        .map((s) => ({ lat: s.endLat as number, lng: s.endLng as number }))
    };
  });

  return {
    active: true,
    courseId: active.courseId ?? null,
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
    courseMapEnabled,
    mapSatellite,
    courseMapStatus,
    // Geometry for the hole being played, on the state channel. Only the
    // current hole: the whole course would be re-sent on every yardage tick,
    // and one hole is a few KB against an application-context budget of ~256 KB.
    // `holeGeometryHole` lets the watch skip re-decoding a hole it already has.
    holeGeometryHole: currentHoleGeometry?.n ?? null,
    holeGeometry: currentHoleGeometry ? JSON.stringify(currentHoleGeometry) : null,
    bag: slimBag
  };
}
