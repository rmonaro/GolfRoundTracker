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
  setThemeMode: (m: ThemeMode) => void;
  toggleTheme: () => void;
  setWatchMode: (v: boolean) => void;
  setGpsEnabled: (v: boolean) => void;
  setWatchShotDetection: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'dark',
      watchModeEnabled: false,
      gpsEnabled: false,
      watchShotDetectionEnabled: true,
      setThemeMode: (themeMode) => set({ themeMode }),
      toggleTheme: () =>
        set((s) => ({ themeMode: s.themeMode === 'dark' ? 'light' : 'dark' })),
      setWatchMode: (watchModeEnabled) => set({ watchModeEnabled }),
      setGpsEnabled: (gpsEnabled) => set({ gpsEnabled }),
      setWatchShotDetection: (watchShotDetectionEnabled) =>
        set({ watchShotDetectionEnabled })
    }),
    { name: 'grt-settings' }
  )
);
