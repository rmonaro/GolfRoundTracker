import { supabase } from '@/lib/supabase';
import type { Course } from '@/models';
import { toAppError } from './errors';

export const courseRepo = {
  async list(userId: string | null): Promise<Course[]> {
    const query = supabase.from('courses').select('*').order('name', { ascending: true });
    const { data, error } = userId ? await query.eq('created_by_user', userId) : await query;
    if (error) throw toAppError(error, 'Could not load courses');
    return data ?? [];
  },

  async create(payload: Omit<Course, 'id'>): Promise<Course> {
    const { data, error } = await supabase
      .from('courses')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not create course');
    return data;
  }
};
