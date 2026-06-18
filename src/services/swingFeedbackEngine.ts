// V1 swing feedback rules engine — pure functions, no ML.
//
// Per-swing rules fire immediately on each swing. Session-level rules
// (consistency, fatigue, baseline comparisons) need several swings and an
// optional prior baseline. Everything here produces RELATIVE / ESTIMATED
// feedback only and never claims absolute ball/club geometry.

import type { FatigueTrend, SwingFeedback, SwingMetric } from '@/types/swing';
import { SWING_DISCLAIMER, TEMPO_IDEAL } from '@/utils/swingLabels';

const fb = (
  level: SwingFeedback['level'],
  code: string,
  message: string,
  swingId: string | null = null
): SwingFeedback => ({ swingId, level, code, message, disclaimer: SWING_DISCLAIMER });

// Plain-language explanation for each feedback code, shown when the user taps a
// feedback chip. Relative/estimated framing only — never absolute geometry.
const FEEDBACK_EXPLANATIONS: Record<string, string> = {
  TEMPO_GOOD:
    'Your backswing-to-downswing ratio was close to the classic ~3:1. A repeatable tempo is the foundation of consistent ball-striking.',
  BACKSWING_RUSHED:
    'Your backswing was quick relative to your downswing (ratio under ~2.2:1). Rushing the takeaway often costs control and sequencing — try a slower, smoother start back.',
  BACKSWING_SLOW:
    'Your backswing was long/slow relative to a fast downswing (ratio over ~4:1). Not necessarily bad, but a big gap can hurt timing — aim for a smoother, more proportional change of direction.',
  TRANSITION_AGGRESSIVE:
    'The change of direction at the top was abrupt. A smoother transition lets the club load and sequence properly instead of throwing speed away early.',
  TRANSITION_SMOOTH:
    'You changed direction smoothly at the top — a sign of good sequencing and a key to repeatable contact.',
  FINISH_UNSTABLE:
    'Your wrist was still settling after impact, which suggests you came off balance. Holding a balanced finish usually means you controlled your body through the shot.',
  FINISH_BALANCED:
    'You held a steady, balanced finish — a good sign you stayed in control through impact.',
  TEMPO_CONSISTENCY_UP:
    'Your swing-to-swing tempo was tighter than your usual baseline this session — you are repeating your rhythm better.',
  PATTERN_LESS_CONSISTENT:
    'Your overall motion shape repeated less closely than your baseline this session. A repeatable pattern (your "plane tendency") is what makes contact predictable.',
  FATIGUE_POSSIBLE:
    'Your later swings drifted from your earlier ones in a way that often signals tiredness. Consider a rest, or treat the back end of the session as quality over quantity.',
  SETUP_VARIED:
    'Your address/setup orientation changed noticeably between swings. A more repeatable setup makes everything after it easier to repeat.',
  SETUP_REPEATABLE:
    'You set up very consistently swing to swing — a strong, often-overlooked fundamental.',
  RUSHING:
    'You moved through balls quickly with little rest between swings. Short rests can reduce focus and make your reps less representative of on-course swings.',
  OVER_THE_TOP:
    'On average your direction shifted in a way associated with an over-the-top move. This is a tendency inferred from wrist motion, not a measured club path — worth checking your transition.',
  DECELERATING:
    'On average you tended to slow down through impact rather than accelerate. "Quitting" on the shot leaks power and can flip the hands — feel like you are speeding up past the ball.'
};

/** Plain-language explanation for a feedback code (empty string if unknown). */
export function feedbackExplanation(code: string): string {
  return FEEDBACK_EXPLANATIONS[code] ?? '';
}

// --- per-swing -------------------------------------------------------------

export function evaluateSwing(s: SwingMetric): SwingFeedback[] {
  const out: SwingFeedback[] = [];

  // Tempo ratio.
  if (Math.abs(s.tempoRatio - TEMPO_IDEAL) <= 0.5) {
    out.push(fb('positive', 'TEMPO_GOOD', 'Great tempo', s.id));
  } else if (s.tempoRatio > 0 && s.tempoRatio < 2.2) {
    out.push(fb('attention', 'BACKSWING_RUSHED', 'Backswing was rushed', s.id));
  } else if (s.tempoRatio > 4.0) {
    out.push(fb('neutral', 'BACKSWING_SLOW', 'Backswing was slow relative to downswing', s.id));
  }

  // Transition smoothness.
  if (s.transitionScore < 40) {
    out.push(fb('attention', 'TRANSITION_AGGRESSIVE', 'Transition was too aggressive', s.id));
  } else if (s.transitionScore >= 75) {
    out.push(fb('positive', 'TRANSITION_SMOOTH', 'Smooth transition', s.id));
  }

  // Finish stability.
  if (s.finishStabilityScore < 40) {
    out.push(fb('attention', 'FINISH_UNSTABLE', 'Finish was unstable', s.id));
  } else if (s.finishStabilityScore >= 80) {
    out.push(fb('positive', 'FINISH_BALANCED', 'Balanced finish', s.id));
  }

  return out;
}

