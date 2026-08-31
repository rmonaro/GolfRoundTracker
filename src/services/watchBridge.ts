import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * Snapshot of round state pushed phone → watch. Kept narrow on purpose —
 * the watch only needs what it can sensibly render on a 1.7" screen, and
 * smaller payloads coalesce / deliver faster.
 */
export interface WatchRoundState {
  /** Null when no round is active — watch shows the "no round" view. */
  active: boolean;
  /** Course the round is on. The watch keys its cached hole geometry on this,
   *  so it can tell "I already have this course's map" from "this is a course
   *  I've never received" without guessing from the name. */
  courseId?: string | null;
  courseName?: string;
  holeNumber?: number;
  holesPlayed?: number;
  par?: number | null;
  /** Yards from ball to pin (full hole on shot 1, remaining on later shots).
   *  Fallback for when the watch can't get its own GPS fix. */
  distanceYards?: number | null;
  /** Feet from ball to pin when on/near the green. */
  distanceFeet?: number | null;
  /** Pin position for the current hole — lets the watch compute a live
   *  distance-to-pin using its own GPS rather than waiting on phone
   *  snapshots. Falls back to green centroid when no per-round pin
   *  override is set; null when the course isn't OSM-synced. */
  pinLat?: number | null;
  pinLng?: number | null;
  /** "+1", "-2", "E" — the same string shown in the phone's Score pill. */
  scoreVsPar?: string;
  shotsThisHole?: number;
  /** Number of putts already taken on the current hole. */
  puttsThisHole?: number;
  /** Club the phone's recommender would suggest for the remaining yardage. */
  suggestedClubId?: string | null;
  /** Currently-selected club on the phone (overrides suggestion if set). */
  selectedClubId?: string | null;
  /**
   * True when the phone has its record-shot sheet open or a pending landing
   * point staged. Switches the watch into "recording" mode showing just the
   * selected club big with tap-to-change.
   */
  recordingShot?: boolean;
  /**
   * Whether the user has Apple Watch shot detection enabled (settings). The
   * watch reads this on round-active and starts/stops its motion-based strike
   * detector accordingly — gating it here (rather than always-on) keeps watch
   * battery in the user's control. Absent → watch treats it as enabled.
   */
  shotDetection?: boolean;
  /**
   * True when the ball is on/around the green (current hole) — so the watch
   * shows its live distance-to-pin in FEET instead of yards, matching the phone.
   */
  onGreen?: boolean;
  /**
   * True once the hole is holed out (last shot a made putt). The watch shows the
   * prev/next hole navigation arrows ONLY when this is true — they're hidden
   * during active play so the player can't skip a hole mid-round.
   */
  holeComplete?: boolean;
  /**
   * Whether the user is within range of the course (mirrors the phone's 2 km
   * at-course gate). Absent → treat as at-course (don't block). False → the
   * watch hides its Track / Add Shot controls and shows a "not in range" note,
   * the same way the phone refuses to start tracking off-course.
   */
  atCourse?: boolean;
  /**
   * Current phone-side auto-track state. Lets the watch Track button render as a
   * synced toggle and reflect reality even when the phone's at-course gate
   * refused to start tracking.
   */
  autoTracking?: boolean;
  /**
   * Transient summary of the most-recently auto-recorded shot (watch Track-off
   * or Add Shot), for the watch's brief post-save overview. `id` increments per
   * shot so the watch shows each summary exactly once. Null when there's nothing
   * fresh to show.
   */
  lastShotSummary?: {
    id: number;
    clubName: string;
    /** Human label for the inferred outcome, e.g. "Fairway", "Left", "Green". */
    result: string;
    /** Preformatted distance, e.g. "212 yds" / "14 ft". */
    distanceText: string;
  } | null;
  /**
   * Every hole's headline data, so the watch can navigate holes LOCALLY and
   * show the tee yardage + suggested club immediately — without waiting on a
   * phone roundtrip that's blocked when the phone is backgrounded (JS suspended).
   * Sent on every snapshot; it only changes as shots are recorded.
   */
  holes?: Array<{
    holeNumber: number;
    par?: number | null;
    /** Yards remaining to the pin — the full hole on an un-played hole. */
    yardage?: number | null;
    /** Recommender's club id for that yardage (computed phone-side). */
    suggestedClubId?: string | null;
    /** Shots / putts logged on this hole (so a previewed hole's counts match). */
    shots?: number;
    putts?: number;
    pinLat?: number | null;
    pinLng?: number | null;
    /**
     * Where each recorded shot on this hole FINISHED, in play order — the watch
     * draws them as small numbered dots on its course map and joins them into a
     * `shotProgressPath`. Only shots that actually carry GPS appear; the watch
     * is never asked to invent a position for one that doesn't.
     *
     * Explicit `lat`/`lng` keys, not a pair, because the phone stores GeoJSON
     * `[lng, lat]` and the watch builds `CLLocationCoordinate2D(latitude:...)` —
     * naming them is what keeps that conversion honest.
     */
    shotPoints?: Array<{ lat: number; lng: number }>;
  }>;
  /**
   * User's "course map on the watch" setting. False → the watch keeps its
   * existing plain background and skips MapKit entirely (no imagery fetches,
   * no polygon tessellation, no camera work). Absent → treated as enabled.
   */
  courseMapEnabled?: boolean;
  /** Ask the watch for satellite imagery rather than the standard base map.
   *  watchOS may still render Standard regardless — see the watch-side note. */
  mapSatellite?: boolean;
  /**
   * What happened to this course's geometry transfer: `sent` | `queued` |
   * `noGeometry` | `retry:<reason>` | `failed:<reason>`. Purely diagnostic —
   * the watch surfaces it in DEBUG so an absent map can name its cause instead
   * of being indistinguishable from every other reason it might be absent.
   */
  courseMapStatus?: string | null;
  /**
   * Geometry for the hole currently being played, serialized, delivered on the
   * state channel rather than as a queued transfer. Redundant with the per-hole
   * transfer by design — see the note in `useWatchSync`: this is the delivery
   * route that is known to work, so the hole the golfer is standing on draws
   * even when the bulk transfer never arrives.
   */
  holeGeometry?: string | null;
  /** Hole number `holeGeometry` describes, so the watch can skip re-decoding
   *  a hole it already holds. */
  holeGeometryHole?: number | null;
  /**
   * Slim club list the watch can render. Putters land in their own bucket on
   * the watch UI so we mark them; everything else is just name + (optional)
   * typical-distance hint for inline display.
   */
  bag?: Array<{
    clubId: string;
    name: string;
    isPutter: boolean;
    typicalYards?: number | null;
  }>;
}

