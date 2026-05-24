import { createTheme, type ThemeOptions } from '@mui/material/styles';

const greenBrand = {
  50: '#E8F5E9',
  100: '#C8E6C9',
  200: '#A5D6A7',
  300: '#81C784',
  400: '#66BB6A',
  500: '#4CAF50',
  600: '#43A047',
  700: '#388E3C',
  800: '#2E7D32',
  900: '#1B5E20'
};

const sharedOptions: ThemeOptions = {
  shape: { borderRadius: 16 },
  typography: {
    fontFamily:
      "'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
    h1: { fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontWeight: 700, letterSpacing: '-0.02em' },
    h3: { fontWeight: 700, letterSpacing: '-0.02em' },
    h4: { fontWeight: 700, letterSpacing: '-0.01em' },
    h5: { fontWeight: 600 },
    h6: { fontWeight: 600 },
    button: { fontWeight: 600, textTransform: 'none', letterSpacing: '-0.01em' },
    body1: { fontSize: '1rem' },
    body2: { fontSize: '0.9rem' }
  },
  components: {
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: {
          minHeight: 48,
          borderRadius: 14,
          fontSize: '1rem',
          paddingInline: 18
        },
        sizeLarge: { minHeight: 60, fontSize: '1.1rem' }
      }
    },
    MuiIconButton: {
      styleOverrides: { root: { borderRadius: 12 } }
    },
    MuiCard: {
      styleOverrides: {
        root: { borderRadius: 20, backgroundImage: 'none' }
      }
    },
    MuiPaper: {
      styleOverrides: { root: { backgroundImage: 'none' } }
    },
    MuiTextField: {
      defaultProps: { fullWidth: true, variant: 'filled' }
    },
    MuiFilledInput: {
      styleOverrides: {
        root: { borderRadius: 12, overflow: 'hidden' }
      }
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 600 } }
    },
    MuiAppBar: { defaultProps: { elevation: 0 } }
  }
};

export const darkTheme = createTheme({
  ...sharedOptions,
  palette: {
    mode: 'dark',
    primary: { main: greenBrand[500], dark: greenBrand[700], light: greenBrand[300], contrastText: '#0B1410' },
    secondary: { main: '#9CCC65', contrastText: '#0B1410' },
    success: { main: greenBrand[400] },
    error: { main: '#EF5350' },
    warning: { main: '#FFB74D' },
    info: { main: '#64B5F6' },
    background: { default: '#0B1410', paper: '#13201A' },
    text: { primary: '#F5F7F4', secondary: '#A5B5AC' },
    divider: 'rgba(255,255,255,0.08)'
  }
});

export const lightTheme = createTheme({
  ...sharedOptions,
  palette: {
    mode: 'light',
    primary: { main: greenBrand[700], dark: greenBrand[900], light: greenBrand[500], contrastText: '#FFFFFF' },
    secondary: { main: greenBrand[500], contrastText: '#FFFFFF' },
    success: { main: greenBrand[600] },
    error: { main: '#D32F2F' },
    warning: { main: '#F57C00' },
    info: { main: '#1976D2' },
    background: { default: '#F5F7F4', paper: '#FFFFFF' },
    text: { primary: '#0B1410', secondary: '#46584F' },
    divider: 'rgba(0,0,0,0.08)'
  }
});

export const brand = greenBrand;
