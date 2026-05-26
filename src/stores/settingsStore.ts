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
  setThemeMode: (m: ThemeMode) => void;
  toggleTheme: () => void;
  setWatchMode: (v: boolean) => void;
  setGpsEnabled: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'dark',
      watchModeEnabled: false,
      gpsEnabled: false,
      setThemeMode: (themeMode) => set({ themeMode }),
      toggleTheme: () =>
        set((s) => ({ themeMode: s.themeMode === 'dark' ? 'light' : 'dark' })),
      setWatchMode: (watchModeEnabled) => set({ watchModeEnabled }),
      setGpsEnabled: (gpsEnabled) => set({ gpsEnabled })
    }),
    { name: 'grt-settings' }
  )
);