/** Discriminated union of messages the watch can send back to the phone. */
export type WatchInboundMessage =
  | {
      type: 'recordShot';
      clubId: string | null;
      targetType: 'fairway' | 'green' | 'putt';
      targetResult: 'hit' | 'left' | 'right' | 'short' | 'long' | 'made' | 'missed';
      /** Optional GPS pair captured by the watch's own Core Location. */
      startLat?: number | null;
      startLng?: number | null;
      endLat?: number | null;
      endLng?: number | null;
      /** Putt distance (feet to flag) the watch user saw / nudged. GPS can't
       *  measure a putt, so for putts this is the authoritative distance. */
      distanceFeet?: number | null;
    }
  | { type: 'navigateHole'; direction: 'prev' | 'next' }
  | {
      /** Watch user tapped "Set flag here" while standing at the flag. Carries
       *  the watch's current GPS; the phone moves the current hole's pin to it
       *  (same shared-course pin the phone's Move Pin button updates). */
      type: 'setPin';
      lat: number;
      lng: number;
    }
  | {
      /** Watch toggled round-wide auto-tracking. The phone enables/disables its
       *  own auto-track (respecting the 2 km at-course gate) and echoes the
       *  resulting state back via the snapshot's `autoTracking`. */
      type: 'setAutoTrack';
      active: boolean;
    }
  | {
      /** Watch wants to log a shot at the user's current GPS position — either
       *  Track-off "I'm at my ball" or the Add Shot button. The phone fills the
       *  start from the hole's prior ball position, infers fairway/left/right
       *  from the end against the course geometry, auto-saves (unverified, like
       *  the phone's own auto-track), and returns a summary via the snapshot's
       *  `lastShotSummary`. No club/result picker is involved. */
      type: 'autoShot';
      clubId: string | null;
      startLat?: number | null;
      startLng?: number | null;
      endLat?: number | null;
      endLng?: number | null;
    }
  | {
      /** Watch user tapped the Track button — start position captured.
       *  active=true on tap; active=false when ended/cancelled.
       *  currentLat/Lng are also sent on periodic position updates
       *  while tracking is active so the phone map can show a live
       *  "you are here" dot for the watch user. */
      type: 'trackingShot';
      active: boolean;
      startLat?: number | null;
      startLng?: number | null;
      currentLat?: number | null;
      currentLng?: number | null;
    }
  | {
      /** Watch user picked a club from the home-view picker, NOT as
       *  part of recording a shot — the phone's `selectedClubId` should
       *  flip to this club so subsequent suggestions / shot defaults
       *  pick up the change. */
      type: 'selectClub';
      clubId: string;
    }
  | {
      /** A confirmed ball-strike detected by the watch's round-mode motion
       *  detector (real impact spike, NOT an air/practice swing). Phase 1
       *  shot-detection gating: the phone's auto-track only treats a
       *  "walked then stopped" pattern as a shot when one of these arrived
       *  since the ball was last anchored — killing false positives like
       *  cart rides. `impactId` is monotonic within a watch round session;
       *  `capturedAt` is the watch clock (epoch ms) and is NOT trusted for
       *  recency (the phone uses arrival time). `swingType`/`handSpeed`
       *  are advisory; startLat/Lng are the watch's best fix at impact, if
       *  any. */
      type: 'roundImpact';
      impactId: number;
      capturedAt: number;
      swingType?: string;
      handSpeed?: number;
      // Full motion-metric bundle (migration 031). Round mode now forwards the
      // same rich SwingMetrics the watch computes in practice, latched onto the
      // shot this strike opens. All optional — older watch builds omit them.
      backswingTimeMs?: number;
      downswingTimeMs?: number;
      tempoRatio?: number;
      transitionScore?: number;
      wristRotationScore?: number;
      finishStabilityScore?: number;
      planeAxis?: number[];
      backswingRotation?: number;
      releaseTimingScore?: number;
      decelerationScore?: number;
      transitionDirectionScore?: number;
      addressGravity?: number[];
      heartRate?: number;
      /** The club the watch had in hand at the strike (its displayed / selected
       *  club — which may be a live GPS suggestion or a watch-side manual pick
       *  the phone never saw). The phone latches THIS on the impact-opened shot
       *  so the recorded club matches what the player saw on the watch, instead
       *  of the phone's own selection (which it resets to null after each shot). */
      clubId?: string | null;
      startLat?: number | null;
      startLng?: number | null;
      /** Horizontal accuracy (metres) of the fix in startLat/startLng, and the
       *  epoch-ms timestamp of when that fix was actually taken. Both let the
       *  phone judge how good the watch's position is instead of trusting it
       *  blindly — a 28 m fix from 9 seconds ago is worse than the phone's own
       *  6 m fix from just now, and preferring it put shots on the wrong side
       *  of the green. Absent on older watch builds. */
      startAccuracyM?: number | null;
      startFixAt?: number | null;
    }
  // --- Practice-mode swing feedback (motion-based) -----------------------
  | { type: 'practiceStarted'; sessionId: string; clubId: string | null }
  | { type: 'practiceClubSelected'; sessionId: string; clubId: string }
  | {
      type: 'practiceEnded';
      sessionId: string;
      swingCount: number;
      // Optional health summary from the watch workout session.
      avgHeartRate?: number;
      maxHeartRate?: number;
      minHeartRate?: number;
      hrvSdnn?: number;
      activeCalories?: number;
      durationSeconds?: number;
    }
  | {
      /** One detected swing's motion metrics. All values are relative /
       *  estimated — NOT launch-monitor measurements. The phone applies
       *  the rules engine and persists to `swing_metrics`. */
      type: 'swingDetected';
      sessionId: string;
      swingIndex: number;
      clubId: string | null;
      capturedAt: number; // epoch seconds (watch clock)
      backswingTimeMs: number;
      downswingTimeMs: number;
      tempoRatio: number;
      transitionScore: number;
      estimatedHandSpeed: number;
      wristRotationScore: number;
      finishStabilityScore: number;
      planeAxis: number[];
      // Derived (Phase 1)
      swingType?: string;
      isAirSwing?: boolean;
      backswingRotation?: number;
      releaseTimingScore?: number;
      decelerationScore?: number;
      transitionDirectionScore?: number;
      addressGravity?: number[];
      heartRate?: number;
    };

