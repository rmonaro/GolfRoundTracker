import { supabase } from '@/lib/supabase';
import type {
  Round,
  RoundHole,
  Shot,
  FairwayResult,
  ShotResult,
  DistanceUnit,
  TargetType,
  TargetResult,
  Lie,
  PenaltyType
} from '@/models';
import { toAppError } from './errors';

export const roundRepo = {
  async create(payload: Omit<Round, 'id'>): Promise<Round> {
    const { data, error } = await supabase.from('rounds').insert(payload).select('*').single();
    if (error) throw toAppError(error, 'Could not start round');
    return data;
  },

  async update(roundId: string, patch: Partial<Round>): Promise<Round> {
    const { data, error } = await supabase
      .from('rounds')
      .update(patch)
      .eq('id', roundId)
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not update round');
    return data;
  },

  async listForUser(userId: string): Promise<Round[]> {
    const { data, error } = await supabase
      .from('rounds')
      .select('*')
      .eq('user_id', userId)
      .order('started_at', { ascending: false });
    if (error) throw toAppError(error, 'Could not load rounds');
    return data ?? [];
  },

  async getById(roundId: string): Promise<Round | null> {
    const { data, error } = await supabase.from('rounds').select('*').eq('id', roundId).maybeSingle();
    if (error) throw toAppError(error, 'Could not load round');
    return data ?? null;
  },

  async listHoles(roundId: string): Promise<RoundHole[]> {
    const { data, error } = await supabase
      .from('round_holes')
      .select('*')
      .eq('round_id', roundId)
      .order('hole_number', { ascending: true });
    if (error) throw toAppError(error, 'Could not load holes');
    return data ?? [];
  },

  async upsertHole(hole: Omit<RoundHole, 'id'> & { id?: string }): Promise<RoundHole> {
    const { data, error } = await supabase
      .from('round_holes')
      .upsert(hole, { onConflict: 'round_id,hole_number' })
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not save hole');
    return data;
  },

  async upsertHoles(holes: Array<Omit<RoundHole, 'id'> & { id?: string }>): Promise<RoundHole[]> {
    if (holes.length === 0) return [];
    const { data, error } = await supabase
      .from('round_holes')
      .upsert(holes, { onConflict: 'round_id,hole_number' })
      .select('*');
    if (error) throw toAppError(error, 'Could not save holes');
    return data ?? [];
  },

  async listShots(roundId: string): Promise<Shot[]> {
    const { data, error } = await supabase
      .from('shots')
      .select('*')
      .eq('round_id', roundId)
      .order('hole_id', { ascending: true })
      .order('shot_number', { ascending: true });
    if (error) throw toAppError(error, 'Could not load shots');
    return data ?? [];
  },

  async addShot(payload: {
    round_id: string;
    hole_id: string;
    shot_number: number;
    club_id: string | null;
    shot_result: ShotResult;
    target_type: TargetType | null;
    target_result: TargetResult | null;
    lie: Lie | null;
    penalty_type: PenaltyType | null;
    distance: number | null;
    distance_unit: DistanceUnit | null;
    notes: string | null;
    // V2 GPS placeholders — pass null in V1.
    start_lat?: number | null;
    start_lng?: number | null;
    end_lat?: number | null;
    end_lng?: number | null;
    calculated_distance?: number | null;
  }): Promise<Shot> {
    const { data, error } = await supabase.from('shots').insert(payload).select('*').single();
    if (error) throw toAppError(error, 'Could not add shot');
    return data;
  },

  async updateShot(
    shotId: string,
    patch: {
      club_id?: string | null;
      shot_result?: ShotResult;
      target_type?: TargetType | null;
      target_result?: TargetResult | null;
      lie?: Lie | null;
      penalty_type?: PenaltyType | null;
      distance?: number | null;
      distance_unit?: DistanceUnit | null;
      notes?: string | null;
    }
  ): Promise<Shot> {
    const { data, error } = await supabase
      .from('shots')
      .update(patch)
      .eq('id', shotId)
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not update shot');
    return data;
  },

  async deleteShot(shotId: string): Promise<void> {
    const { error } = await supabase.from('shots').delete().eq('id', shotId);
    if (error) throw toAppError(error, 'Could not delete shot');
  }
};

export type { FairwayResult, ShotResult };
