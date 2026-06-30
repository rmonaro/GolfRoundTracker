import { useCallback, useEffect, useRef, useState } from 'react';
import { haversineMeters, watchPosition, type GpsPoint } from '@/services/gpsService';

/**
 * Auto-track shot detection.
 *
 * Shot detection is WATCH-DRIVEN ONLY. The phone deliberately does NOT detect
 * shots from its own GPS movement ("walked then stopped") — that heuristic was
 * removed because it produced false positives (cart rides, walking to a
 * partner's ball) and the phone is often pocketed. The only auto-detection here
 * comes from the watch's confirmed ball-strikes (see the `lastImpact` effect).
 *
 * The continuous GPS watch this hook runs exists solely to keep `latestFix`
 * flowing so a watch strike can be geo-tagged onto the player's current
 * position. The always-on "you are here" dot is a separate watch owned by the
 * consuming page and is unaffected by this hook.
 *
 *   strike arrives → close prior in-flight shot (end = current fix),
 *                    open a new one → emit ShotDetected(source:'impact')
 */
export type AutoTrackState = 'idle' | 'armed';

/**
 * Minimum ball travel (metres) for a strike to close the in-flight shot as a
 * real shot. Two impacts landing within this of each other — a waggle, a
 * practice swing that crossed the impact threshold, a double-trigger, or
 * re-addressing the ball — would otherwise commit a phantom shot with ~0 yards.
 * Below this we treat the strike as noise: keep the original in-flight start
 * (don't corrupt it) and emit nothing. ~5 m ≈ 5.5 yds, well under any real
 * chip, so legitimate short shots still register.
 */
const MIN_SHOT_M = 5;

/**
 * Opaque per-shot metadata latched when a strike OPENS a shot and carried
 * through to when that shot is CLOSED. The hook never inspects it — it only
 * snapshots (via `captureShotMeta`) and hands it back on the emitted shot.
 * The consumer uses it to record the club the player was set to AT THE SWING,
 * not the (possibly different) club showing when the next strike commits it.
 */
export interface ShotMeta {
  clubId: string | null;
}

export interface ShotDetected {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  distanceM: number;
  /** Always 'impact' — shots are detected from watch strikes only. */
  source: 'impact';
  /**
   * Metadata latched when THIS shot's launch strike opened it (see ShotMeta).
   * Null when no `captureShotMeta` was provided or it returned null.
   */
  meta: ShotMeta | null;
}

export interface UseAutoTrackOptions {
  enabled: boolean;
  /** Initial ball position. If null, the first GPS fix becomes the ball. */
  initialBallPos?: { lat: number; lng: number } | null;
  /**
   * Newest confirmed ball-strike from the watch. A change in object identity
   * counts as a new strike; `impactId` is informational. Each strike closes
   * the in-flight shot (start = the PRIOR strike's spot, end = where you're
   * standing now) and opens a new one, but only while `impactPrimary` is true.
   */
  lastImpact?: { impactId: number; capturedAt: number } | null;
  /**
   * Impact-primary mode. When true, watch strikes drive detection and emitted
   * shots carry source:'impact' so the consumer auto-commits them. When false,
   * strikes are ignored (no auto-detection happens at all — the user records
   * shots manually via the Add Shot button). The consumer is responsible for
   * gating this on a live strike stream + the user's shot-detection setting.
   */
  impactPrimary?: boolean;
  /**
   * Snapshot metadata for the shot a strike is OPENING, evaluated at strike
   * time. The returned value travels with the in-flight shot and comes back on
   * `ShotDetected.meta` when the NEXT strike (or resolvePendingShot) closes it.
   * This is how the club latches to the swing rather than to the commit moment.
   */
  captureShotMeta?: () => ShotMeta | null;
  /** Fired when a shot is detected. */
  onShotDetected: (shot: ShotDetected) => void;
}