// --- session-level ---------------------------------------------------------

export interface SessionBaseline {
  /** Mean tempo ratio from prior completed sessions. */
  tempoRatio: number;
  /** Coefficient of variation of tempo from prior sessions (lower = steadier). */
  tempoCv: number;
  /** Mean swing-motion-pattern consistency from prior sessions (0-100). */
  planeConsistency: number;
}

export interface SessionRollup {
  swingCount: number;
  avgTempoRatio: number | null;
  tempoConsistencyScore: number | null;
  planeConsistencyScore: number | null;
  fatigueTrend: FatigueTrend;
  // Derived (Phase 1)
  avgRestSeconds: number | null;
  rushing: boolean | null;
  setupConsistencyScore: number | null;
}

export interface SessionEvaluation {
  feedback: SwingFeedback[];
  rollup: SessionRollup;
  /** Per-swing scores backfilled against this session (consistency + plane). */
  perSwing: Record<string, { swingConsistencyScore: number; planeConsistencyScore: number }>;
}

export function evaluateSession(
  swings: SwingMetric[],
  baseline?: SessionBaseline
): SessionEvaluation {
  const out: SwingFeedback[] = [];
  const perSwing: SessionEvaluation['perSwing'] = {};

  // Rehearsal / air swings are excluded from the real-swing stats so they
  // don't pollute tempo, consistency, fatigue, etc.
  const real = swings.filter((s) => !s.isAirSwing);

  const tempos = real.map((s) => s.tempoRatio).filter((t) => t > 0);
  const avgTempo = tempos.length ? mean(tempos) : null;
  const tempoCvNow = tempos.length > 1 ? cv(tempos) : 0;
  const tempoConsistency = tempos.length > 1 ? clamp100((1 - tempoCvNow) * 100) : null;

  // Swing-motion-pattern (a.k.a. plane-tendency) consistency — relative,
  // cosine similarity of each swing's rotation axis to the session mean axis.
  const axes = real.map((s) => s.planeAxis).filter((a) => a && a.length === 3);
  const meanAxis = axes.length ? normalize(axes.reduce((acc, a) => add(acc, a), [0, 0, 0])) : null;
  const planeConsistency =
    meanAxis && axes.length > 1
      ? clamp100(mean(axes.map((a) => dot(normalize(a), meanAxis))) * 100)
      : null;

  // Setup repeatability — cosine similarity of each swing's address-gravity
  // vector to the session mean. Relative, 0-100.
  const setupVecs = real.map((s) => s.addressGravity).filter((a) => a && a.length === 3);
  const meanSetup = setupVecs.length
    ? normalize(setupVecs.reduce((acc, a) => add(acc, a), [0, 0, 0]))
    : null;
  const setupConsistency =
    meanSetup && setupVecs.length > 1
      ? clamp100(mean(setupVecs.map((a) => dot(normalize(a), meanSetup))) * 100)
      : null;

  // Cadence — average rest between consecutive swings (gaps over 2 min are
  // treated as breaks and ignored).
  const times = real
    .map((s) => Date.parse(s.capturedAt))
    .filter((t) => !Number.isNaN(t))
    .sort((a, b) => a - b);
  const gaps: number[] = [];
  for (let i = 1; i < times.length; i++) {
    const sec = (times[i] - times[i - 1]) / 1000;
    if (sec > 0 && sec < 120) gaps.push(sec);
  }
  const avgRestSeconds = gaps.length ? Math.round(mean(gaps) * 10) / 10 : null;
  const rushing = avgRestSeconds != null ? avgRestSeconds < 8 : null;

  // Backfill per-swing relative scores (need the session to exist first).
  for (const s of real) {
    const tempoScore =
      avgTempo && avgTempo > 0
        ? clamp100((1 - Math.min(Math.abs(s.tempoRatio - avgTempo) / avgTempo, 1)) * 100)
        : 50;
    const planeScore =
      meanAxis && s.planeAxis?.length === 3
        ? clamp100(dot(normalize(s.planeAxis), meanAxis) * 100)
        : 50;
    perSwing[s.id] = { swingConsistencyScore: tempoScore, planeConsistencyScore: planeScore };
  }

  // Baseline comparisons (only when we have prior history).
  if (baseline) {
    if (planeConsistency != null && planeConsistency < baseline.planeConsistency - 5) {
      out.push(
        fb(
          'attention',
          'PATTERN_LESS_CONSISTENT',
          'Swing pattern was less consistent than your baseline'
        )
      );
    }
    if (tempos.length > 2 && tempoCvNow < baseline.tempoCv - 0.02) {
      out.push(fb('positive', 'TEMPO_CONSISTENCY_UP', 'Tempo consistency improved this session'));
    }
  }

  // Fatigue: compare the back third of the session to the front third.
  const fatigue = detectFatigue(real);
  if (fatigue !== 'none') {
    out.push(fb('attention', 'FATIGUE_POSSIBLE', 'Possible fatigue detected'));
  }

  // Setup repeatability.
  if (setupConsistency != null && setupConsistency < 60) {
    out.push(fb('attention', 'SETUP_VARIED', 'Your setup varied between swings'));
  } else if (setupConsistency != null && setupConsistency >= 85) {
    out.push(fb('positive', 'SETUP_REPEATABLE', 'Very repeatable setup'));
  }

  // Pace.
  if (rushing) {
    out.push(fb('neutral', 'RUSHING', 'You were working through balls quickly'));
  }

  // Over-the-top tendency (low transition-direction consistency on average).
  const transDir = real.map((s) => s.transitionDirectionScore).filter((v): v is number => v != null);
  if (transDir.length >= 3 && mean(transDir) < 45) {
    out.push(fb('attention', 'OVER_THE_TOP', 'Some over-the-top motion tendency'));
  }

  // Quitting on it — decelerating through impact on average.
  const decel = real.map((s) => s.decelerationScore).filter((v): v is number => v != null);
  if (decel.length >= 3 && mean(decel) < 40) {
    out.push(fb('attention', 'DECELERATING', 'You tend to decelerate through impact'));
  }

  return {
    feedback: out,
    rollup: {
      swingCount: real.length,
      avgTempoRatio: avgTempo == null ? null : round2(avgTempo),
      tempoConsistencyScore: tempoConsistency,
      planeConsistencyScore: planeConsistency,
      fatigueTrend: fatigue,
      avgRestSeconds,
      rushing,
      setupConsistencyScore: setupConsistency
    },
    perSwing
  };
}

