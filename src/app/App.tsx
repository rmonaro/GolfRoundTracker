import { useMemo } from 'react';
import { CssBaseline, ThemeProvider } from '@mui/material';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { darkTheme, lightTheme } from '@/theme/theme';
import { useSettingsStore } from '@/stores/settingsStore';
import { AppRouter } from '@/router/AppRouter';
import { AuthProvider } from '@/features/auth/AuthProvider';
import { SessionHydrator } from '@/features/auth/SessionHydrator';
import { initMapbox } from '@/features/course/mapbox';
import { useWatchSync } from '@/features/watch/useWatchSync';
import { usePracticeWatchSync } from '@/features/practice/usePracticeWatchSync';

// Set the Mapbox access token once at bootstrap. No-op if VITE_MAPBOX_TOKEN
// is absent — the hole layout falls back to SVG rendering in that case.
initMapbox();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      gcTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
      retry: 1
    }
  }
});

// Headless side-effect component — hosts the watch-sync hook inside the React
// tree (it needs store hooks). No render output; lives next to SessionHydrator.
function WatchSyncMount() {
  useWatchSync();
  // Practice swing-feedback listeners — bound once at the root so swings are
  // ingested regardless of the active screen. Independent of the round sync.
  usePracticeWatchSync();
  return null;
}

export function App() {
  const mode = useSettingsStore((s) => s.themeMode);
  const theme = useMemo(() => (mode === 'light' ? lightTheme : darkTheme), [mode]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <QueryClientProvider client={queryClient}>
        <BrowserRouter>
          <AuthProvider>
            <SessionHydrator />
            <WatchSyncMount />
            <AppRouter />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
