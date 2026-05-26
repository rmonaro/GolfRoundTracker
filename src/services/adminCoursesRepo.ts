import { supabase } from '@/lib/supabase';
import type { Course, OrientationConfidence } from '@/models';
import { toAppError } from './errors';

/**
 * Admin-scoped course queries. RLS bypasses are not required because the
 * caller is an admin user; `is_admin` is checked client-side by AdminGuard
 * before these queries fire, and RLS policies grant admins read access via the
 * existing `courses_select` / `courses_admin_update` policies.
 */
export const adminCoursesRepo = {
  async listAll(): Promise<Course[]> {
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .order('source', { ascending: false })
      .order('name', { ascending: true });
    if (error) throw toAppError(error, 'Could not load courses');
    return (data ?? []) as Course[];
  },

  async getOne(id: string): Promise<Course | null> {
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .eq('id', id)
      .maybeSingle();
    if (error) throw toAppError(error, 'Could not load course');
    return (data ?? null) as Course | null;
  },

  /**
   * Update OSM-sync-relevant metadata on a course. Used by the admin Edit
   * dialog to fill in lat/lng/search_radius on user-added courses (or fix
   * incorrect coords on imported ones) so they can be synced.
   */
  async updateMetadata(
    id: string,
    fields: {
      lat?: number | null;
      lng?: number | null;
      search_radius?: number | null;
      club_name?: string | null;
      country?: string | null;
      osm_status?: string | null;
      address?: string | null;
      city?: string | null;
      state?: string | null;
      zip?: string | null;
    }
  ): Promise<Course> {
    const { data, error } = await supabase
      .from('courses')
      .update(fields)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw toAppError(error, 'Could not update course');
    return data as Course;
  },

  async stats(): Promise<{
    apiCount: number;
    byStatus: Record<string, number>;
    pendingSync: number;
    lowConfidenceHoles: number;
  }> {
    const { data: apiCourses, error: apiErr } = await supabase
      .from('courses')
      .select('osm_status')
      .eq('source', 'api');
    if (apiErr) throw toAppError(apiErr, 'Could not load stats');
    const byStatus: Record<string, number> = {};
    for (const row of apiCourses ?? []) {
      const k = (row.osm_status as string | null) ?? 'unknown';
      byStatus[k] = (byStatus[k] ?? 0) + 1;
    }
    const apiCount = apiCourses?.length ?? 0;
    const pendingSync = (byStatus.pending ?? 0) + (byStatus.failed ?? 0);

    const { count, error: holesErr } = await supabase
      .from('holes')
      .select('*', { count: 'exact', head: true })
      .in('orientation_confidence', ['assumed', 'reversed']);
    if (holesErr) throw toAppError(holesErr, 'Could not count low-confidence holes');

    return { apiCount, byStatus, pendingSync, lowConfidenceHoles: count ?? 0 };
  },

  async listLowConfidenceHoles(filter: 'all' | 'assumed' | 'reversed') {
    let query = supabase
      .from('holes')
      .select('id, course_id, hole_number, par, orientation_confidence, courses(id, name)')
      .order('course_id')
      .order('hole_number');
    if (filter === 'all') {
      query = query.in('orientation_confidence', ['assumed', 'reversed']);
    } else {
      query = query.eq('orientation_confidence', filter as OrientationConfidence);
    }
    const { data, error } = await query;
    if (error) throw toAppError(error, 'Could not load review queue');
    return (data ?? []) as Array<{
      id: string;
      course_id: string;
      hole_number: number;
      par: number | null;
      orientation_confidence: OrientationConfidence;
      courses: { id: string; name: string } | { id: string; name: string }[] | null;
    }>;
  }
};
