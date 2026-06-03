// Centralised, compliance-safe labels for swing feedback. Importing these
// (rather than hand-writing strings at call sites) keeps the "estimated /
// motion-based / not a launch monitor" framing consistent and makes it
// impossible to accidentally claim absolute ball/club measurements.

export const SWING_DISCLAIMER =
  'Motion-based estimate · not a launch monitor measurement' as const;

export const MOTION_CHIPS = ['Motion-based', 'Estimated', 'Not a launch monitor measurement'] as const;

/** Estimated wrist/hand effort — relative 0-100, never mph. */
export const fmtHandSpeed = (v: number) => `Estimated effort ${Math.round(v)}/100`;

/** Relative consistency of the swing-motion pattern — NOT a measured plane. */
export const fmtPlane = (v: number) => `Swing motion pattern consistency ${Math.round(v)}/100`;

export const fmtTempo = (r: number) => `${r.toFixed(1)} : 1 tempo (estimated)`;

export const fmtScore = (label: string, v: number | null | undefined) =>
  v == null ? `${label} —` : `${label} ${Math.round(v)}/100`;

/** Tempo target used across the UI + rules engine. Common coaching heuristic. */
export const TEMPO_IDEAL = 3.0;

/**
 * Banned substrings — anything implying a launch-monitor / geometry
 * measurement. A unit test (and code review) can assert feedback copy never
 * contains these.
 */
export const OVERCLAIM_PATTERNS: RegExp[] = [
  /\bmph\b/i,
  /\bdegrees?\b/i,
  /°/,
  /\bcarry\b/i,
  /\bspin\b/i,
  /launch angle/i,
  /face angle/i,
  /club path/i,
  /ball speed/i
];
