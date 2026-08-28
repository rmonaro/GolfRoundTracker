import type { SxProps, Theme } from '@mui/material';

/**
 * Shared geometry for the app's bottom bar.
 *
 * There are two of them — MobileShell's nav, and the section bar Settings swaps
 * in for it — and they're meant to read as the same surface, so switching into
 * Settings doesn't visibly resize the strip at the bottom of the screen. They
 * lived as duplicated literals in both files and are centralised here so they
 * can't drift.
 */

/**
 * Height of the icon/label row. The Paper adds the bottom safe-area strip
 * underneath, so the bar's real footprint is this plus the inset.
 *
 * 56 is the Material spec height for a labelled bottom bar. It was 80, which
 * ate an eighth of a phone screen for no gain.
 */
export const NAV_ROW_HEIGHT = 56;

/**
 * Reserved at the bottom of a scroll container so a page's last row clears the
 * bar. Derived from NAV_ROW_HEIGHT — the two drifting apart either clips
 * content or leaves dead space.
 */
export const NAV_CONTENT_INSET = `calc(${NAV_ROW_HEIGHT + 8}px + env(safe-area-inset-bottom))`;

/** Styling for the `<BottomNavigation>` inside either bar. */
export const bottomNavSx: SxProps<Theme> = {
  height: NAV_ROW_HEIGHT,
  minHeight: NAV_ROW_HEIGHT,
  // Transparent so the Paper's background shows through uniformly — the Paper
  // owns the surface all the way down through the home-indicator safe area.
  bgcolor: 'transparent',
  // MUI pads an unselected action down to leave room for a label that only
  // appears when selected. `showLabels` is on in both bars, so every label is
  // always present and that padding just wastes the height we're saving.
  '& .MuiBottomNavigationAction-root': {
    minWidth: 'unset',
    px: 0.5,
    paddingTop: '6px',
    paddingBottom: '6px'
  },
  '& .MuiBottomNavigationAction-label': {
    fontSize: '0.68rem',
    lineHeight: 1.2,
    // Selected labels grow by default, which would push the row past the
    // height set above.
    '&.Mui-selected': { fontSize: '0.68rem' }
  },
  // Width/height rather than fontSize: the practice tab's icon is a
  // hand-written <svg> with literal 24x24 attributes, which an em-based rule
  // wouldn't touch.
  '& svg': { width: 22, height: 22 }
};