export interface UseAutoTrackResult {
  state: AutoTrackState;
  ballPos: { lat: number; lng: number } | null;
  latestFix: GpsPoint | null;
  /**
   * Mark the detected shot as confirmed. `newBallPos` defaults to the latest
   * GPS fix. Resets the anchor and returns to ARMED.
   */
  confirmShot: (newBallPos?: { lat: number; lng: number }) => void;
  /**
   * Dismiss the detected shot (false positive). Treats the current location as
   * the new ball anchor so the next detection starts fresh from here.
   */
  dismissShot: () => void;
  /** Manually reseed the ball anchor (e.g. after a manually-recorded shot). */
  setBallPos: (pos: { lat: number; lng: number }) => void;
  /**
   * Impact-primary: close the in-flight shot now and RETURN it (source:
   * 'impact'), clearing the in-flight state. Does NOT fire onShotDetected —
   * the caller commits it, so ordering stays under the caller's control (e.g.
   * commit the pending approach BEFORE a manual putt). `end` defaults to the
   * latest GPS fix. Returns null if nothing is in flight / no fix to land on.
   * Call on hole-out or right before a manual save.
   */
  resolvePendingShot: (end?: { lat: number; lng: number }) => ShotDetected | null;
  /** Impact-primary: drop the in-flight shot WITHOUT emitting it. */
  clearPendingShot: () => void;
  /** True while a strike has opened a shot that hasn't been closed yet. */
  hasPendingShot: () => boolean;
}

