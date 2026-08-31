import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ThemeMode = 'dark' | 'light';

interface SettingsState {
  themeMode: ThemeMode;
  watchModeEnabled: boolean;
  /**
   * V2 GPS opt-in. Defaults to false so existing users aren't prompted for
   * location until they explicitly enable it. When false: the Track FAB on
   * the hole-tracking screen is hidden, at-course detection is skipped, and
   * we never request location permission.
   */
  gpsEnabled: boolean;
  /**
   * Apple Watch shot detection (Phase 1 auto-track gating). When on, the watch
   * runs its motion-based strike detector during a round and a GPS-detected
   * shot is only confirmed if a real club strike preceded it — cutting false
   * positives (cart rides, walking to a partner's ball). Costs watch battery
   * (runs a workout session), so it's a toggle. Defaults on; harmless when no
   * watch is paired (the phone simply never receives strikes).
   */
  watchShotDetectionEnabled: boolean;
  /**
   * Draw the current hole as a satellite map behind the watch's on-course
   * screen. On by default. Turning it off keeps every yardage, control and the
   * shot detector exactly as they are — the watch just skips MapKit, which
   * saves the imagery fetches and per-frame polygon rendering on a device that
   * has to last 18 holes.
   */
  watchCourseMapEnabled: boolean;
  /**
   * Ask for satellite imagery on the watch map rather than the standard base
   * map.
   *
   * OFF by default, because on current watchOS it does nothing: Apple documents
   * that watchOS may render the Standard style even when Imagery is requested,
   * and testing on a physical Apple Watch confirms it always does — its own Maps
   * app offers no satellite view either.
   *
   * The toggle is kept rather than removed because the watch-side overlay
   * opacities key off it, and because a future watchOS that honours the request
   * would need only this flipped. Leaving it ON today is actively worse: the
   * overlays thin themselves out to let a photograph show through, and then no
   * photograph arrives.
   */
  watchMapSatellite: boolean;
  /**
   * One-time guided tour of the round (hole-tracking) screen. Defaults to
   * false; the first time a user opens the round screen the walkthrough auto-
   * runs, then this flips true so it never auto-opens again. The in-app help
   * button can replay it on demand regardless of this flag.
   */
  roundTourCompleted: boolean;
  setThemeMode: (m: ThemeMode) => void;
  toggleTheme: () => void;
  setWatchMode: (v: boolean) => void;
  setGpsEnabled: (v: boolean) => void;
  setWatchShotDetection: (v: boolean) => void;
  setWatchCourseMap: (v: boolean) => void;
  setWatchMapSatellite: (v: boolean) => void;
  setRoundTourCompleted: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'dark',
      watchModeEnabled: false,
      gpsEnabled: false,
      watchShotDetectionEnabled: true,
      watchCourseMapEnabled: true,
      watchMapSatellite: false,
      roundTourCompleted: false,
      setThemeMode: (themeMode) => set({ themeMode }),
      toggleTheme: () =>
        set((s) => ({ themeMode: s.themeMode === 'dark' ? 'light' : 'dark' })),
      setWatchMode: (watchModeEnabled) => set({ watchModeEnabled }),
      setGpsEnabled: (gpsEnabled) => set({ gpsEnabled }),
      setWatchShotDetection: (watchShotDetectionEnabled) =>
        set({ watchShotDetectionEnabled }),
      setWatchCourseMap: (watchCourseMapEnabled) => set({ watchCourseMapEnabled }),
      setWatchMapSatellite: (watchMapSatellite) => set({ watchMapSatellite }),
      setRoundTourCompleted: (roundTourCompleted) => set({ roundTourCompleted })
    }),
    { name: 'grt-settings' }
  )
);
