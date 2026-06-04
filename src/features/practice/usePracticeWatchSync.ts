import { useEffect, useRef } from 'react';
import { AppleWatchSwing } from '@/services/appleWatchSwing';
import { useRoundStore } from '@/stores/roundStore';
import { useSwingSessionStore } from '@/stores/swingSessionStore';
import { practiceController } from './practiceController';

/**
 * Binds the watch swing/practice listeners exactly once and routes events to
 * the practice controller. Mount near the app root (alongside WatchSyncMount)
 * so swings are captured no matter which screen the user is on.
 *
 * Because the listeners persist swings, this MUST be a singleton mount —
 * mounting it from individual pages would double-ingest.
 */
export function usePracticeWatchSync() {
  const bound = useRef(false);
  const roundActive = useRoundStore((s) => s.active != null);

  // Mutual exclusivity (phone side): if a round starts while a practice session
  // is still active (e.g. the user started practice from the phone), finalize
  // the practice session. Mirrors the watch-side teardown in GolfWatchApp.
  useEffect(() => {
    if (roundActive && useSwingSessionStore.getState().session) {
      void practiceController.end();
    }
  }, [roundActive]);

  useEffect(() => {
    if (bound.current) return;
    bound.current = true;

    const handles: Array<{ remove: () => void }> = [];

    AppleWatchSwing.addListener('swingDetected', (swing) => {
      void practiceController.ingestSwing(swing);
    })
      .then((h) => handles.push(h))
      .catch((err) => console.warn('[practice-sync] swing listener failed', err));

    AppleWatchSwing.onPracticeStarted((e) => {
      practiceController.onWatchPracticeStarted(e.sessionId, e.clubId);
    })
      .then((h) => handles.push(h))
      .catch((err) => console.warn('[practice-sync] started listener failed', err));

    AppleWatchSwing.onClubSelected((e) => {
      practiceController.onWatchClubSelected(e.clubId);
    })
      .then((h) => handles.push(h))
      .catch((err) => console.warn('[practice-sync] club listener failed', err));

    AppleWatchSwing.onPracticeEnded(() => {
      // Ending on the watch finalizes the phone session: compute rollups +
      // baseline feedback and write `ended_at`. Without this the session stays
      // "in progress" forever. Safe no-op if there's no active session.
      void practiceController.end();
    })
      .then((h) => handles.push(h))
      .catch((err) => console.warn('[practice-sync] ended listener failed', err));

    return () => {
      handles.forEach((h) => h.remove());
    };
  }, []);
}
