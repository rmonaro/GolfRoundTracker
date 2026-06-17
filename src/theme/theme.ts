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
          borderRadius: 999, // PDI full pill
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
        root: { borderRadius: 16, backgroundImage: 'none' } // PDI cards 16-18px
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
        root: { borderRadius: 6, overflow: 'hidden' } // PDI inputs 6px
      }
    },
    MuiChip: {
      styleOverrides: { root: { fontWeight: 600, borderRadius: 6 } } // PDI chips 6px
    },
    MuiAppBar: { defaultProps: { elevation: 0 } }
  }
};

export const darkTheme = createTheme({
  ...sharedOptions,
  palette: {
    mode: 'dark',
    // PDI orange — primary CTA / active states. Gradient applied on contained
    // buttons below (#fb9a47 → #f07d22).
    primary: { main: '#f88930', dark: '#f07d22', light: '#fb9a47', contrastText: '#0b0f1a' },
    secondary: { main: '#ffd580', contrastText: '#0b0f1a' }, // warm gold accent
    success: { main: '#2fd27b', contrastText: '#0b0f1a' }, // connected / on-tempo / positive
    error: { main: '#ff5a52' }, // LIVE recording / destructive
    warning: { main: '#f0a83a' }, // off-tempo amber
    info: { main: '#64B5F6' },
    background: { default: '#0b0f1a', paper: '#141a2c' }, // app bg / card surface
    text: {
      primary: '#eef1f8', // high body & headings
      secondary: '#9aa3bd', // secondary text
      disabled: '#5b6688' // inactive / muted
    },
    divider: 'rgba(255,255,255,0.07)', // card hairlines
    action: {
      hover: 'rgba(255,255,255,0.06)',
      selected: 'rgba(255,255,255,0.12)' // stronger dividers / pill outlines
    }
  },
  components: {
    ...sharedOptions.components,
    // Re-declare MuiButton fully (object spread on `components` replaces the
    // key) and add the dark-mode orange gradient on contained-primary CTAs.
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minHeight: 48, borderRadius: 999, fontSize: '1rem', paddingInline: 18 },
        sizeLarge: { minHeight: 60, fontSize: '1.1rem' },
        containedPrimary: {
          backgroundImage: 'linear-gradient(180deg, #fb9a47, #f07d22)',
          color: '#0b0f1a'
        }
      }
    }
  }
});

export const lightTheme = createTheme({
  ...sharedOptions,
  palette: {
    mode: 'light',
    // PDI orange CTA (dark ink text for legibility on orange).
    primary: { main: '#f88930', dark: '#f07d22', light: '#fb9a47', contrastText: '#131a36' },
    secondary: { main: '#324279', contrastText: '#ffffff' }, // PDI navy
    success: { main: '#2f9e6e', contrastText: '#ffffff' }, // deeper green for white contrast
    error: { main: '#D32F2F' },
    warning: { main: '#f0a83a' },
    info: { main: '#324279' },
    background: { default: '#e4f0f9', paper: '#ffffff' }, // PDI sky / white
    text: {
      primary: '#131a36', // PDI ink — headings & body
      secondary: '#5a6480', // secondary body text
      disabled: '#8a93ab' // muted labels / placeholders
    },
    divider: '#d8e0ec' // PDI line
  },
  components: {
    ...sharedOptions.components,
    // Re-declare MuiButton fully and add the PDI orange CTA glow.
    MuiButton: {
      defaultProps: { disableElevation: true },
      styleOverrides: {
        root: { minHeight: 48, borderRadius: 999, fontSize: '1rem', paddingInline: 18 },
        sizeLarge: { minHeight: 60, fontSize: '1.1rem' },
        containedPrimary: { boxShadow: '0 12px 24px rgba(248,137,48,.32)' }
      }
    }
  }
});

export const brand = greenBrand;
