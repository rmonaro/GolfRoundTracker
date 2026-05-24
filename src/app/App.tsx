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
            <AppRouter />
          </AuthProvider>
        </BrowserRouter>
      </QueryClientProvider>
    </ThemeProvider>
  );
}
