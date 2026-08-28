import { useCallback, useEffect, useState } from 'react';
import { ensureGpsPermission, getCurrentPosition, isGpsAvailable } from '@/services/gpsService';
import { useSettingsStore } from '@/stores/settingsStore';

/**
 * `off`         — the user hasn't opted into GPS (settings). We do NOT ask.
 * `unavailable` — no geolocation in this context at all (insecure origin etc).
 * `locating`    — a fix is in flight.
 * `ready`       — `origin` holds a usable position.
 * `denied`      — permission refused, or the fix failed/timed out.
 */
export type CourseLocationStatus = 'off' | 'unavailable' | 'locating' | 'ready' | 'denied';

export interface CourseLocation {
  status: CourseLocationStatus;
  origin: { lat: number; lng: number } | null;
  /** Opt into GPS and fetch immediately — for the picker's inline prompt. */
  enableAndLocate: () => void;
  /** Re-fetch after a denial or a slow first attempt. */
  retry: () => void;
}

/**
 * One-shot location for sorting the course picker by distance.
 *
 * Gated on the app's `gpsEnabled` setting, which exists precisely so the app
 * never requests location until the user asks for it — so with it off this
 * reports `off` and asks for nothing. The picker surfaces that as a one-tap
 * prompt rather than silently showing an unsorted list.
 *
 * A coarse fix is plenty here: the answer is "which course am I nearest",
 * measured in miles, so a cached 60s-old reading beats making the golfer wait
 * for a high-accuracy lock.
 */
export function useCourseLocation(): CourseLocation {
  const gpsEnabled = useSettingsStore((s) => s.gpsEnabled);
  const setGpsEnabled = useSettingsStore((s) => s.setGpsEnabled);
  const [status, setStatus] = useState<CourseLocationStatus>('off');
  const [origin, setOrigin] = useState<{ lat: number; lng: number } | null>(null);
  /** Bumped by retry/enable to re-run the effect below. */
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!gpsEnabled) {
      setStatus('off');
      return;
    }
    if (!isGpsAvailable()) {
      setStatus('unavailable');
      return;
    }
    let cancelled = false;
    setStatus('locating');
    (async () => {
      try {
        await ensureGpsPermission();
        const fix = await getCurrentPosition({
          // Distance-to-course is a miles-scale question; a coarse, possibly
          // cached fix answers it instantly instead of holding the list back
          // for a satellite lock.
          enableHighAccuracy: false,
          timeout: 8_000,
          maximumAge: 60_000
        });
        if (cancelled) return;
        setOrigin({ lat: fix.lat, lng: fix.lng });
        setStatus('ready');
      } catch {
        if (cancelled) return;
        // Denied, timed out, or no fix — same outcome for the picker: it falls
        // back to alphabetical and offers a retry.
        setStatus('denied');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [gpsEnabled, attempt]);

  const enableAndLocate = useCallback(() => {
    setGpsEnabled(true);
    setAttempt((n) => n + 1);
  }, [setGpsEnabled]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);

  return { status, origin, enableAndLocate, retry };
}
