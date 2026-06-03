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

  const tempos = swings.map((s) => s.tempoRatio).filter((t) => t > 0);
  const avgTempo = tempos.length ? mean(tempos) : null;
  const tempoCvNow = tempos.length > 1 ? cv(tempos) : 0;
  const tempoConsistency = tempos.length > 1 ? clamp100((1 - tempoCvNow) * 100) : null;

  // Swing-motion-pattern (a.k.a. plane-tendency) consistency — relative,
  // cosine similarity of each swing's rotation axis to the session mean axis.
  const axes = swings.map((s) => s.planeAxis).filter((a) => a && a.length === 3);
  const meanAxis = axes.length ? normalize(axes.reduce((acc, a) => add(acc, a), [0, 0, 0])) : null;
  const planeConsistency =
    meanAxis && axes.length > 1
      ? clamp100(mean(axes.map((a) => dot(normalize(a), meanAxis))) * 100)
      : null;

  // Backfill per-swing relative scores (need the session to exist first).
  for (const s of swings) {
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
  const fatigue = detectFatigue(swings);
  if (fatigue !== 'none') {
    out.push(fb('attention', 'FATIGUE_POSSIBLE', 'Possible fatigue detected'));
  }

  return {
    feedback: out,
    rollup: {
      swingCount: swings.length,
      avgTempoRatio: avgTempo == null ? null : round2(avgTempo),
      tempoConsistencyScore: tempoConsistency,
      planeConsistencyScore: planeConsistency,
      fatigueTrend: fatigue
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
