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
   *   • all admin-`verified` courses (shared with everyone, migration 030),
   *   • plus any course the user added themselves (`created_by_user = userId`).
   */
  async list(userId: string | null): Promise<Course[]> {
    let query = supabase.from('courses').select('*').order('name', { ascending: true });
    if (userId) {
      query = query.or(`source.eq.api,verified.eq.true,created_by_user.eq.${userId}`);
    } else {
      query = query.or('source.eq.api,verified.eq.true');
    }
    const { data, error } = await query;
    if (error) throw toAppError(error, 'Could not load courses');
    return data ?? [];
  },

  /**
   * Admin-only: mark a course verified (visible to all users) or clear it.
   * Routes through the `admin_set_course_verified` SECURITY DEFINER RPC so
   * verified_by/verified_at are stamped server-side and the is_admin() gate is
   * enforced in the database, not just the client.
   */
  async setVerified(courseId: string, verified: boolean): Promise<Course> {
    const { data, error } = await supabase.rpc('admin_set_course_verified', {
      course_id: courseId,
      make_verified: verified
    });
    if (error) throw toAppError(error, 'Could not update verification');
    return data as Course;
  },

  async getOne(courseId: string): Promise<Course | null> {
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .eq('id', courseId)
      .maybeSingle();
    if (error) throw toAppError(error, 'Could not load course');
    return (data ?? null) as Course | null;
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
