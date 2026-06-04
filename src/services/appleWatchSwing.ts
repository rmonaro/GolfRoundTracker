import type { PluginListenerHandle } from '@capacitor/core';
import { watchBridge, type WatchInboundMessage } from './watchBridge';
import type { PracticeHealthSummary, SwingDetectedPayload } from '@/types/swing';

/**
 * Thin facade over the existing `WatchBridge` plugin that exposes a swing-
 * focused listener API:
 *
 *   AppleWatchSwing.addListener('swingDetected', (swing) => { ... });
 *
 * Swing events ride the *same* native `messageFromWatch` event that already
 * carries round messages (recordShot, navigateHole, …). We bind once, demux
 * by `type`, and fan the swing/practice events out to registered listeners.
 * Round-message types are ignored here, so the round flow is unaffected.
 */

type SwingListener = (swing: SwingDetectedPayload) => void;
type PracticeStartedListener = (e: { sessionId: string; clubId: string | null }) => void;
type PracticeEndedListener = (
  e: { sessionId: string; swingCount: number; health: PracticeHealthSummary }
) => void;
type ClubSelectedListener = (e: { sessionId: string; clubId: string }) => void;

const swingListeners = new Set<SwingListener>();
const startedListeners = new Set<PracticeStartedListener>();
const endedListeners = new Set<PracticeEndedListener>();
const clubListeners = new Set<ClubSelectedListener>();

let bindPromise: Promise<void> | null = null;

function dispatch(msg: WatchInboundMessage) {
  switch (msg.type) {
    case 'swingDetected':
      swingListeners.forEach((l) =>
        l({
          sessionId: msg.sessionId,
          swingIndex: msg.swingIndex,
          clubId: msg.clubId,
          capturedAt: msg.capturedAt,
          backswingTimeMs: msg.backswingTimeMs,
          downswingTimeMs: msg.downswingTimeMs,
          tempoRatio: msg.tempoRatio,
          transitionScore: msg.transitionScore,
          estimatedHandSpeed: msg.estimatedHandSpeed,
          wristRotationScore: msg.wristRotationScore,
          finishStabilityScore: msg.finishStabilityScore,
          planeAxis: msg.planeAxis ?? [],
          swingType: (msg.swingType as SwingDetectedPayload['swingType']) ?? null,
          isAirSwing: msg.isAirSwing ?? false,
          backswingRotation: msg.backswingRotation ?? null,
          releaseTimingScore: msg.releaseTimingScore ?? null,
          decelerationScore: msg.decelerationScore ?? null,
          transitionDirectionScore: msg.transitionDirectionScore ?? null,
          addressGravity: msg.addressGravity ?? [],
          heartRate: msg.heartRate ?? null
        })
      );
      break;
    case 'practiceStarted':
      startedListeners.forEach((l) => l({ sessionId: msg.sessionId, clubId: msg.clubId }));
      break;
    case 'practiceEnded':
      endedListeners.forEach((l) =>
        l({
          sessionId: msg.sessionId,
          swingCount: msg.swingCount,
          health: {
            avgHeartRate: msg.avgHeartRate,
            maxHeartRate: msg.maxHeartRate,
            minHeartRate: msg.minHeartRate,
            hrvSdnn: msg.hrvSdnn,
            activeCalories: msg.activeCalories,
            durationSeconds: msg.durationSeconds
          }
        })
      );
      break;
    case 'practiceClubSelected':
      clubListeners.forEach((l) => l({ sessionId: msg.sessionId, clubId: msg.clubId }));
      break;
    default:
      // Round-flow message — not ours. Ignore.
      break;
  }
}

async function ensureBound(): Promise<void> {
  if (!bindPromise) {
    bindPromise = watchBridge
      .onMessage((msg) => dispatch(msg))
      .then(() => undefined)
      .catch((err) => {
        // Reset so a later listener can retry the bind.
        bindPromise = null;
        throw err;
      });
  }
  return bindPromise;
}

function makeHandle<T>(set: Set<T>, listener: T): PluginListenerHandle {
  set.add(listener);
  return { remove: async () => { set.delete(listener); } } as PluginListenerHandle;
}

export const AppleWatchSwing = {
  /** Listen for completed swings detected on the watch. */
  async addListener(
    event: 'swingDetected',
    cb: SwingListener
  ): Promise<PluginListenerHandle> {
    await ensureBound();
    void event;
    return makeHandle(swingListeners, cb);
  },

  async onPracticeStarted(cb: PracticeStartedListener): Promise<PluginListenerHandle> {
    await ensureBound();
    return makeHandle(startedListeners, cb);
  },

  async onPracticeEnded(cb: PracticeEndedListener): Promise<PluginListenerHandle> {
    await ensureBound();
    return makeHandle(endedListeners, cb);
  },

  async onClubSelected(cb: ClubSelectedListener): Promise<PluginListenerHandle> {
    await ensureBound();
    return makeHandle(clubListeners, cb);
  }
};