export function useAutoTrack(opts: UseAutoTrackOptions): UseAutoTrackResult {
  const {
    enabled,
    initialBallPos = null,
    lastImpact = null,
    impactPrimary = false,
    captureShotMeta,
    onShotDetected
  } = opts;

  const [state, setState] = useState<AutoTrackState>('idle');
  const [ballPos, setBallPosState] = useState<{ lat: number; lng: number } | null>(
    initialBallPos
  );
  const [latestFix, setLatestFix] = useState<GpsPoint | null>(null);

  // Refs let the GPS callback (long-lived closure) read up-to-date values
  // without re-binding the watch on every state change.
  const ballPosRef = useRef(ballPos);
  const stateRef = useRef<AutoTrackState>(state);
  const onShotDetectedRef = useRef(onShotDetected);
  const captureShotMetaRef = useRef(captureShotMeta);
  const impactPrimaryRef = useRef(impactPrimary);
  // Latest GPS fix, readable synchronously by the strike handler (which fires
  // off a prop change, not inside the GPS callback).
  const latestFixRef = useRef<GpsPoint | null>(null);
  // The in-flight shot's launch point (start). Set on each strike; its END
  // resolves on the NEXT strike — or via resolvePendingShot(). Null = nothing
  // currently in flight.
  const inFlightRef = useRef<{
    lat: number;
    lng: number;
    t: number;
    meta: ShotMeta | null;
  } | null>(null);

  useEffect(() => {
    impactPrimaryRef.current = impactPrimary;
  }, [impactPrimary]);
  useEffect(() => {
    captureShotMetaRef.current = captureShotMeta;
  }, [captureShotMeta]);
  useEffect(() => {
    ballPosRef.current = ballPos;
  }, [ballPos]);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    onShotDetectedRef.current = onShotDetected;
  }, [onShotDetected]);

  // A confirmed strike arrived from the watch. Object identity changes per
  // message, so this fires once per strike. In impact-primary mode the strike
  // closes the previous in-flight shot (its end = where you're standing now,
  // having walked to the ball) and opens a new one.
  useEffect(() => {
    if (!lastImpact) return;
    if (!impactPrimaryRef.current) return;
    const fix = latestFixRef.current;
    if (!fix) return; // no GPS to place the strike — skip this one
    const prev = inFlightRef.current;
    if (prev) {
      const distM = haversineMeters(
        { lat: prev.lat, lng: prev.lng, accuracyM: 0, timestamp: 0 },
        fix
      );
      // Strike landed essentially on top of the in-flight start — almost
      // certainly a waggle / practice swing / double-trigger, not a real shot.
      // Drop it WITHOUT moving the in-flight start, so the next real strike
      // still measures from the true launch point. This is what stops the
      // "extra shots to verify with ~0 yards" the auto-tracker was producing.
      if (distM < MIN_SHOT_M) return;
      onShotDetectedRef.current({
        startLat: prev.lat,
        startLng: prev.lng,
        endLat: fix.lat,
        endLng: fix.lng,
        distanceM: distM,
        source: 'impact',
        // Club latched when THIS shot was struck (its launch strike), not the
        // club showing now as the player stands over the next ball.
        meta: prev.meta
      });
    }
    // Open the next shot, latching the club the player is set to at THIS strike.
    inFlightRef.current = {
      lat: fix.lat,
      lng: fix.lng,
      t: Date.now(),
      meta: captureShotMetaRef.current?.() ?? null
    };
  }, [lastImpact]);

  // Resolve the in-flight shot immediately (hole-out, or right before a manual
  // save so the pending auto shot isn't dropped) and RETURN it for the caller
  // to commit — keeping ordering under the caller's control.
  const resolvePendingShot = useCallback(
    (end?: { lat: number; lng: number }): ShotDetected | null => {
      const prev = inFlightRef.current;
      if (!prev) return null;
      inFlightRef.current = null;
      const endPos =
        end ??
        (latestFixRef.current
          ? { lat: latestFixRef.current.lat, lng: latestFixRef.current.lng }
          : null);
      if (!endPos) return null; // nowhere to land it — drop silently
      const distM = haversineMeters(
        { lat: prev.lat, lng: prev.lng, accuracyM: 0, timestamp: 0 },
        { lat: endPos.lat, lng: endPos.lng, accuracyM: 0, timestamp: 0 }
      );
      return {
        startLat: prev.lat,
        startLng: prev.lng,
        endLat: endPos.lat,
        endLng: endPos.lng,
        distanceM: distM,
        source: 'impact',
        // Carry the club latched when this (now hole-out / flushed) shot opened.
        meta: prev.meta
      };
    },
    []
  );

  const clearPendingShot = useCallback(() => {
    inFlightRef.current = null;
  }, []);

  const hasPendingShot = useCallback(() => inFlightRef.current != null, []);

  const transition = useCallback((next: AutoTrackState) => {
    stateRef.current = next;
    setState(next);
  }, []);

  const setBallPos = useCallback(
    (pos: { lat: number; lng: number }) => {
      ballPosRef.current = pos;
      setBallPosState(pos);
      // Re-arm whenever the anchor moves. Without this, an external
      // ball-pos update (e.g., after a manual shot save) would leave the
      // state machine stuck from a prior state.
      transition('armed');
    },
    [transition]
  );

  const confirmShot = useCallback(
    (newBallPos?: { lat: number; lng: number }) => {
      const next =
        newBallPos ??
        (latestFix ? { lat: latestFix.lat, lng: latestFix.lng } : ballPosRef.current);
      if (next) setBallPos(next);
      transition('armed');
    },
    [latestFix, setBallPos, transition]
  );

  const dismissShot = useCallback(() => {
    // Dismissing means "that wasn't a shot, I'm just here now" — reset the
    // anchor to the current spot so the next detection starts clean.
    confirmShot();
  }, [confirmShot]);

  useEffect(() => {
    if (!enabled) {
      transition('idle');
      return;
    }

    // Entering enabled mode: armed if we have a ball, idle waiting for the
    // first fix otherwise.
    transition(ballPosRef.current ? 'armed' : 'idle');

    const unsubscribe = watchPosition((fix) => {
      setLatestFix(fix);
      latestFixRef.current = fix;

      // The phone does NOT auto-detect shots from GPS movement — detection is
      // watch-driven only (see the lastImpact effect). This watch exists solely
      // to keep latestFix flowing so the watch's strikes can be geo-tagged onto
      // the player's current position. Bootstrap the ball anchor from the first
      // fix as a sensible default.
      if (!ballPosRef.current) {
        const init = { lat: fix.lat, lng: fix.lng };
        ballPosRef.current = init;
        setBallPosState(init);
        transition('armed');
      }
    });

    return unsubscribe;
  }, [enabled, transition]);

  return {
    state,
    ballPos,
    latestFix,
    confirmShot,
    dismissShot,
    setBallPos,
    resolvePendingShot,
    clearPendingShot,
    hasPendingShot
  };
}
