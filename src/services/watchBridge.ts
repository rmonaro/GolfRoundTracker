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
  // --- Practice-mode swing feedback (motion-based) -----------------------
  | { type: 'practiceStarted'; sessionId: string; clubId: string | null }
  | { type: 'practiceClubSelected'; sessionId: string; clubId: string }
  | { type: 'practiceEnded'; sessionId: string; swingCount: number }
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
