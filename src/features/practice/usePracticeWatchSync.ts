import { useEffect, useRef } from 'react';
import { AppleWatchSwing } from '@/services/appleWatchSwing';
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
      // The phone owns end-of-session evaluation; a watch "End" just stops the
      // motion stream. We leave the session open on the phone so the user can
      // review + add shot results, then end it from the summary screen.
    })
      .then((h) => handles.push(h))
      .catch((err) => console.warn('[practice-sync] ended listener failed', err));

    return () => {
      handles.forEach((h) => h.remove());
    };
  }, []);
}
