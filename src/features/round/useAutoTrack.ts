import { useCallback, useEffect, useRef, useState } from 'react';
import { haversineMeters, watchPosition, type GpsPoint } from '@/services/gpsService';

/**
 * Auto-track shot detection state machine.
 *
 * No motion sensors required — works purely from continuous GPS. The model:
 * the user is either standing at the ball (ARMED), walking away (MOVING), or
 * has arrived at a new resting spot (ARRIVED → emit "shot detected"). The
 * watch-position loop drives the transitions; the user confirms or dismisses
 * each detected shot via the consuming UI.
 *
 *   IDLE  → tap enabled              → ARMED (capture ball pos from first fix)
 *   ARMED → fix > moveThresholdM     → MOVING
 *   MOVING → recent fixes cluster
 *            (≤ stationaryRadiusM
 *            over stationaryWindowS) → ARRIVED  (emit ShotDetected)
 *   ARRIVED → confirm/dismiss        → ARMED   (ball pos = new location)
 */
export type AutoTrackState = 'idle' | 'armed' | 'moving' | 'arrived';

export interface ShotDetected {
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  distanceM: number;
  /**
   * How this shot was detected:
   *   'gps'    — Phase 1 walked-then-stopped (consumer opens the confirm sheet)
   *   'impact' — Phase 2 a watch strike closed the in-flight shot (auto-commit)
   */
  source: 'gps' | 'impact';
}

export interface UseAutoTrackOptions {
  enabled: boolean;
  /** Initial ball position. If null, the first GPS fix becomes the ball. */
  initialBallPos?: { lat: number; lng: number } | null;
  /** Distance threshold to transition ARMED → MOVING (meters). Default 10. */
  moveThresholdM?: number;
  /** Cluster radius for stationary detection (meters). Default 5. */
  stationaryRadiusM?: number;
  /** Stationary window length (seconds). Default 8. */
  stationaryWindowS?: number;
  /**
   * Newest confirmed ball-strike from the watch (Phase 1 impact gating).
   * When the watch is streaming these, a detected "walked then stopped" shot
   * is only emitted if a strike arrived since the last anchor — killing false
   * positives (cart rides, walking to a partner's ball). When no impacts ever
   * arrive (no watch / not worn / dropped link), the gate self-disables and
   * the pure-GPS behavior is unchanged. A change in object identity counts as
   * a new strike; `impactId` is informational.
   */
  lastImpact?: { impactId: number; capturedAt: number } | null;
  /**
   * Master switch for the impact gate, wired to the user's "watch shot
   * detection" setting. When false the gate is bypassed entirely (pure GPS),
   * so turning the setting off mid-round relaxes detection immediately instead
   * of waiting out the stale window. Default true.
   */
  impactGateEnabled?: boolean;
  /**
   * How long (ms) after the last received strike the impact stream is still
   * considered "live" for gating. Past this, the gate relaxes back to pure
   * GPS so a dropped watch link can't strand detection. Default 12 minutes.
   */
  impactGateStaleMs?: number;
  /**
   * Phase 2 impact-primary mode. When true, watch strikes drive detection:
   * each strike closes the in-flight shot (start = the PRIOR strike's spot,
   * end = where you're standing now) and the GPS walked-then-stopped emitter
   * is suppressed to avoid double-counting. Emitted shots carry source:
   * 'impact' so the consumer auto-commits them. Off → Phase 1 behavior.
   *
   * Only enable when strikes are actually LIVE — with this on and no strikes
   * arriving, nothing is detected (GPS emission is suppressed). The consumer
   * is responsible for gating this on a live strike stream.
   */
  impactPrimary?: boolean;
  /** Fired when a shot is detected. */
  onShotDetected: (shot: ShotDetected) => void;
}