interface WatchBridgeRawPlugin {
  activate(): Promise<{
    supported: boolean;
    activationState?: number;
    isPaired?: boolean;
    isWatchAppInstalled?: boolean;
    isReachable?: boolean;
  }>;
  isReachable(): Promise<{ reachable: boolean }>;
  sendState(args: { state: WatchRoundState }): Promise<void>;
  sendCourseMapHole(args: {
    courseId: string;
    courseName: string;
    v: number;
    total: number;
    /** One serialized hole of a `WatchCourseMap`. A JSON string rather than an
     *  object so the payload crossing both the Capacitor bridge and
     *  WatchConnectivity is a single plist-safe scalar. */
    json: string;
  }): Promise<{ sent: boolean; reason?: string; bytes?: number }>;
  launchWatch(args: { startPractice: boolean }): Promise<{ launched: boolean; reason?: string }>;
  endWatchPractice(): Promise<{ sent: boolean }>;
  addListener(
    eventName: 'messageFromWatch',
    listener: (event: { message: Record<string, unknown>; delivery: 'live' | 'queued' }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'reachabilityChanged',
    listener: (event: { reachable: boolean }) => void
  ): Promise<PluginListenerHandle>;
  addListener(
    eventName: 'activationDidComplete',
    listener: (event: { activationState: number; error: string | null }) => void
  ): Promise<PluginListenerHandle>;
}

const Raw = registerPlugin<WatchBridgeRawPlugin>('WatchBridge');

/**
 * Recursively drop keys whose values are null or undefined. WatchConnectivity
 * rejects any payload containing NSNull, so we filter before crossing the
 * bridge. Arrays are mapped through (their cleaned elements are kept even
 * if a sibling key was dropped); plain objects have null/undefined fields
 * removed. Non-object scalars pass through untouched.
 */
function stripNulls<T>(value: T): T {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) {
    return value.map((v) => stripNulls(v)) as unknown as T;
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === null || v === undefined) continue;
      out[k] = stripNulls(v);
    }
    return out as unknown as T;
  }
  return value;
}