function detectFatigue(swings: SwingMetric[]): FatigueTrend {
  if (swings.length < 12) return 'none';
  const third = Math.floor(swings.length / 3);
  const front = swings.slice(0, third);
  const back = swings.slice(-third);

  const dHand = mean(back.map((s) => s.estimatedHandSpeed)) - mean(front.map((s) => s.estimatedHandSpeed));
  const dFinish =
    mean(back.map((s) => s.finishStabilityScore)) - mean(front.map((s) => s.finishStabilityScore));
  const frontTempoCv = cv(front.map((s) => s.tempoRatio).filter((t) => t > 0));
  const backTempoCv = cv(back.map((s) => s.tempoRatio).filter((t) => t > 0));
  const dTempoVar = backTempoCv - frontTempoCv;

  const flags = [dHand < -8, dFinish < -10, dTempoVar > 0.08].filter(Boolean).length;
  return flags >= 2 ? 'likely' : flags === 1 ? 'possible' : 'none';
}

// --- small math helpers ----------------------------------------------------

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function cv(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  if (m === 0) return 0;
  const variance = mean(xs.map((x) => (x - m) ** 2));
  return Math.sqrt(variance) / m;
}
function add(a: number[], b: number[]): number[] {
  return a.map((v, i) => v + (b[i] ?? 0));
}
function dot(a: number[], b: number[]): number {
  return a.reduce((acc, v, i) => acc + v * (b[i] ?? 0), 0);
}
function normalize(v: number[]): number[] {
  const n = Math.sqrt(dot(v, v));
  return n > 1e-6 ? v.map((x) => x / n) : v.map(() => 0);
}
function clamp100(v: number): number {
  return Math.max(0, Math.min(100, Math.round(v)));
}
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