export interface UseAutoTrackResult {
  state: AutoTrackState;
  ballPos: { lat: number; lng: number } | null;
  latestFix: GpsPoint | null;
  /**
   * Mark the detected shot as confirmed. `newBallPos` defaults to the latest
   * GPS fix (the resting spot that triggered ARRIVED). Resets buffer and
   * returns to ARMED.
   */
  confirmShot: (newBallPos?: { lat: number; lng: number }) => void;
  /**
   * Dismiss the detected shot (false positive — cart ride, looking for a
   * lost ball, etc.). Treats the current location as the new ball anchor
   * so the next detection starts fresh from here.
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
    moveThresholdM = 10,
    stationaryRadiusM = 5,
    stationaryWindowS = 8,
    lastImpact = null,
    impactGateEnabled = true,
    impactGateStaleMs = 12 * 60 * 1000,
    impactPrimary = false,
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
  const bufferRef = useRef<GpsPoint[]>([]);
  // --- Phase 1 impact gate ---
  // True once a confirmed strike has arrived since we last anchored at the
  // ball; reset on every re-anchor (confirm/dismiss/external ball move).
  const impactSinceAnchorRef = useRef(false);
  // Phone-clock arrival time of the most recent strike. Drives the
  // "stream live" check — we deliberately use arrival time, not the watch's
  // capturedAt, to sidestep cross-device clock skew.
  const lastImpactAtRef = useRef<number | null>(null);
  // --- Phase 2 impact-primary ---
  const impactPrimaryRef = useRef(impactPrimary);
  // Latest GPS fix, readable synchronously by the strike handler (which fires
  // off a prop change, not inside the GPS callback).
  const latestFixRef = useRef<GpsPoint | null>(null);
  // The in-flight shot's launch point (start). Set on each strike; its END
  // resolves on the NEXT strike — or via resolvePendingShot(). Null = nothing
  // currently in flight.
  const inFlightRef = useRef<{ lat: number; lng: number; t: number } | null>(null);

  useEffect(() => {
    impactPrimaryRef.current = impactPrimary;
  }, [impactPrimary]);
  useEffect(() => {
    ballPosRef.current = ballPos;
  }, [ballPos]);
  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    onShotDetectedRef.current = onShotDetected;
  }, [onShotDetected]);

  // A confirmed strike arrived from the watch — mark it against the current
  // anchor and stamp the phone-side arrival time. Object identity changes per
  // message, so this fires once per strike.
  useEffect(() => {
    if (!lastImpact) return;
    impactSinceAnchorRef.current = true;
    lastImpactAtRef.current = Date.now();

    // Phase 2: a strike closes the previous in-flight shot (its end = where
    // you're standing now, having walked to the ball) and opens a new one.
    if (!impactPrimaryRef.current) return;
    const fix = latestFixRef.current;
    if (!fix) return; // no GPS to place the strike — skip this one
    const prev = inFlightRef.current;
    if (prev) {
      const distM = haversineMeters(
        { lat: prev.lat, lng: prev.lng, accuracyM: 0, timestamp: 0 },
        fix
      );
      onShotDetectedRef.current({
        startLat: prev.lat,
        startLng: prev.lng,
        endLat: fix.lat,
        endLng: fix.lng,
        distanceM: distM,
        source: 'impact'
      });
    }
    inFlightRef.current = { lat: fix.lat, lng: fix.lng, t: Date.now() };
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
        source: 'impact'
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
      bufferRef.current = [];
      // New anchor → the next detection must be backed by its OWN strike.
      impactSinceAnchorRef.current = false;
      // Re-arm whenever the anchor moves. Without this, an external
      // ball-pos update (e.g., after a manual shot save) would leave the
      // state machine stuck in 'arrived' from the prior detection.
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
      bufferRef.current = [];
      return;
    }

    // Entering enabled mode: armed if we have a ball, idle waiting for the
    // first fix otherwise.
    transition(ballPosRef.current ? 'armed' : 'idle');

    const unsubscribe = watchPosition((fix) => {
      setLatestFix(fix);
      latestFixRef.current = fix;

      // Impact-primary mode drives detection from strikes, not GPS arrival.
      // Keep the live fix flowing (for the map dot + strike geo-tagging) but
      // skip the walked-then-stopped state machine entirely.
      if (impactPrimaryRef.current) return;

      // Bootstrap ball position from the first fix when we don't have one.
      if (!ballPosRef.current) {
        const init = { lat: fix.lat, lng: fix.lng };
        ballPosRef.current = init;
        setBallPosState(init);
        transition('armed');
        return;
      }

      const distFromBallM = haversineMeters(
        {
          lat: ballPosRef.current.lat,
          lng: ballPosRef.current.lng,
          accuracyM: 0,
          timestamp: 0
        },
        fix
      );

      if (stateRef.current === 'armed') {
        if (distFromBallM > moveThresholdM) {
          bufferRef.current = [fix];
          transition('moving');
        }
        return;
      }

      if (stateRef.current === 'moving') {
        // Sliding window of recent fixes within the stationary detection
        // window. We compute "stationary" as: spread between any two fixes
        // in the window is ≤ stationaryRadiusM.
        const cutoffMs = Date.now() - stationaryWindowS * 1000;
        bufferRef.current = [...bufferRef.current, fix].filter(
          (f) => f.timestamp >= cutoffMs
        );

        // Need to actually span the window before deciding the user is
        // stationary; otherwise a single fix at the new spot would fire.
        const oldest = bufferRef.current[0];
        if (!oldest) return;
        const spanMs = fix.timestamp - oldest.timestamp;
        if (spanMs < stationaryWindowS * 1000) return;

        let maxSpread = 0;
        const buf = bufferRef.current;
        for (let i = 0; i < buf.length; i++) {
          for (let j = i + 1; j < buf.length; j++) {
            const d = haversineMeters(buf[i], buf[j]);
            if (d > maxSpread) maxSpread = d;
          }
        }
        if (maxSpread > stationaryRadiusM) return;

        // Also require that the resting spot is actually away from the ball,
        // so a walk-out-and-back doesn't register as a shot.
        if (distFromBallM <= moveThresholdM) return;

        // Phase 1 impact gate. When the watch's strike stream is LIVE (a
        // confirmed strike arrived recently), only treat this as a shot if a
        // real ball-strike happened since we anchored at the ball — that's
        // what filters out cart rides / walking to a partner's ball. The gate
        // self-disables when no strikes are arriving (no watch / dropped
        // link), so pure-GPS detection is completely unaffected.
        const streamLive =
          lastImpactAtRef.current != null &&
          Date.now() - lastImpactAtRef.current < impactGateStaleMs;
        if (impactGateEnabled && streamLive && !impactSinceAnchorRef.current) return;

        // ARRIVED — emit detection. Stay in this state until the consumer
        // calls confirmShot / dismissShot.
        const ball = ballPosRef.current;
        transition('arrived');
        onShotDetectedRef.current({
          startLat: ball.lat,
          startLng: ball.lng,
          endLat: fix.lat,
          endLng: fix.lng,
          distanceM: distFromBallM,
          source: 'gps'
        });
      }
      // ARRIVED: ignore further fixes; waiting for user action.
    });

    return unsubscribe;
  }, [
    enabled,
    moveThresholdM,
    stationaryRadiusM,
    stationaryWindowS,
    impactGateEnabled,
    impactGateStaleMs,
    transition
  ]);

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
