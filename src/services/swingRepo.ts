import { supabase } from '@/lib/supabase';
import type {
  SwingFeedbackRow,
  SwingMetricRow,
  SwingSessionRow
} from '@/types/database';
import type {
  PracticeHealthSummary,
  SwingMetric,
  SwingSession,
  SwingShotResult,
  SwingType
} from '@/types/swing';
import type { SessionBaseline, SessionRollup } from './swingFeedbackEngine';
import { toAppError } from './errors';

// --- row <-> domain mapping ------------------------------------------------

function mapSession(r: SwingSessionRow): SwingSession {
  return {
    id: r.id,
    userId: r.user_id,
    startedAt: r.started_at,
    endedAt: r.ended_at,
    primaryClubId: r.primary_club_id,
    swingCount: r.swing_count,
    avgTempoRatio: r.avg_tempo_ratio,
    tempoConsistencyScore: r.tempo_consistency_score,
    planeConsistencyScore: r.plane_consistency_score,
    fatigueTrend: r.fatigue_trend,
    notes: r.notes,
    avgRestSeconds: r.avg_rest_seconds,
    rushing: r.rushing,
    setupConsistencyScore: r.setup_consistency_score,
    avgHeartRate: r.avg_heart_rate,
    maxHeartRate: r.max_heart_rate,
    minHeartRate: r.min_heart_rate,
    hrvSdnn: r.hrv_sdnn,
    activeCalories: r.active_calories,
    durationSeconds: r.duration_seconds
  };
}

function mapSwing(r: SwingMetricRow): SwingMetric {
  return {
    id: r.id,
    sessionId: r.session_id,
    swingIndex: r.swing_index,
    clubId: r.club_id,
    capturedAt: r.captured_at,
    backswingTimeMs: r.backswing_time_ms,
    downswingTimeMs: r.downswing_time_ms,
    tempoRatio: r.tempo_ratio,
    transitionScore: r.transition_score,
    estimatedHandSpeed: r.estimated_hand_speed,
    wristRotationScore: r.wrist_rotation_score,
    finishStabilityScore: r.finish_stability_score,
    swingConsistencyScore: r.swing_consistency_score,
    planeConsistencyScore: r.plane_consistency_score,
    planeAxis: r.plane_axis ?? [],
    swingType: r.swing_type,
    isAirSwing: r.is_air_swing ?? false,
    backswingRotation: r.backswing_rotation,
    releaseTimingScore: r.release_timing_score,
    decelerationScore: r.deceleration_score,
    transitionDirectionScore: r.transition_direction_score,
    addressGravity: r.address_gravity ?? [],
    heartRate: r.heart_rate,
    shotResult: r.shot_result,
    remoteId: r.id
  };
}

export interface SaveSwingInput {
  sessionId: string;
  userId: string;
  swingIndex: number;
  clubId: string | null;
  capturedAt: string;
  backswingTimeMs: number;
  downswingTimeMs: number;
  tempoRatio: number;
  transitionScore: number;
  estimatedHandSpeed: number;
  wristRotationScore: number;
  finishStabilityScore: number;
  planeAxis: number[];
  swingConsistencyScore?: number | null;
  planeConsistencyScore?: number | null;
  swingType?: SwingType | null;
  isAirSwing?: boolean;
  backswingRotation?: number | null;
  releaseTimingScore?: number | null;
  decelerationScore?: number | null;
  transitionDirectionScore?: number | null;
  addressGravity?: number[];
  heartRate?: number | null;
  shotResult?: SwingShotResult | null;
}

// --- repo ------------------------------------------------------------------

