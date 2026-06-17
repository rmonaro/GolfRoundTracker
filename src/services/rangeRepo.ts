import { supabase } from '@/lib/supabase';
import type { RangeSessionRow, RangeShotRow } from '@/types/database';
import type { LatLng, RangeSession, RangeShot } from '@/types/range';
import { computeBearing, computeShot, mToYards } from '@/features/range/rangeGeo';
import { toAppError } from './errors';

// --- row <-> domain mapping ------------------------------------------------

function mapSession(r: RangeSessionRow): RangeSession {
  return {
    id: r.id,
    userId: r.user_id,
    origin: { lat: r.origin_lat, lng: r.origin_lng },
    target: { lat: r.target_lat, lng: r.target_lng },
    targetBearing: r.target_bearing,
    startedAt: r.started_at,
    endedAt: r.ended_at
  };
}

// Stored metric, surfaced as yards.
function mapShot(r: RangeShotRow): RangeShot {
  return {
    id: r.id,
    sessionId: r.session_id,
    userId: r.user_id,
    swingEventId: r.swing_event_id,
    club: r.club,
    land: { lat: r.land_lat, lng: r.land_lng },
    carryYards: mToYards(r.carry_m),
    offlineYards: mToYards(r.offline_m),
    totalYards: mToYards(r.total_m),
    createdAt: r.created_at
  };
}

export const rangeRepo = {
  /**
   * Create a session at a mat. Captures the fixed origin + the tapped target
   * line and computes the origin->target bearing. (`createRangeSession`.)
   */
  async createSession(userId: string, origin: LatLng, target: LatLng): Promise<RangeSession> {
    const targetBearing = computeBearing(origin, target);
    const { data, error } = await supabase
      .from('range_sessions')
      .insert({
        user_id: userId,
        origin_lat: origin.lat,
        origin_lng: origin.lng,
        target_lat: target.lat,
        target_lng: target.lng,
        target_bearing: targetBearing
      })
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not start range session');
    return mapSession(data as RangeSessionRow);
  },

  /** Mark a session finished. (`endRangeSession`.) */
  async endSession(sessionId: string): Promise<void> {
    const { error } = await supabase
      .from('range_sessions')
      .update({ ended_at: new Date().toISOString() })
      .eq('id', sessionId);
    if (error) throw toAppError(error, 'Could not end range session');
  },

  /**
   * Log one shot. Decomposes the landing point into carry/offline/total via the
   * pure geo util (stored as meters) relative to the session's target line.
   * `swingEventId` is the deferred watch-integration seam (null in v1).
   * (`logRangeShot`.)
   */
  async logShot(input: {
    session: RangeSession;
    land: LatLng;
    club?: string | null;
    swingEventId?: string | null;
  }): Promise<RangeShot> {
    const { session, land } = input;
    const { carryM, offlineM, totalM } = computeShot(session.origin, session.target, land);
    const { data, error } = await supabase
      .from('range_shots')
      .insert({
        session_id: session.id,
        user_id: session.userId,
        swing_event_id: input.swingEventId ?? null,
        club: input.club ?? null,
        land_lat: land.lat,
        land_lng: land.lng,
        carry_m: carryM,
        offline_m: offlineM,
        total_m: totalM
      })
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not log shot');
    return mapShot(data as RangeShotRow);
  },

  /** Shots for a session, oldest first (live display + summary). (`getSessionShots`.) */
  async getSessionShots(sessionId: string): Promise<RangeShot[]> {
    const { data, error } = await supabase
      .from('range_shots')
      .select('*')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true });
    if (error) throw toAppError(error, 'Could not load shots');
    return (data ?? []).map((r) => mapShot(r as RangeShotRow));
  },

  /** All of a user's range sessions (newest first) with their shot counts. */
  async listSessions(userId: string): Promise<Array<RangeSession & { shotCount: number }>> {
    const { data, error } = await supabase
      .from('range_sessions')
      .select('*, range_shots(count)')
      .eq('user_id', userId)
      .order('started_at', { ascending: false });
    if (error) throw toAppError(error, 'Could not load range sessions');
    return (data ?? []).map((r) => {
      const row = r as RangeSessionRow & { range_shots?: Array<{ count: number }> };
      return { ...mapSession(row), shotCount: row.range_shots?.[0]?.count ?? 0 };
    });
  },

  /** Delete a single logged shot. */
  async deleteShot(shotId: string): Promise<void> {
    const { error } = await supabase.from('range_shots').delete().eq('id', shotId);
    if (error) throw toAppError(error, 'Could not delete shot');
  },

  /** Delete a range session. Cascades to its range_shots via the FK. */
  async deleteSession(sessionId: string): Promise<void> {
    const { error } = await supabase.from('range_sessions').delete().eq('id', sessionId);
    if (error) throw toAppError(error, 'Could not delete range session');
  },

  async getSession(sessionId: string): Promise<RangeSession | null> {
    const { data, error } = await supabase
      .from('range_sessions')
      .select('*')
      .eq('id', sessionId)
      .maybeSingle();
    if (error) throw toAppError(error, 'Could not load range session');
    return data ? mapSession(data as RangeSessionRow) : null;
  },

  /**
   * The user's most recent still-open session, if any. Lets the screen restore
   * an in-progress session (and its shots) after a reload.
   */
  async getOpenSession(userId: string): Promise<RangeSession | null> {
    const { data, error } = await supabase
      .from('range_sessions')
      .select('*')
      .eq('user_id', userId)
      .is('ended_at', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw toAppError(error, 'Could not load range session');
    return data ? mapSession(data as RangeSessionRow) : null;
  }
};
