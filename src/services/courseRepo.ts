import { supabase } from '@/lib/supabase';
import type { Course } from '@/models';
import { toAppError } from './errors';

/**
 * Only `name` is required on insert. Every other column is either nullable or
 * has a DB-side default (e.g. `source='user'`, `osm_status='pending'`).
 */
export type CourseInsert = { name: string } & Partial<Omit<Course, 'id' | 'name'>>;

/**
 * The shared-library visibility rule, in PostgREST syntax.
 *
 * A course is offered to players when it has OSM geometry AND comes from a
 * library source: GolfCourseAPI, OpenGolfAPI, or admin-verified. `opengolf` was
 * missing until now, which quietly hid every state-imported course — the app
 * showed 23 courses while 443 were fully synced.
 */
const SHARED_VISIBLE =
  'and(osm_status.eq.synced,or(source.eq.api,source.eq.opengolf,verified.eq.true))';

/** Cap on a single search response. The picker is a list a human scans; more
 *  than this means they should type another word, not scroll further. */
const SEARCH_LIMIT = 50;

export const courseRepo = {
  /**
   * Returns courses visible to the user:
   *   • shared library courses (`source = 'api'`) and admin-`verified` ones,
   *     BUT only where OSM geometry actually landed (`osm_status = 'synced'`),
   *   • plus any course the user added themselves, regardless of sync state.
   *
   * The geometry gate is the point: without holes, tees and greens there is no
   * hole map, no distance-to-green and no shot auto-tracking — the course looks
   * broken rather than basic. A library course the user never asked for is not
   * worth offering in that state.
   *
   * Their OWN courses are deliberately exempt. `create` defaults osm_status to
   * 'pending', so gating those too would make a course vanish the moment it was
   * added, and the natural response to that is to add it again.
   */
  async list(userId: string | null): Promise<Course[]> {
    const shared = SHARED_VISIBLE;
    let query = supabase.from('courses').select('*').order('name', { ascending: true });
    if (userId) {
      query = query.or(`${shared},created_by_user.eq.${userId}`);
    } else {
      query = query.or(shared);
    }
    const { data, error } = await query;
    if (error) throw toAppError(error, 'Could not load courses');
    return data ?? [];
  },

  /**
   * Search the whole library, in the DATABASE.
   *
   * The picker used to filter the preloaded list in the browser, so it could
   * only ever find courses already downloaded — and that list is capped at
   * PostgREST's 1000 rows anyway, so as the library grows a client-side search
   * silently stops seeing most of it. Matching name, club and city server-side
   * means typing a course's name finds it whether or not it was preloaded.
   */
  async search(userId: string | null, term: string): Promise<Course[]> {
    const q = term.trim();
    if (!q) return [];
    // Escape PostgREST's or() delimiters so a name with a comma or bracket
    // can't break out of the filter expression.
    const safe = q.replace(/[,()]/g, ' ');
    const visible = userId ? `${SHARED_VISIBLE},created_by_user.eq.${userId}` : SHARED_VISIBLE;
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .or(visible)
      .or(`name.ilike.%${safe}%,club_name.ilike.%${safe}%,city.ilike.%${safe}%`)
      .order('name', { ascending: true })
      .limit(SEARCH_LIMIT);
    if (error) throw toAppError(error, 'Could not search courses');
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
