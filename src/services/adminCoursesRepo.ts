import { supabase } from '@/lib/supabase';
import type { Course, OrientationConfidence } from '@/models';
import { toAppError } from './errors';

/** Sentinel for "no state recorded" in the admin course filters. */
export const NO_STATE = '__none__';

export interface CourseListFilters {
  /** 'all', a 2-letter code, or NO_STATE. */
  state?: string;
  coords?: 'all' | 'missing' | 'present';
  source?: string;
  /** 'all' or a courses.osm_status value (pending / synced / failed / …). */
  osmStatus?: string;
  search?: string;
  limit?: number;
  offset?: number;
}

/**
 * Admin-scoped course queries. RLS bypasses are not required because the
 * caller is an admin user; `is_admin` is checked client-side by AdminGuard
 * before these queries fire, and RLS policies grant admins read access via the
 * existing `courses_select` / `courses_admin_update` policies.
 */
export const adminCoursesRepo = {
  async listAll(): Promise<Course[]> {
    const { rows } = await this.list({ limit: 500 });
    return rows;
  },

  /**
   * A page of courses, filtered in the DATABASE.
   *
   * PostgREST caps a response at 1000 rows. Once the library passed that,
   * `select('*')` silently truncated — and because the list sorts by source
   * descending, 'api' courses sorted last and vanished entirely: the import
   * page said "already imported" (it checks with the service key) while the
   * courses list couldn't show them. Filtering client-side only ever filtered
   * the truncated page, so the filters lied too.
   *
   * Everything that narrows the list therefore has to happen server-side, and
   * the caller pages through with `offset`.
   */
  async list(filters: CourseListFilters = {}): Promise<{ rows: Course[]; total: number }> {
    const limit = Math.min(Math.max(filters.limit ?? 100, 1), 1000);
    const offset = Math.max(filters.offset ?? 0, 0);

    let query = supabase.from('courses').select('*', { count: 'exact' });

    if (filters.state === NO_STATE) query = query.or('state.is.null,state.eq.');
    else if (filters.state && filters.state !== 'all') query = query.eq('state', filters.state);

    if (filters.coords === 'missing') query = query.or('lat.is.null,lng.is.null');
    else if (filters.coords === 'present') {
      query = query.not('lat', 'is', null).not('lng', 'is', null);
    }

    if (filters.source && filters.source !== 'all') query = query.eq('source', filters.source);

    if (filters.osmStatus && filters.osmStatus !== 'all') {
      query = query.eq('osm_status', filters.osmStatus);
    }

    const search = filters.search?.trim();
    if (search) {
      // Escape PostgREST's or() delimiters so a name with a comma or paren
      // can't break out of the filter expression.
      const safe = search.replace(/[,()]/g, ' ');
      query = query.or(`name.ilike.%${safe}%,club_name.ilike.%${safe}%,city.ilike.%${safe}%`);
    }

    const { data, error, count } = await query
      .order('name', { ascending: true })
      .range(offset, offset + limit - 1);
    if (error) throw toAppError(error, 'Could not load courses');
    return { rows: (data ?? []) as Course[], total: count ?? 0 };
  },

  /** Count of courses with no usable coordinates — they can't be OSM-synced
   *  or mapped. Counted in the DB so it's the real number, not the page's. */
  async missingCoordsCount(): Promise<number> {
    const { count, error } = await supabase
      .from('courses')
      .select('id', { count: 'exact', head: true })
      .or('lat.is.null,lng.is.null');
    if (error) throw toAppError(error, 'Could not count courses');
    return count ?? 0;
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
      osm_hole_ref_filter?: string | null;
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

  /**
   * Mark a course verified (visible to every user) or clear it. Routes through
   * the `admin_set_course_verified` SECURITY DEFINER RPC (migration 030) so the
   * is_admin() gate is enforced in the DB and verified_by/at are server-stamped.
   */
  async setVerified(id: string, verified: boolean): Promise<Course> {
    const { data, error } = await supabase.rpc('admin_set_course_verified', {
      course_id: id,
      make_verified: verified
    });
    if (error) throw toAppError(error, 'Could not update verification');
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

  /**
   * How many library courses are still waiting on OSM geometry. Drives the
   * bulk page's queue depth — after a state import this is the number that
   * matters, and it's the only way to tell "nothing to do" from "not running".
   */
  async pendingOsmCount(): Promise<number> {
    const { count, error } = await supabase
      .from('courses')
      .select('id', { count: 'exact', head: true })
      .in('source', ['api', 'opengolf'])
      .or('osm_status.eq.pending,osm_synced_at.is.null');
    if (error) throw toAppError(error, 'Could not count pending courses');
    return count ?? 0;
  },

  /**
   * How many library courses failed their last OSM sync. A course is marked
   * failed the moment a sync starts and only cleared when it finishes, so this
   * also counts syncs whose worker was killed mid-flight.
   */
  async failedOsmCount(): Promise<number> {
    const { count, error } = await supabase
      .from('courses')
      .select('id', { count: 'exact', head: true })
      .in('source', ['api', 'opengolf'])
      .eq('osm_status', 'failed');
    if (error) throw toAppError(error, 'Could not count failed courses');
    return count ?? 0;
  },

  /** Put failed courses back on the OSM queue. Writes go through the admin
   *  update policy from migration 007. */
  async requeueFailedOsm(): Promise<number> {
    const { data, error } = await supabase
      .from('courses')
      .update({ osm_status: 'pending', osm_error: null })
      .in('source', ['api', 'opengolf'])
      .eq('osm_status', 'failed')
      .select('id');
    if (error) throw toAppError(error, 'Could not requeue courses');
    return data?.length ?? 0;
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
