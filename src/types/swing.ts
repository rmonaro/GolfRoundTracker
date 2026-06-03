// Domain types for Apple Watch motion-based swing feedback.
//
// These are the camelCase interfaces the app code works with. The Supabase
// row shapes (snake_case) live in `database.ts`; `swingRepo` maps between them.
//
// Positioning: every numeric field here is a MOTION-BASED ESTIMATE or a
// RELATIVE CONSISTENCY SCORE from Apple Watch inertial sensors. None of these
// are launch-monitor measurements — no exact club path, face angle, swing
// plane degrees, launch angle, ball speed, spin, or carry distance.

import type { FatigueTrend, SwingShotResultValue } from './database';

export type { FatigueTrend } from './database';

/** Optional manual shot result the user can attach after a swing. */
export type SwingShotResult = SwingShotResultValue;

/** Logical club identity used by the practice UI (display-only mapping). */
export type ClubType =
  | 'driver'
  | '3wood'
  | '5wood'
  | 'hybrid'
  | '3iron'
  | '4iron'
  | '5iron'
  | '6iron'
  | '7iron'
  | '8iron'
  | '9iron'
  | 'pw'
  | 'gw'
  | 'sw'
  | 'lw'
  | 'putter';

/** One swing's motion-derived metrics. */
export interface SwingMetric {
  /** Local id until persisted, then the Supabase row id. */
  id: string;
  sessionId: string;
  /** 0-based order within the session. */
  swingIndex: number;
  clubId: string | null;
  capturedAt: string; // ISO

  backswingTimeMs: number;
  downswingTimeMs: number;
  /** Backswing : downswing. ~3.0 is a common full-swing target. */
  tempoRatio: number;

  transitionScore: number; // 0-100 smoothness
  /** Relative effort 0-100. NOT mph, NOT club-head speed. */
  estimatedHandSpeed: number;
  wristRotationScore: number; // 0-100 pattern smoothness
  finishStabilityScore: number; // 0-100

  /** Derived on the phone vs baseline; null until a baseline exists. */
  swingConsistencyScore: number | null;
  /** "Swing motion pattern" consistency — relative, NOT a measured plane. */
  planeConsistencyScore: number | null;
  /** Unit rotation-axis vector used only for the relative comparison. */
  planeAxis: number[];

  shotResult: SwingShotResult | null;
  /** Supabase row id once persisted; null while in-flight. `id` stays a
   *  stable local key for React lists either way (mirrors roundStore's
   *  tempId/remoteId split). */
  remoteId: string | null;
}

export interface SwingSession {
  id: string;
  userId: string;
  startedAt: string;
  endedAt: string | null;
  primaryClubId: string | null;
  swingCount: number;
  avgTempoRatio: number | null;
  tempoConsistencyScore: number | null;
  planeConsistencyScore: number | null;
  fatigueTrend: FatigueTrend | null;
  notes: string | null;
}

/** A single piece of feedback shown to the user. */
export interface SwingFeedback {
  /** Null = session-level feedback (consistency, fatigue). */
  swingId: string | null;
  level: 'positive' | 'neutral' | 'attention';
  code: string;
  message: string;
  /** Always present — compliance labeling. */
  disclaimer: typeof SWING_DISCLAIMER;
}

export const SWING_DISCLAIMER =
  'Motion-based estimate · not a launch monitor measurement' as const;

/** Raw swing payload as it arrives from the watch (over WatchConnectivity). */
export interface SwingDetectedPayload {
  sessionId: string;
  swingIndex: number;
  clubId: string | null;
  capturedAt: number; // epoch seconds from the watch
  backswingTimeMs: number;
  downswingTimeMs: number;
  tempoRatio: number;
  transitionScore: number;
  estimatedHandSpeed: number;
  wristRotationScore: number;
  finishStabilityScore: number;
  planeAxis: number[];
}