/**
 * Web/Android no-op fallback. Lets the same code paths run in browser dev
 * without crashing — calls resolve as if there's no watch present.
 */
const isIOSNative = Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'ios';

export const watchBridge = {
  /** Activate the WCSession. Safe to call multiple times. */
  async activate() {
    if (!isIOSNative) return { supported: false } as const;
    return Raw.activate();
  },

  async isReachable(): Promise<boolean> {
    if (!isIOSNative) return false;
    const { reachable } = await Raw.isReachable();
    return reachable;
  },

  /**
   * Launch the paired Apple Watch app via HealthKit's startWatchApp (the only
   * iOS-sanctioned way to launch the watch app). Pass `startPractice: true` to
   * have the watch open straight into a practice session; omit it for a round
   * launch (the watch then shows the round from its synced state).
   * Best-effort — resolves `{ launched: false }` off-iOS or on failure.
   */
  async launchWatch(startPractice = false): Promise<{ launched: boolean; reason?: string }> {
    if (!isIOSNative) return { launched: false };
    try {
      return await Raw.launchWatch({ startPractice });
    } catch (err) {
      return { launched: false, reason: err instanceof Error ? err.message : 'failed' };
    }
  },

  /**
   * Tell the watch to end its active practice session (phone-initiated end of
   * a range / practice session). The watch finalizes and echoes `practiceEnded`
   * back, which the phone handles idempotently. Best-effort — no-op off iOS.
   */
  async endWatchPractice(): Promise<void> {
    if (!isIOSNative) return;
    try {
      await Raw.endWatchPractice();
    } catch (err) {
      console.warn('[watch] endWatchPractice failed', err);
    }
  },

  /** Push the latest round snapshot to the watch (latest-wins coalescing). */
  async sendState(state: WatchRoundState) {
    if (!isIOSNative) return;
    // WCSession.updateApplicationContext rejects payloads containing
    // unsupported types — and JS `null` bridges to Swift `NSNull`, which
    // counts as unsupported. Strip null/undefined recursively so the
    // watch sees missing keys (which its dict decoder already handles
    // via `dict["x"] as? T` returning nil).
    const cleaned = stripNulls(state) as WatchRoundState;
    await Raw.sendState({ state: cleaned });
  },

  /**
   * Ship the course's hole geometry to the watch so it can draw the hole behind
   * the on-course screen without the phone.
   *
   * Sent HOLE BY HOLE over `transferUserInfo`. The first implementation sent the
   * whole course as one `transferFile`; the phone queued it successfully and the
   * watch never received it — reproducibly between paired simulators, and with
   * no way to confirm delivery on device. `transferUserInfo` is the queued,
   * guaranteed, FIFO channel this app already moves every watch→phone shot over,
   * and one hole per message keeps each payload small enough that size is never
   * the question. FIFO ordering also means the watch can draw hole 1 while the
   * back nine is still in flight, instead of waiting for an all-or-nothing
   * document.
   *
   * Not an application context: that channel is latest-wins live state, and
   * re-sending every polygon on each yardage tick would be pure waste. This is
   * one-shot reference data — the watch persists it and re-reads it on later
   * launches, so it's normally sent once per course, ever.
   */
  async sendCourseMap(
    courseId: string,
    map: unknown
  ): Promise<{ sent: boolean; reason?: string; bytes?: number }> {
    if (!isIOSNative) return { sent: false, reason: 'notNative' };
    const course = map as {
      v?: number;
      courseName?: string | null;
      holes?: unknown[];
    };
    const holes = course.holes ?? [];
    if (holes.length === 0) return { sent: false, reason: 'noHoles' };
    let bytes = 0;
    try {
      for (const hole of holes) {
        const json = JSON.stringify(hole);
        bytes += json.length;
        const res = await Raw.sendCourseMapHole({
          courseId,
          courseName: course.courseName ?? '',
          v: course.v ?? 1,
          total: holes.length,
          json
        });
        // Stop at the first refusal rather than queueing 17 more messages that
        // will meet the same wall; the caller retries the whole course.
        if (!res?.sent) return { sent: false, reason: res?.reason ?? 'failed', bytes };
      }
      return { sent: true, bytes };
    } catch (err) {
      const reason = err instanceof Error ? err.message : 'failed';
      console.warn('[watch] sendCourseMap failed', err);
      return { sent: false, reason, bytes };
    }
  },

  /**
   * Listen for messages from the watch. Returns a handle — call `.remove()`
   * to unsubscribe. The raw plugin emits both live `sendMessage` and queued
   * `transferUserInfo` deliveries through the same event; we parse the
   * payload here so consumers get a typed union back.
   */
  async onMessage(
    cb: (msg: WatchInboundMessage, delivery: 'live' | 'queued') => void
  ): Promise<PluginListenerHandle> {
    if (!isIOSNative) return { remove: async () => undefined } as PluginListenerHandle;
    return Raw.addListener('messageFromWatch', (event) => {
      const parsed = event.message as WatchInboundMessage | { type?: string };
      if (!parsed || typeof parsed !== 'object' || !('type' in parsed) || !parsed.type) return;
      cb(parsed as WatchInboundMessage, event.delivery);
    });
  },

  async onReachabilityChanged(
    cb: (reachable: boolean) => void
  ): Promise<PluginListenerHandle> {
    if (!isIOSNative) return { remove: async () => undefined } as PluginListenerHandle;
    return Raw.addListener('reachabilityChanged', (event) => cb(event.reachable));
  }
};
