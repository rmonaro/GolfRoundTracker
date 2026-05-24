import { supabase } from '@/lib/supabase';
import type { Profile, DominantHand } from '@/models';
import { toAppError } from './errors';

export const profileRepo = {
  async get(userId: string): Promise<Profile | null> {
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .eq('id', userId)
      .maybeSingle();
    if (error) throw toAppError(error, 'Could not load profile');
    return data ?? null;
  },

  async upsert(profile: {
    id: string;
    email: string;
    first_name?: string | null;
    last_name?: string | null;
    handicap_goal?: number | null;
    dominant_hand?: DominantHand | null;
  }): Promise<Profile> {
    const { data, error } = await supabase
      .from('profiles')
      .upsert(profile, { onConflict: 'id' })
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not save profile');
    return data;
  },

  async update(userId: string, patch: Partial<Profile>): Promise<Profile> {
    const { data, error } = await supabase
      .from('profiles')
      .update(patch)
      .eq('id', userId)
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not update profile');
    return data;
  }
};
