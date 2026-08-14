import type { PaletteMode } from '@mui/material';

/**
 * Design-system values that aren't expressible as MUI palette entries.
 *
 * Mirrors the token files of the "Golf Round Tracker" Claude Design system
 * (tokens/colors.css), which was itself generated from this theme — so these
 * are the same literals, just named. Anything that IS a palette entry
 * (--accent → primary.main, --surface-card → background.paper, …) should be
 * read from the theme instead of duplicated here.
 */

/** --accent-gradient. Dark theme only; light uses the flat accent. */
export const ACCENT_GRADIENT = 'linear-gradient(180deg, #fb9a47, #f07d22)';

/** --wash-round: the green card wash behind round/hero surfaces. */
export const WASH_ROUND = 'linear-gradient(135deg, rgba(46,125,50,0.55), rgba(76,175,80,0.35))';

/** --wash-stats */
export const WASH_STATS = 'linear-gradient(135deg, rgba(46,125,50,0.4), rgba(76,175,80,0.25))';

/** --wash-tournament */
export const WASH_TOURNAMENT =
  'linear-gradient(135deg, rgba(237,108,2,0.5), rgba(255,167,38,0.32))';

/** The accent fill for a selected control — gradient in dark, flat in light. */
export const accentFill = (mode: PaletteMode, accent: string): string =>
  mode === 'dark' ? ACCENT_GRADIENT : accent;

/**
 * --score-empty, the unfilled part of a progress track. The token is authored
 * dark-only (a white 6% wash); on light surfaces that is invisible, so the ink
 * equivalent is substituted rather than rendering an empty-looking track.
 */
export const trackFill = (mode: PaletteMode): string =>
  mode === 'dark' ? 'rgba(255,255,255,0.06)' : 'rgba(19,26,54,0.08)';
