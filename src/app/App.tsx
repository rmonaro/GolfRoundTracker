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
import { initConnectivity, isUsablyOnline } from '@/services/connectivity';
import { initPmtilesProvider } from '@/features/course/pmtilesSetup';
import { useWatchSync } from '@/features/watch/useWatchSync';
import { usePracticeWatchSync } from '@/features/practice/usePracticeWatchSync';
import { useSyncScheduler } from '@/features/offline/useSyncScheduler';
import { useClaimMarkerRounds } from '@/features/tournaments/useClaimMarkerRounds';

// Set the Mapbox access token once at bootstrap. No-op if VITE_MAPBOX_TOKEN
// is absent — the hole layout falls back to SVG rendering in that case.
initMapbox();

// Teach Mapbox to read our own PMTiles imagery packs. Must run before any map
// is created, and deliberately uses a provider bundled with the app rather than
// Mapbox's CDN-hosted one, which would need network at exactly the wrong moment.
initPmtilesProvider();

// Bind network listeners once. Everything offline-aware reads from here, so it
// must be live before the first query runs.
initConnectivity();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 30,
      gcTime: 1000 * 60 * 5,
      refetchOnWindowFocus: false,
      // One retry when the network is worth another try — none when we already
      // know it isn't. A blind retry offline just doubles every spinner, since
      // each attempt has to burn the full request deadline before it gives up.
      retry: (failureCount: number) => failureCount < 1 && isUsablyOnline()
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
  // Drains the offline sync outbox on reconnect / resume / retry.
  useSyncScheduler();
  // Attaches any tournament rounds a scorekeeper recorded for this user before
  // they had an account. Once per session, and a no-op for almost everyone.
  useClaimMarkerRounds();
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
