// OpenGolfAPI client (shared)
// ---------------------------------------------------------------------------
// https://opengolfapi.org — an OSM-derived open commons of golf course data
// (ODbL 1.0). Reads are keyless, but a dev key raises the daily quota from 500
// to 10,000 requests, so we always send one when `OPENGOLF_API_KEY` is set.
//
// Set it with:  supabase secrets set OPENGOLF_API_KEY=ogapi_...
//
// LICENCE: course data returned here is © OpenStreetMap contributors under
// ODbL 1.0. Anything we persist from it must keep that attribution — see
// `OPENGOLF_ATTRIBUTION` and the courses.osm_* columns.
// ---------------------------------------------------------------------------

const BASE = 'https://api.opengolfapi.org/api/v1';

export const OPENGOLF_ATTRIBUTION =
  '© OpenStreetMap contributors (ODbL 1.0) via OpenGolfAPI';

/**
 * A course as returned by `/courses/search`, `/courses/state/{code}` and
 * `/courses/bulk`. Note the coordinate keys are `lat`/`lng` on `/api/v1`;
 * the legacy `/v1` alias calls them `latitude`/`longitude`. We only use
 * `/api/v1`, so `lat`/`lng` it is.
 */
export interface OpenGolfCourse {
  id: string;
  course_name: string;
  club_name?: string | null;
  city?: string | null;
  state?: string | null;
  country_iso?: string | null;
  lat?: number | null;
  lng?: number | null;
  type?: string | null;
  par?: number | null;
  holes?: number | null;
}

interface SearchResponse {
  courses?: OpenGolfCourse[];
  total?: number;
}

function authHeaders(): HeadersInit {
  const key = Deno.env.get('OPENGOLF_API_KEY');
  return key ? { Authorization: `Bearer ${key}` } : {};
}

async function get<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
  const url = new URL(`${BASE}${path}`);
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }
  const res = await fetch(url, { headers: { Accept: 'application/json', ...authHeaders() } });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`OpenGolfAPI ${res.status} on ${path}: ${text.slice(0, 300)}`);
  }
  return (await res.json()) as T;
}

/**
 * Search by name, optionally narrowed to a 2-letter US state. `state` is ANDed
 * with `q`, so an inexact name plus the right state returns nothing rather than
 * the wrong course — call again without `state` to widen.
 */
export async function searchCourses(
  q: string,
  opts: { state?: string; limit?: number } = {}
): Promise<OpenGolfCourse[]> {
  const data = await get<SearchResponse>('/courses/search', {
    q,
    state: opts.state,
    limit: opts.limit ?? 10
  });
  return data.courses ?? [];
}

/** All courses in a US state. `max_limit` is 500 per page. */
export async function coursesByState(
  code: string,
  opts: { limit?: number; offset?: number } = {}
): Promise<{ courses: OpenGolfCourse[]; total: number }> {
  const data = await get<SearchResponse>(`/courses/state/${encodeURIComponent(code)}`, {
    limit: opts.limit ?? 500,
    offset: opts.offset ?? 0
  });
  return { courses: data.courses ?? [], total: data.total ?? 0 };
}

/** Batch fetch by id — up to 100 ids per call. */
export async function coursesBulk(ids: string[]): Promise<OpenGolfCourse[]> {
  if (ids.length === 0) return [];
  const data = await get<SearchResponse>('/courses/bulk', { ids: ids.slice(0, 100).join(',') });
  return data.courses ?? [];
}

/** One hole from `/courses/{id}/holes`. Geometry fields exist but are null on
 *  the free tier — only par/handicap/yardages are populated. */
export interface OpenGolfHole {
  number: number;
  par?: number | null;
  handicap_index?: number | null;
  /** Yardage keyed by tee colour, e.g. { blue: 378, white: 337 }. */
  yardages?: Record<string, number> | null;
}

/** One tee set from `/courses/{id}/tees`. */
export interface OpenGolfTee {
  tee_key?: string | null;
  tee_name?: string | null;
  tee_color?: string | null;
  /** "Male" | "Female" — capitalised at source; lowercase before storing. */
  gender?: string | null;
  course_rating?: number | null;
  slope?: number | null;
  par?: number | null;
  yardage?: number | null;
}

export async function courseHoles(id: string): Promise<OpenGolfHole[]> {
  const data = await get<{ holes?: OpenGolfHole[] }>(`/courses/${encodeURIComponent(id)}/holes`, {});
  return data.holes ?? [];
}

export async function courseTees(id: string): Promise<OpenGolfTee[]> {
  const data = await get<{ tees?: OpenGolfTee[] }>(`/courses/${encodeURIComponent(id)}/tees`, {});
  return data.tees ?? [];
}

export function hasOpenGolfKey(): boolean {
  return Boolean(Deno.env.get('OPENGOLF_API_KEY'));
}