export const swingRepo = {
  async createSession(input: {
    userId: string;
    primaryClubId: string | null;
  }): Promise<SwingSession> {
    const { data, error } = await supabase
      .from('swing_sessions')
      .insert({ user_id: input.userId, primary_club_id: input.primaryClubId })
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not start practice session');
    return mapSession(data as SwingSessionRow);
  },

  async saveSwing(input: SaveSwingInput): Promise<SwingMetric> {
    const { data, error } = await supabase
      .from('swing_metrics')
      .insert({
        session_id: input.sessionId,
        user_id: input.userId,
        swing_index: input.swingIndex,
        club_id: input.clubId,
        captured_at: input.capturedAt,
        backswing_time_ms: input.backswingTimeMs,
        downswing_time_ms: input.downswingTimeMs,
        tempo_ratio: input.tempoRatio,
        transition_score: input.transitionScore,
        estimated_hand_speed: input.estimatedHandSpeed,
        wrist_rotation_score: input.wristRotationScore,
        finish_stability_score: input.finishStabilityScore,
        swing_consistency_score: input.swingConsistencyScore ?? null,
        plane_consistency_score: input.planeConsistencyScore ?? null,
        plane_axis: input.planeAxis,
        swing_type: input.swingType ?? null,
        is_air_swing: input.isAirSwing ?? false,
        backswing_rotation: input.backswingRotation ?? null,
        release_timing_score: input.releaseTimingScore ?? null,
        deceleration_score: input.decelerationScore ?? null,
        transition_direction_score: input.transitionDirectionScore ?? null,
        address_gravity: input.addressGravity ?? null,
        heart_rate: input.heartRate ?? null,
        shot_result: input.shotResult ?? null
      })
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not save swing');
    return mapSwing(data as SwingMetricRow);
  },

  async setShotResult(swingId: string, result: SwingShotResult): Promise<void> {
    const { error } = await supabase
      .from('swing_metrics')
      .update({ shot_result: result })
      .eq('id', swingId);
    if (error) throw toAppError(error, 'Could not save shot result');
  },

  async updateSwingScores(
    swingId: string,
    scores: { swingConsistencyScore: number | null; planeConsistencyScore: number | null }
  ): Promise<void> {
    const { error } = await supabase
      .from('swing_metrics')
      .update({
        swing_consistency_score: scores.swingConsistencyScore,
        plane_consistency_score: scores.planeConsistencyScore
      })
      .eq('id', swingId);
    if (error) throw toAppError(error, 'Could not update swing scores');
  },

  async endSession(
    sessionId: string,
    rollup: SessionRollup,
    health?: PracticeHealthSummary
  ): Promise<void> {
    const { error } = await supabase
      .from('swing_sessions')
      .update({
        ended_at: new Date().toISOString(),
        swing_count: rollup.swingCount,
        avg_tempo_ratio: rollup.avgTempoRatio,
        tempo_consistency_score: rollup.tempoConsistencyScore,
        plane_consistency_score: rollup.planeConsistencyScore,
        fatigue_trend: rollup.fatigueTrend,
        avg_rest_seconds: rollup.avgRestSeconds,
        rushing: rollup.rushing,
        setup_consistency_score: rollup.setupConsistencyScore,
        avg_heart_rate: health?.avgHeartRate ?? null,
        max_heart_rate: health?.maxHeartRate ?? null,
        min_heart_rate: health?.minHeartRate ?? null,
        hrv_sdnn: health?.hrvSdnn ?? null,
        active_calories: health?.activeCalories ?? null,
        duration_seconds: health?.durationSeconds ?? null
      })
      .eq('id', sessionId);
    if (error) throw toAppError(error, 'Could not end session');
  },

  async saveFeedback(input: {
    sessionId: string;
    swingId: string | null;
    level: 'positive' | 'neutral' | 'attention';
    code: string;
    message: string;
    source?: 'rules' | 'ai';
    aiPayload?: Record<string, unknown> | null;
  }): Promise<void> {
    const { error } = await supabase.from('swing_feedback').insert({
      session_id: input.sessionId,
      swing_id: input.swingId,
      level: input.level,
      code: input.code,
      message: input.message,
      source: input.source ?? 'rules',
      ai_payload: input.aiPayload ?? null
    });
    if (error) throw toAppError(error, 'Could not save feedback');
  },

  async listSessions(userId: string): Promise<SwingSession[]> {
    const { data, error } = await supabase
      .from('swing_sessions')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false });
    if (error) throw toAppError(error, 'Could not load practice sessions');
    return (data ?? []).map((r) => mapSession(r as SwingSessionRow));
  },

  /**
   * Delete a practice session. RLS restricts this to the owner; the schema
   * cascades to swing_metrics and swing_feedback, so one delete removes the
   * whole session graph.
   */
  async deleteSession(sessionId: string): Promise<void> {
    const { error } = await supabase.from('swing_sessions').delete().eq('id', sessionId);
    if (error) throw toAppError(error, 'Could not delete practice session');
  },

  async getSession(sessionId: string): Promise<SwingSession | null> {
    const { data, error } = await supabase
      .from('swing_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) throw toAppError(error, 'Could not load practice session');
    return data ? mapSession(data as SwingSessionRow) : null;
  },

  async listSwings(sessionId: string): Promise<SwingMetric[]> {
    const { data, error } = await supabase
      .from('swing_metrics')
      .select('*')
      .eq('session_id', sessionId)
      .order('swing_index', { ascending: true });
    if (error) throw toAppError(error, 'Could not load swings');
    return (data ?? []).map((r) => mapSwing(r as SwingMetricRow));
  },

  async listFeedback(sessionId: string): Promise<SwingFeedbackRow[]> {
    const { data, error } = await supabase
      .from('swing_feedback')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    if (error) throw toAppError(error, 'Could not load feedback');
    return (data ?? []) as SwingFeedbackRow[];
  },

  /**
   * Build a baseline from the user's recent completed sessions so the rules
   * engine can say "less consistent than your baseline" / "improved". Returns
   * undefined when there isn't enough history yet (first sessions just get
   * absolute feedback, no comparison).
   */
  async getUserBaseline(userId: string): Promise<SessionBaseline | undefined> {
    const { data, error } = await supabase
      .from('swing_sessions')
      .select('avg_tempo_ratio, tempo_consistency_score, plane_consistency_score')
      .eq('user_id', userId)
      .not('ended_at', 'is', null)
      .order('started_at', { ascending: false })
      .limit(5);
    if (error) throw toAppError(error, 'Could not load baseline');
    const rows = (data ?? []).filter((r) => r.avg_tempo_ratio != null);
    if (rows.length < 2) return undefined;

    const tempos = rows.map((r) => Number(r.avg_tempo_ratio));
    const tempoConsistencies = rows
      .map((r) => r.tempo_consistency_score)
      .filter((v): v is number => v != null);
    const planeConsistencies = rows
      .map((r) => r.plane_consistency_score)
      .filter((v): v is number => v != null);

    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);
    // Convert mean tempo-consistency score (0-100) back to an approximate CV.
    const meanTempoConsistency = avg(tempoConsistencies);
    const tempoCv = Math.max(0, 1 - meanTempoConsistency / 100);

    return {
      tempoRatio: avg(tempos),
      tempoCv,
      planeConsistency: planeConsistencies.length ? avg(planeConsistencies) : 100
    };
  }
};
