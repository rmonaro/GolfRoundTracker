import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type ThemeMode = 'dark' | 'light';

interface SettingsState {
  themeMode: ThemeMode;
  watchModeEnabled: boolean;
  setThemeMode: (m: ThemeMode) => void;
  toggleTheme: () => void;
  setWatchMode: (v: boolean) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      themeMode: 'dark',
      watchModeEnabled: false,
      setThemeMode: (themeMode) => set({ themeMode }),
      toggleTheme: () =>
        set((s) => ({ themeMode: s.themeMode === 'dark' ? 'light' : 'dark' })),
      setWatchMode: (watchModeEnabled) => set({ watchModeEnabled })
    }),
    { name: 'grt-settings' }
  )
);
