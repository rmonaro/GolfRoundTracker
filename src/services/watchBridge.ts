import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

/**
 * Snapshot of round state pushed phone → watch. Kept narrow on purpose —
 * the watch only needs what it can sensibly render on a 1.7" screen, and
 * smaller payloads coalesce / deliver faster.
 */
export interface WatchRoundState {
  /** Null when no round is active — watch shows the "no round" view. */
  active: boolean;
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
    }
  | { type: 'navigateHole'; direction: 'prev' | 'next' }
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
      startLat?: number | null;
      startLng?: number | null;
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
  launchWatch(args: { startPractice: boolean }): Promise<{ launched: boolean; reason?: string }>;
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
