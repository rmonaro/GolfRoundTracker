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

/**
 * Courses folded into another as duplicates (migration 040) are hidden here
 * rather than deleted, so this filter is what actually keeps a player from
 * seeing Richter Park twice. It applies to a user's OWN courses too — unlike
 * the sync gate — because a merge is an explicit admin decision that this row
 * is the same place as another one, and offering both is the bug.
 */

/** Cap on a single search response. The picker is a list a human scans; more
 *  than this means they should type another word, not scroll further. */
const SEARCH_LIMIT = 50;

/**
 * Select list that makes a library course prove it is actually PLAYABLE.
 *
 * The two `!inner` embeds are EXISTENCE TESTS, not data. An inner join drops
 * any course with no row on the other side, so this returns only courses that
 * have both:
 *   • `course_tees`   — at least one named tee set, or the setup screen has no
 *                       tees to pick and the round gets no rating/slope/yardages
 *   • `hole_features` — at least one OSM polygon, or the hole map is an empty
 *                       frame: no greens, bunkers or fairways to draw
 *
 * `osm_status = 'synced'` in SHARED_VISIBLE is NOT the same test. A sync can
 * succeed and still land nothing usable — a course whose OSM relation has holes
 * but no mapped features comes back 'synced' with zero polygons, and until now
 * that course sat in the picker looking identical to a fully mapped one right
 * up to the moment the map opened blank.
 *
 * Paired with `limit(1, { referencedTable })` at each call site so the payload
 * carries one throwaway id per course instead of every tee and every bunker —
 * the join is the point, the rows are not.
 */
const PLAYABLE_SELECT = '*, course_tees!inner(id), hole_features!inner(id)';

/**
 * Strip the join artefacts. Callers expect a `Course`, and letting the embedded
 * arrays ride along would put them in the query cache, the round payload and
 * anything else that spreads a course row.
 */
function mergeByName(...lists: Course[][]): Course[] {
  const byId = new Map<string, Course>();
  for (const list of lists) for (const c of list) byId.set(c.id, c);
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function stripEmbeds(rows: unknown[]): Course[] {
  return (rows as Array<Record<string, unknown>>).map((row) => {
    const { course_tees: _t, hole_features: _f, ...course } = row;
    return course as unknown as Course;
  });
}

export const courseRepo = {
  /**
   * Returns courses visible to the user:
   *   • shared library courses (`source = 'api'` / `opengolf`) and
   *     admin-`verified` ones, BUT only where the app can actually play them:
   *     OSM geometry landed (`osm_status = 'synced'`) AND the course has at
   *     least one tee set and at least one mapped polygon (PLAYABLE_SELECT),
   *   • plus any course the user added themselves, regardless of either gate.
   *
   * The gate is the point: without holes, tees and greens there is no hole map,
   * no distance-to-green and no shot auto-tracking — the course looks broken
   * rather than basic. A library course the user never asked for is not worth
   * offering in that state, and 'synced' alone does not prove it (see
   * PLAYABLE_SELECT).
   *
   * Their OWN courses are deliberately exempt from BOTH gates. `create`
   * defaults osm_status to 'pending' and a hand-entered course has no tee rows
   * and no polygons by definition — gating those would make a course vanish the
   * moment it was added, and delete the point of the manual-entry screen. The
   * natural response to a course vanishing is to add it again.
   */
  async list(userId: string | null): Promise<Course[]> {
    // TWO queries, not one, because the two halves are gated differently and an
    // inner join cannot be applied to half a result set. The shared library has
    // to prove it has tees + polygons (PLAYABLE_SELECT); the user's own courses
    // are exempt, exactly as they are exempt from the osm_status gate.
    const sharedQuery = supabase
      .from('courses')
      .select(PLAYABLE_SELECT)
      .is('merged_into', null)
      .or(SHARED_VISIBLE)
      .limit(1, { referencedTable: 'course_tees' })
      .limit(1, { referencedTable: 'hole_features' })
      .order('name', { ascending: true });

    const ownQuery = userId
      ? supabase
          .from('courses')
          .select('*')
          .is('merged_into', null)
          .eq('created_by_user', userId)
          .order('name', { ascending: true })
      : null;

    const [sharedRes, ownRes] = await Promise.all([sharedQuery, ownQuery]);
    if (sharedRes.error) throw toAppError(sharedRes.error, 'Could not load courses');
    if (ownRes?.error) throw toAppError(ownRes.error, 'Could not load courses');

    return mergeByName(stripEmbeds(sharedRes.data ?? []), (ownRes?.data as Course[]) ?? []);
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
    const matches = `name.ilike.%${safe}%,club_name.ilike.%${safe}%,city.ilike.%${safe}%`;

    // Same split as `list`, for the same reason: search must not surface a
    // library course the app can't map, and must not hide one the user typed in
    // themselves.
    const sharedQuery = supabase
      .from('courses')
      .select(PLAYABLE_SELECT)
      .is('merged_into', null)
      .or(SHARED_VISIBLE)
      .or(matches)
      .limit(1, { referencedTable: 'course_tees' })
      .limit(1, { referencedTable: 'hole_features' })
      .order('name', { ascending: true })
      .limit(SEARCH_LIMIT);

    const ownQuery = userId
      ? supabase
          .from('courses')
          .select('*')
          .is('merged_into', null)
          .eq('created_by_user', userId)
          .or(matches)
          .order('name', { ascending: true })
          .limit(SEARCH_LIMIT)
      : null;

    const [sharedRes, ownRes] = await Promise.all([sharedQuery, ownQuery]);
    if (sharedRes.error) throw toAppError(sharedRes.error, 'Could not search courses');
    if (ownRes?.error) throw toAppError(ownRes.error, 'Could not search courses');

    return mergeByName(stripEmbeds(sharedRes.data ?? []), (ownRes?.data as Course[]) ?? []).slice(
      0,
      SEARCH_LIMIT
    );
  },

  /**
   * Exact lookup by GolfCourseAPI id, bypassing the playable gate.
   *
   * `list`/`search` deliberately hide library courses with no tee sets or no
   * polygons, which is right for a picker and wrong for an identity lookup: a
   * tournament names the course it is played at, and "we filtered it out of the
   * browse list" is not a reason to conclude we don't have it. Without this,
   * `useTournamentCourse` would miss the row and re-import it on every start.
   */
  async findByApiId(courseApiId: string): Promise<Course | null> {
    const { data, error } = await supabase
      .from('courses')
      .select('*')
      .eq('course_api_id', courseApiId)
      .is('merged_into', null)
      .limit(1)
      .maybeSingle();
    if (error) throw toAppError(error, 'Could not look up course');
    return data ?? null;
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
