import { supabase } from '@/lib/supabase';
import type { Course } from '@/models';
import { toAppError } from './errors';

/**
 * Only `name` is required on insert. Every other column is either nullable or
 * has a DB-side default (e.g. `source='user'`, `osm_status='pending'`).
 */
export type CourseInsert = { name: string } & Partial<Omit<Course, 'id' | 'name'>>;

export const courseRepo = {
  /**
   * Returns courses visible to the user:
   *   • all `source = 'api'` library courses (admin-curated, shared with everyone),
   *   • plus any course the user added themselves (`created_by_user = userId`).
   */
  async list(userId: string | null): Promise<Course[]> {
    let query = supabase.from('courses').select('*').order('name', { ascending: true });
    if (userId) {
      query = query.or(`source.eq.api,created_by_user.eq.${userId}`);
    } else {
      query = query.eq('source', 'api');
    }
    const { data, error } = await query;
    if (error) throw toAppError(error, 'Could not load courses');
    return data ?? [];
  },

  async create(payload: CourseInsert): Promise<Course> {
    const { data, error } = await supabase
      .from('courses')
      .insert(payload)
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not create course');
    return data;
  }
};
