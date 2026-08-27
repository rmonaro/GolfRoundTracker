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

/**
 * Tempo target for a FULL swing, and for a PUTTING stroke.
 *
 * The ratio is always backswing time / forward-stroke time, so a bigger number
 * means a longer backswing relative to the strike. The full swing's classic
 * coaching heuristic is 3:1; putting is taught at 2:1 — the forward stroke
 * moves through the ball twice as fast as the stroke back. Judging a putt
 * against 3:1 flags nearly every well-struck putt as a rushed takeaway, which
 * is why the two are separate.
 */
export const TEMPO_IDEAL = 3.0;
export const TEMPO_IDEAL_PUTT = 2.0;

/** The tempo ratio a swing of this type is aiming at. */
export function tempoTargetFor(swingType?: string | null): number {
  return swingType === 'putt' ? TEMPO_IDEAL_PUTT : TEMPO_IDEAL;
}

/**
 * How far a swing's tempo ratio sat from ITS target, and which way.
 *
 * Below target means the backswing was quick relative to the forward stroke (a
 * rushed takeaway); above means it was long/slow against a fast strike.
 * `within` mirrors the rules engine's ±0.5 band for "great tempo" so the
 * wording and the feedback chips can't disagree. `phase` is the word for the
 * motion at this swing type — a putt has a backSTROKE, not a backswing.
 */
export function tempoVsTarget(
  ratio: number,
  swingType?: string | null
): {
  target: number;
  delta: number;
  /** 'quick' = under target, 'long' = over target, 'on' = inside the band. */
  direction: 'quick' | 'long' | 'on';
  within: boolean;
  phase: 'backswing' | 'backstroke';
} {
  const target = tempoTargetFor(swingType);
  const delta = ratio - target;
  const within = Math.abs(delta) <= TEMPO_GOOD_BAND;
  return {
    target,
    delta,
    direction: within ? 'on' : delta < 0 ? 'quick' : 'long',
    within,
    phase: swingType === 'putt' ? 'backstroke' : 'backswing'
  };
}

/** Half-width of the "great tempo" band around the target, in ratio points. */
export const TEMPO_GOOD_BAND = 0.5;

/** Compact "actual (target)" tempo for dense rows, e.g. `2.4 (target 3.0)`. */
export const fmtTempoVsTarget = (ratio: number, swingType?: string | null) =>
  `${ratio.toFixed(1)} (target ${tempoTargetFor(swingType).toFixed(1)})`;

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
