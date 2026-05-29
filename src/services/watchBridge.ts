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
  /** Yards from ball to pin (full hole on shot 1, remaining on later shots). */
  distanceYards?: number | null;
  /** Feet from ball to pin when on/near the green. */
  distanceFeet?: number | null;
  /** "+1", "-2", "E" — the same string shown in the phone's Score pill. */
  scoreVsPar?: string;
  shotsThisHole?: number;
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
  | { type: 'navigateHole'; direction: 'prev' | 'next' };

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
    await Raw.sendState({ state });
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
