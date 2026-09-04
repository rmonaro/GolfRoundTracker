// courses-api edge function
// ---------------------------------------------------------------------------
// Admin-gated proxy to the external course-data APIs. The client never sees an
// API key. Action-routed via request body: { action, ...args }
//
//   search | import               GolfCourseAPI, any authenticated user
//   bulkImport                    GolfCourseAPI, admin only
//   backfillCoordsPreview/Apply   OpenGolfAPI (ODbL), admin only — fills null
//                                 lat/lng so a course can be OSM-synced
//   scorecardPreview/Apply        OpenGolfAPI (ODbL), admin only — per-hole par
//                                 + stroke index and named tee sets
//   stateImport                   OpenGolfAPI (ODbL), admin only — one page of
//                                 a whole US state; loop on `nextOffset`
//   manualLayout                  admin only — build holes + hole_features from
//                                 tee/green points an admin clicked, for courses
//                                 OSM never mapped
//
// Deploy:
//   supabase functions deploy courses-api --no-verify-jwt
//   (no-verify-jwt is OK because we verify the JWT ourselves via callerClient + is_admin())
//
// Test:
//   curl -X POST 'https://<project>.supabase.co/functions/v1/courses-api' \
//     -H "Authorization: Bearer $USER_JWT" \
//     -H "Content-Type: application/json" \
//     -d '{"action":"search","query":"pebble beach"}'
//
// Note on GolfCourseAPI endpoint shapes:
//   This file assumes the v1 REST conventions: GET /v1/search?search_query=...
//   and GET /v1/courses/{id} with `Authorization: Key {token}` header. Their docs
//   are JS-rendered and could not be auto-verified — adjust the constants below
//   if the actual endpoints differ.
// ---------------------------------------------------------------------------

import { resolveAuth, requireAdmin, serviceClient } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/json.ts';
import {
  bboxOf,
  expandBBox,
  haversineMeters,
  rotationRadians,
  type LngLat
} from '../_shared/geo.ts';
import {
  OPENGOLF_ATTRIBUTION,
  coursesByState as ogCoursesByState,
  courseHoles as ogCourseHoles,
  courseTees as ogCourseTees,
  searchCourses as ogSearchCourses,
  type OpenGolfCourse,
  type OpenGolfHole,
  type OpenGolfTee
} from '../_shared/opengolf.ts';

const GOLF_API_BASE = 'https://api.golfcourseapi.com/v1';
const GOLF_API_KEY = Deno.env.get('GOLFCOURSEAPI_KEY') ?? '';
const BULK_IMPORT_MAX = 50;
const BULK_GAP_MS = 250;

interface GolfCourseSearchHit {
  id: number | string;
  course_name?: string;
  club_name?: string;
  location?: {
    city?: string;
    state?: string;
    country?: string;
    latitude?: number;
    longitude?: number;
  };
  [k: string]: unknown;
}

interface GolfCourseDetail extends GolfCourseSearchHit {
  tees?: unknown;
  holes?: unknown;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse(405, 'POST only');
  if (!GOLF_API_KEY) return errorResponse(500, 'GOLFCOURSEAPI_KEY not configured');

  try {
    const auth = await resolveAuth(req);

    const body = await req.json().catch(() => ({}));
    const { action, ...args } = body as { action?: string; [k: string]: unknown };

    // Per-action authorization. `search` and `import` are available to any
    // authenticated user (so the Start Round picker can offer GolfCourseAPI
    // lookups). `bulkImport` stays admin-only — it's the curated-library tool
    // that walks the API key's quota much faster.
    switch (action) {
      case 'search':
        return await handleSearch(String(args.query ?? '').trim());
      case 'import':
        return await handleImport(String(args.courseApiId ?? ''), auth.userId);
      case 'bulkImport':
        requireAdmin(auth);
        return await handleBulkImport(args.courseApiIds as string[], auth.userId);
      case 'backfillCoordsPreview':
        requireAdmin(auth);
        return await handleBackfillPreview(Number(args.limit ?? 25));
      case 'backfillCoordsApply':
        requireAdmin(auth);
        return await handleBackfillApply(args.updates);
      case 'scorecardPreview':
        requireAdmin(auth);
        return await handleScorecardPreview(String(args.courseId ?? ''));
      case 'stateImport':
        requireAdmin(auth);
        return await handleStateImport(
          String(args.state ?? ''),
          Number(args.offset ?? 0),
          Number(args.limit ?? 250),
          auth.userId
        );
      case 'manualLayout':
        requireAdmin(auth);
        return await handleManualLayout(args);
      case 'scorecardApply':
        requireAdmin(auth);
        return await handleScorecardApply(
          String(args.courseId ?? ''),
          String(args.openGolfId ?? '')
        );
      default:
        return errorResponse(400, `Unknown action: ${action}`);
    }
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[courses-api]', message, err);
    return errorResponse(status, message);
  }
});

// ---------------------------------------------------------------------------
// search — proxy + dedup-flag against already-imported courses
// ---------------------------------------------------------------------------

async function handleSearch(query: string): Promise<Response> {
  if (!query) return errorResponse(400, 'query is required');

  const apiRes = await fetch(
    `${GOLF_API_BASE}/search?search_query=${encodeURIComponent(query)}`,
    { headers: { Authorization: `Key ${GOLF_API_KEY}` } }
  );
  if (!apiRes.ok) {
    const text = await apiRes.text();
    return errorResponse(apiRes.status, 'GolfCourseAPI search failed', text);
  }
  const data = await apiRes.json();
  const hits: GolfCourseSearchHit[] = Array.isArray(data) ? data : (data.courses ?? []);

  // Check which course_api_ids are already in our courses table.
  const ids = hits.map((h) => String(h.id));
  const supabase = serviceClient();
  const { data: existing } = await supabase
    .from('courses')
    .select('course_api_id')
    .in('course_api_id', ids);
  const importedSet = new Set((existing ?? []).map((r) => r.course_api_id));

  const results = hits.map((h) => ({
    courseApiId: String(h.id),
    name: h.course_name ?? '',
    clubName: h.club_name ?? null,
    city: h.location?.city ?? null,
    state: h.location?.state ?? null,
    country: h.location?.country ?? null,
    lat: h.location?.latitude ?? null,
    lng: h.location?.longitude ?? null,
    alreadyImported: importedSet.has(String(h.id))
  }));

  return jsonResponse({ results });
}

// ---------------------------------------------------------------------------
// import — fetch detail and upsert into courses with source='api'
// ---------------------------------------------------------------------------

async function fetchCourseDetail(courseApiId: string): Promise<GolfCourseDetail> {
  const res = await fetch(`${GOLF_API_BASE}/courses/${courseApiId}`, {
    headers: { Authorization: `Key ${GOLF_API_KEY}` }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GolfCourseAPI detail ${res.status}: ${text}`);
  }
  // GolfCourseAPI returns `/courses/{id}` wrapped as `{ course: {...} }`. Some
  // mirrors / older docs show the bare object — defensively handle either.
  // Without this, name/id/location come out undefined and every upsert lands
  // on the same `course_api_id="undefined"` row.
  const json = await res.json();
  return (json?.course ?? json) as GolfCourseDetail;
}

function mapDetailToCourseRow(detail: GolfCourseDetail, adminUserId: string) {
  // Sanity check the unwrap — if we still don't have an id, the API contract
  // changed (or the wrapper is nested deeper). Throw a clear error rather
  // than upserting garbage that's hard to diagnose later.
  if (detail.id == null) {
    throw new Error(
      `GolfCourseAPI detail response is missing \`id\`. Got keys: ${Object.keys(
        detail ?? {}
      ).join(', ')}`
    );
  }
  return {
    name: detail.course_name ?? 'Unknown course',
    club_name: detail.club_name ?? null,
    city: detail.location?.city ?? null,
    state: detail.location?.state ?? null,
    country: detail.location?.country ?? null,
    lat: detail.location?.latitude ?? null,
    lng: detail.location?.longitude ?? null,
    course_api_id: String(detail.id),
    scorecard_external: detail as unknown as Record<string, unknown>,
    source: 'api',
    osm_status: 'pending',
    osm_synced_at: null,
    osm_error: null,
    created_by_user: adminUserId
  };
}

// GolfCourseAPI per-tee shape (defensive — fields may be absent).
interface ApiTee {
  tee_name?: string;
  course_rating?: number;
  slope_rating?: number;
  bogey_rating?: number;
  total_yards?: number;
  total_meters?: number;
  number_of_holes?: number;
  par_total?: number;
  holes?: Array<{ par?: number; yardage?: number; handicap?: number }>;
}

/**
 * Fan out `detail.tees.{male,female}[]` into `course_tees` rows (source='api').
 * Idempotent: re-import upserts on (course_id, source, gender, tee_name) via the
 * unique index from migration 029. Best-effort — a course with no scorecard
 * tees simply gets none (the round-start picker falls back to a free-text tee).
 */
async function upsertApiTees(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  courseId: string,
  detail: GolfCourseDetail
): Promise<void> {
  const tees = detail.tees as Record<string, unknown> | undefined;
  if (!tees || typeof tees !== 'object') return;

  const rows: Record<string, unknown>[] = [];
  for (const gender of ['male', 'female'] as const) {
    const list = tees[gender];
    if (!Array.isArray(list)) continue;
    for (const t of list as ApiTee[]) {
      const name = (t?.tee_name ?? '').trim();
      if (!name) continue;
      rows.push({
        course_id: courseId,
        gender,
        tee_name: name,
        course_rating: t.course_rating ?? null,
        slope_rating: t.slope_rating ?? null,
        bogey_rating: t.bogey_rating ?? null,
        total_yards: t.total_yards ?? null,
        total_meters: t.total_meters ?? null,
        par_total: t.par_total ?? null,
        number_of_holes: t.number_of_holes ?? null,
        holes: Array.isArray(t.holes)
          ? t.holes.map((h) => ({
              par: h?.par ?? null,
              yardage: h?.yardage ?? null,
              handicap: h?.handicap ?? null
            }))
          : null,
        source: 'api'
      });
    }
  }

  if (rows.length === 0) return;
  const { error } = await supabase
    .from('course_tees')
    .upsert(rows, { onConflict: 'course_id,source,gender,tee_name' });
  // Non-fatal: tee data is a nice-to-have; don't fail the whole import over it.
  if (error) console.error('[courses-api] tee upsert failed', error.message);
}

async function handleImport(courseApiId: string, adminUserId: string): Promise<Response> {
  if (!courseApiId) return errorResponse(400, 'courseApiId is required');
  const detail = await fetchCourseDetail(courseApiId);
  const row = mapDetailToCourseRow(detail, adminUserId);
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from('courses')
    .upsert(row, { onConflict: 'course_api_id' })
    .select('*')
    .single();
  if (error) return errorResponse(500, 'Upsert failed', error.message);
  await upsertApiTees(supabase, data.id, detail);
  return jsonResponse({ course: data });
}

// ---------------------------------------------------------------------------
// bulkImport — sequential with 250ms gap, per-id try/catch
// ---------------------------------------------------------------------------

async function handleBulkImport(ids: unknown, adminUserId: string): Promise<Response> {
  if (!Array.isArray(ids)) return errorResponse(400, 'courseApiIds must be an array');
  if (ids.length === 0) return errorResponse(400, 'courseApiIds is empty');
  if (ids.length > BULK_IMPORT_MAX) {
    return errorResponse(400, `Max ${BULK_IMPORT_MAX} ids per call`);
  }

  const supabase = serviceClient();
  let imported = 0;
  const failed: Array<{ id: string; error: string }> = [];

  for (const raw of ids) {
    const id = String(raw);
    try {
      const detail = await fetchCourseDetail(id);
      const row = mapDetailToCourseRow(detail, adminUserId);
      const { data: upserted, error } = await supabase
        .from('courses')
        .upsert(row, { onConflict: 'course_api_id' })
        .select('id')
        .single();
      if (error) throw new Error(error.message);
      await upsertApiTees(supabase, upserted.id, detail);
      imported++;
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : 'Unknown' });
    }
    await new Promise((r) => setTimeout(r, BULK_GAP_MS));
  }

  return jsonResponse({ imported, failed });
}

// ---------------------------------------------------------------------------
// backfillCoords — fill null lat/lng from OpenGolfAPI (ODbL)
// ---------------------------------------------------------------------------
// GolfCourseAPI returns coordinates undocumented and inconsistently, so a slice
// of the library lands with null lat/lng and can never be OSM-synced or mapped.
// OpenGolfAPI carries coordinates on every record, so we match those stranded
// rows by name (+ state) and propose coordinates for an admin to confirm.
//
// Two-step on purpose: name matching is fuzzy, and silently writing the wrong
// club's coordinates onto a course would send the map — and the watch — to the
// wrong place. `preview` proposes, `apply` writes only what the admin ticked.

/** Lowercase, strip punctuation and the noise words every club name shares. */
function normalizeName(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\b(golf|course|club|country|links|the|at|and|cc|gc)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Token-overlap similarity (Dice) on normalized names — 0..1. */
function nameScore(a: string, b: string): number {
  const ta = new Set(normalizeName(a).split(' ').filter(Boolean));
  const tb = new Set(normalizeName(b).split(' ').filter(Boolean));
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return (2 * shared) / (ta.size + tb.size);
}

type Confidence = 'exact' | 'likely' | 'weak';

interface CoordProposal {
  courseId: string;
  courseName: string;
  clubName: string | null;
  city: string | null;
  state: string | null;
  confidence: Confidence;
  score: number;
  match: {
    openGolfId: string;
    name: string;
    city: string | null;
    state: string | null;
    lat: number;
    lng: number;
  } | null;
}

function scoreCandidate(
  course: { name: string; club_name: string | null; city: string | null; state: string | null },
  cand: OpenGolfCourse
): number {
  // Best of three readings of the name. GolfCourseAPI splits a 36-hole club
  // into "Lakes/Meadows" style course names while OpenGolfAPI spells the same
  // course out as "Lakes Meadows At Centennial Golf Club" — so the winning
  // comparison is usually course-name AND club-name concatenated.
  const byCourse = nameScore(course.name, cand.course_name);
  const byClub = course.club_name ? nameScore(course.club_name, cand.course_name) : 0;
  const byCombined = course.club_name
    ? nameScore(`${course.name} ${course.club_name}`, cand.course_name)
    : 0;
  let score = Math.max(byCourse, byClub, byCombined);
  if (course.city && cand.city && normalizeName(course.city) === normalizeName(cand.city)) {
    score += 0.25;
  }
  if (course.state && cand.state && course.state.toUpperCase() !== cand.state.toUpperCase()) {
    score -= 0.5;
  }
  return score;
}

function classify(score: number): Confidence {
  if (score >= 0.95) return 'exact';
  if (score >= 0.6) return 'likely';
  return 'weak';
}

async function proposeCoords(course: {
  id: string;
  name: string;
  club_name: string | null;
  city: string | null;
  state: string | null;
}): Promise<CoordProposal> {
  const state = course.state?.trim() || undefined;

  // `state` is ANDed with `q`, so a full name that differs by one word returns
  // nothing at all ("Centennial Golf Course" + NY → 0 hits, because OpenGolfAPI
  // calls it "Centennial Golf Club"). The distinctive core of the name — noise
  // words stripped — is what actually finds it, so always try that too.
  const core = normalizeName(course.club_name || course.name).split(' ')[0] ?? '';
  const inState: Array<{ q: string; state?: string }> = [{ q: course.name, state }];
  if (course.club_name && course.club_name !== course.name) {
    inState.push({ q: course.club_name, state });
  }
  if (core && state) inState.push({ q: core, state });

  const seen = new Map<string, OpenGolfCourse>();
  const runQuery = async (query: { q: string; state?: string }) => {
    if (!query.q.trim()) return;
    try {
      const hits = await ogSearchCourses(query.q, { state: query.state, limit: 10 });
      for (const h of hits) if (!seen.has(h.id)) seen.set(h.id, h);
    } catch (err) {
      console.error('[backfill] search failed', query.q, err);
    }
  };

  for (const query of inState) await runQuery(query);
  // Only widen past the state once nothing in it matched — an out-of-state
  // course is never the right answer, it just looks like one by name.
  if (seen.size === 0) await runQuery({ q: course.club_name || course.name });

  const withCoords = [...seen.values()].filter(
    (c) => typeof c.lat === 'number' && typeof c.lng === 'number'
  );
  const sameState = state
    ? withCoords.filter((c) => c.state?.toUpperCase() === state.toUpperCase())
    : [];
  const pool = sameState.length > 0 ? sameState : withCoords;

  const ranked = pool
    .map((c) => ({ cand: c, score: scoreCandidate(course, c) }))
    .sort((a, b) => b.score - a.score);

  const best = ranked[0];
  return {
    courseId: course.id,
    courseName: course.name,
    clubName: course.club_name,
    city: course.city,
    state: course.state,
    score: best ? Math.round(best.score * 100) / 100 : 0,
    confidence: classify(best?.score ?? 0),
    match: best
      ? {
          openGolfId: best.cand.id,
          name: best.cand.course_name,
          city: best.cand.city ?? null,
          state: best.cand.state ?? null,
          lat: best.cand.lat as number,
          lng: best.cand.lng as number
        }
      : null
  };
}

async function handleBackfillPreview(limit: number): Promise<Response> {
  const capped = Math.min(Math.max(limit, 1), 100);
  const supabase = serviceClient();
  const { data: courses, error } = await supabase
    .from('courses')
    .select('id, name, club_name, city, state')
    .or('lat.is.null,lng.is.null')
    .order('name')
    .limit(capped);
  if (error) return errorResponse(500, 'Could not load courses', error.message);

  const proposals: CoordProposal[] = [];
  for (const c of courses ?? []) {
    proposals.push(
      await proposeCoords(c as {
        id: string;
        name: string;
        club_name: string | null;
        city: string | null;
        state: string | null;
      })
    );
  }

  return jsonResponse({
    proposals,
    attribution: OPENGOLF_ATTRIBUTION,
    scanned: proposals.length
  });
}

async function handleBackfillApply(rawUpdates: unknown): Promise<Response> {
  if (!Array.isArray(rawUpdates)) return errorResponse(400, 'updates must be an array');
  if (rawUpdates.length === 0) return errorResponse(400, 'updates is empty');
  if (rawUpdates.length > 100) return errorResponse(400, 'Max 100 updates per call');

  const supabase = serviceClient();
  let updated = 0;
  const failed: Array<{ courseId: string; error: string }> = [];

  for (const raw of rawUpdates as Array<Record<string, unknown>>) {
    const courseId = String(raw.courseId ?? '');
    const lat = Number(raw.lat);
    const lng = Number(raw.lng);
    if (!courseId || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      failed.push({ courseId, error: 'courseId, lat and lng are required' });
      continue;
    }
    // Re-sync is what actually turns coordinates into a playable layout, so
    // reset the OSM status too — a course stuck at 'no_coverage' or 'failed'
    // only failed because it had no coordinates to search around.
    const { error } = await supabase
      .from('courses')
      .update({ lat, lng, osm_status: 'pending', osm_error: null })
      .eq('id', courseId);
    if (error) failed.push({ courseId, error: error.message });
    else updated++;
  }

  return jsonResponse({ updated, failed });
}

// ---------------------------------------------------------------------------
// scorecard — per-hole par + stroke index and tee sets from OpenGolfAPI
// ---------------------------------------------------------------------------
// The OpenGolfAPI scorecard is OSM-mapped and community-edited, free, and
// complete on ~90% of US courses. It is also the only source we have for stroke
// index (`holes.handicap`), which net scoring needs and which OSM geometry
// never carries.
//
// Preview shows exactly what would change per hole before anything is written —
// the same shape as the coordinate backfill, and for the same reason: a wrong
// match silently rewrites a course's pars.

interface ScorecardHolePreview {
  holeNumber: number;
  par: { current: number | null; incoming: number | null };
  handicap: { current: number | null; incoming: number | null };
  changed: boolean;
}

/** Resolve which OpenGolfAPI course a local course corresponds to. */
async function resolveOpenGolfId(course: {
  id: string;
  name: string;
  club_name: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
}): Promise<{ openGolfId: string | null; matchName: string | null; confidence: Confidence }> {
  const proposal = await proposeCoords(course);
  if (!proposal.match) return { openGolfId: null, matchName: null, confidence: 'weak' };

  // We already know where this course is, so distance is a far better check
  // than the name — two clubs can share a name, but not a location. Anything
  // beyond ~5km is a different course whatever the name similarity says.
  if (typeof course.lat === 'number' && typeof course.lng === 'number') {
    const km = haversineKm(course.lat, course.lng, proposal.match.lat, proposal.match.lng);
    if (km > 5) {
      return { openGolfId: null, matchName: proposal.match.name, confidence: 'weak' };
    }
    return {
      openGolfId: proposal.match.openGolfId,
      matchName: proposal.match.name,
      confidence: km <= 1.5 ? 'exact' : 'likely'
    };
  }
  return {
    openGolfId: proposal.match.openGolfId,
    matchName: proposal.match.name,
    confidence: proposal.confidence
  };
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function loadCourseForMatch(courseId: string) {
  const supabase = serviceClient();
  const { data, error } = await supabase
    .from('courses')
    .select('id, name, club_name, city, state, lat, lng')
    .eq('id', courseId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) throw new Error('Course not found');
  return data as {
    id: string;
    name: string;
    club_name: string | null;
    city: string | null;
    state: string | null;
    lat: number | null;
    lng: number | null;
  };
}

async function handleScorecardPreview(courseId: string): Promise<Response> {
  if (!courseId) return errorResponse(400, 'courseId is required');
  const course = await loadCourseForMatch(courseId);
  const { openGolfId, matchName, confidence } = await resolveOpenGolfId(course);
  if (!openGolfId) {
    return jsonResponse({
      openGolfId: null,
      matchName,
      confidence,
      holes: [],
      tees: [],
      attribution: OPENGOLF_ATTRIBUTION
    });
  }

  const [incomingHoles, incomingTees] = await Promise.all([
    ogCourseHoles(openGolfId),
    ogCourseTees(openGolfId)
  ]);

  const supabase = serviceClient();
  const { data: existing } = await supabase
    .from('holes')
    .select('hole_number, par, handicap')
    .eq('course_id', courseId);
  const byNumber = new Map<number, { par: number | null; handicap: number | null }>();
  for (const h of existing ?? []) {
    byNumber.set(h.hole_number as number, {
      par: (h.par as number | null) ?? null,
      handicap: (h.handicap as number | null) ?? null
    });
  }

  const holes: ScorecardHolePreview[] = incomingHoles
    .filter((h) => Number.isFinite(h.number))
    .sort((a, b) => a.number - b.number)
    .map((h) => {
      const current = byNumber.get(h.number) ?? { par: null, handicap: null };
      const par = h.par ?? null;
      const handicap = h.handicap_index ?? null;
      return {
        holeNumber: h.number,
        par: { current: current.par, incoming: par },
        handicap: { current: current.handicap, incoming: handicap },
        changed:
          (par !== null && par !== current.par) ||
          (handicap !== null && handicap !== current.handicap)
      };
    });

  return jsonResponse({
    openGolfId,
    matchName,
    confidence,
    holes,
    tees: incomingTees.map((t) => ({
      teeName: t.tee_name ?? null,
      teeColor: t.tee_color ?? null,
      gender: normalizeGender(t.gender),
      courseRating: t.course_rating ?? null,
      slope: t.slope ?? null,
      par: t.par ?? null,
      yardage: t.yardage ?? null
    })),
    attribution: OPENGOLF_ATTRIBUTION
  });
}

/** OpenGolfAPI capitalises gender; `course_tees.gender` only allows lowercase. */
function normalizeGender(raw: string | null | undefined): 'male' | 'female' | null {
  const g = (raw ?? '').trim().toLowerCase();
  return g === 'male' || g === 'female' ? g : null;
}

async function handleScorecardApply(courseId: string, openGolfId: string): Promise<Response> {
  if (!courseId) return errorResponse(400, 'courseId is required');
  if (!openGolfId) return errorResponse(400, 'openGolfId is required');

  const [incomingHoles, incomingTees] = await Promise.all([
    ogCourseHoles(openGolfId),
    ogCourseTees(openGolfId)
  ]);
  if (incomingHoles.length === 0 && incomingTees.length === 0) {
    return errorResponse(404, 'OpenGolfAPI returned no scorecard for that course');
  }

  const supabase = serviceClient();
  const holesUpdated = await applyHoles(supabase, courseId, incomingHoles);
  const teesUpserted = await applyTees(supabase, courseId, incomingHoles, incomingTees);

  // Remember which OpenGolfAPI course this is, so a later re-import skips the
  // name matching entirely. Best-effort: a duplicate id (the same OpenGolfAPI
  // course linked to two local rows) shouldn't fail an otherwise good import.
  const { error: linkErr } = await supabase
    .from('courses')
    .update({ opengolf_id: openGolfId })
    .eq('id', courseId);
  if (linkErr) console.error('[scorecard] could not store opengolf_id', linkErr.message);

  return jsonResponse({
    holesUpdated,
    teesUpserted,
    attribution: OPENGOLF_ATTRIBUTION
  });
}

/**
 * Write par + stroke index onto existing hole rows, creating any hole the OSM
 * sync hasn't produced yet. Geometry columns are left untouched — this import
 * only ever supplies scorecard facts, and blanking a synced layout because the
 * scorecard source has no geometry would be a data-loss bug.
 */
async function applyHoles(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  courseId: string,
  incoming: OpenGolfHole[]
): Promise<number> {
  // Upsert on the (course_id, hole_number) unique key from migration 007, so a
  // hole the OSM sync hasn't produced yet is created and an existing one keeps
  // its geometry — only the columns in the payload are written.
  //
  // Split by which fields the source actually has: PostgREST derives one column
  // list from the union of keys in the batch, so mixing rows that carry a
  // handicap with rows that don't would write NULL over a good stroke index.
  const withBoth: Array<Record<string, unknown>> = [];
  const parOnly: Array<Record<string, unknown>> = [];

  for (const h of incoming) {
    if (!Number.isFinite(h.number)) continue;
    if (h.par == null && h.handicap_index == null) continue;
    const base = { course_id: courseId, hole_number: h.number };
    if (h.handicap_index != null) {
      withBoth.push({ ...base, par: h.par ?? null, handicap: h.handicap_index });
    } else {
      parOnly.push({ ...base, par: h.par });
    }
  }

  let written = 0;
  for (const batch of [withBoth, parOnly]) {
    if (batch.length === 0) continue;
    const { error } = await supabase
      .from('holes')
      .upsert(batch, { onConflict: 'course_id,hole_number' });
    if (error) throw new Error(error.message);
    written += batch.length;
  }
  return written;
}

/**
 * Fan tee sets out into `course_tees` with source='opengolf', keeping the
 * GolfCourseAPI rows (source='api') alongside rather than replacing them —
 * the two sources disagree often enough that the admin wants to see both.
 * Per-hole yardage comes from the holes payload, which keys yardage by tee
 * COLOUR, so a tee with no colour gets ratings but no per-hole list.
 */
async function applyTees(
  // deno-lint-ignore no-explicit-any
  supabase: any,
  courseId: string,
  incomingHoles: OpenGolfHole[],
  incomingTees: OpenGolfTee[]
): Promise<number> {
  const rows: Record<string, unknown>[] = [];
  const sortedHoles = [...incomingHoles].sort((a, b) => a.number - b.number);

  for (const t of incomingTees) {
    const name = (t.tee_name ?? '').trim();
    if (!name) continue;
    const color = (t.tee_color ?? '').trim().toLowerCase() || null;

    const holes = color
      ? sortedHoles.map((h) => ({
          par: h.par ?? null,
          yardage: h.yardages?.[color] ?? null,
          handicap: h.handicap_index ?? null
        }))
      : null;

    rows.push({
      course_id: courseId,
      gender: normalizeGender(t.gender),
      tee_name: name,
      tee_color: color,
      course_rating: t.course_rating ?? null,
      slope_rating: t.slope ?? null,
      par_total: t.par ?? null,
      total_yards: t.yardage ?? null,
      number_of_holes: sortedHoles.length || null,
      holes,
      source: 'opengolf'
    });
  }

  if (rows.length === 0) return 0;

  // Replace rather than upsert: the unique index includes `gender`, and a tee
  // published without one leaves NULL — which never matches in a unique index,
  // so re-importing would quietly stack duplicates. Clearing this source's rows
  // first makes the import idempotent whatever the source publishes. Only
  // source='opengolf' rows are touched; GolfCourseAPI tees are left alone.
  const { error: delErr } = await supabase
    .from('course_tees')
    .delete()
    .eq('course_id', courseId)
    .eq('source', 'opengolf');
  if (delErr) throw new Error(delErr.message);

  const { error } = await supabase.from('course_tees').insert(rows);
  if (error) throw new Error(error.message);
  return rows.length;
}

// ---------------------------------------------------------------------------
// stateImport — pull a whole US state from OpenGolfAPI, one page at a time
// ---------------------------------------------------------------------------
// `/courses/state/{code}` returns up to 500 courses per call with coordinates
// on every record, which is the whole point: courses arrive already mappable,
// so the OSM sync can run without a coordinate backfill first.
//
// Paged rather than all-in-one so the admin page can show progress and so a
// large state can't run past the function's wall clock. The caller loops on
// `nextOffset` until it comes back null.
//
// Existing courses are LINKED, not duplicated: a course already in the library
// (typically imported from GolfCourseAPI) gets its `opengolf_id` set and its
// missing coordinates filled, rather than a second row appearing next to it.

interface StateImportResult {
  state: string;
  total: number;
  scanned: number;
  imported: number;
  linked: number;
  skipped: number;
  /** What got linked to what, so a wrong match is visible rather than silent.
   *  Name matching can't be made perfect, but it can be made reviewable. */
  links: Array<{ courseId: string; localName: string; matchName: string; score: number; km: number | null }>;
  nextOffset: number | null;
  attribution: string;
}

/** Names close enough to be worth a distance check. A single shared generic
 *  token ("Park", "Hill", "Meadows") lands at exactly 0.5, and a state is full
 *  of those, so the bar sits above it. */
const LINK_NAME_MIN = 0.6;
/** Two records of the same course sit within a few hundred metres; 1.5km is
 *  slack for a club-level point vs a course-level one. */
const LINK_DISTANCE_KM = 1.5;
/** Without coordinates there is no distance check to fall back on, so the name
 *  has to carry the whole decision. */
const LINK_NAME_MIN_NO_COORDS = 0.9;

type LocalCourse = {
  id: string;
  name: string;
  club_name: string | null;
  city: string | null;
  state: string | null;
  lat: number | null;
  lng: number | null;
  opengolf_id: string | null;
};

/**
 * Pair every candidate with its best local match, then assign greedily from the
 * strongest pair down.
 *
 * Assigning in iteration order instead would let a weak pair claim a local row
 * that a later, better candidate needed: "Lakes/Fairways" scores 1.0 against the
 * club-level "Centennial Golf Club" but 1.25 against "Lakes Fairways At
 * Centennial Golf Club", which is the record actually wanted. Sorting globally
 * means the right one wins and the club record inserts as its own course.
 */
function planLinks(
  locals: LocalCourse[],
  candidates: OpenGolfCourse[]
): Map<string, LocalCourse> {
  const pairs: Array<{ candidateId: string; local: LocalCourse; score: number }> = [];

  for (const cand of candidates) {
    if (typeof cand.lat !== 'number' || typeof cand.lng !== 'number') continue;
    for (const local of locals) {
      if (local.opengolf_id) continue;

      const hasCoords = typeof local.lat === 'number' && typeof local.lng === 'number';
      // Cheap box test before the trig — a state's worth of courses times a
      // page of candidates is a lot of pairs to score otherwise.
      if (hasCoords) {
        if (Math.abs((local.lat as number) - cand.lat) > 0.02) continue;
        if (Math.abs((local.lng as number) - cand.lng) > 0.02) continue;
      }

      const score = scoreCandidate(local, cand);
      if (hasCoords) {
        if (score < LINK_NAME_MIN) continue;
        const km = haversineKm(local.lat as number, local.lng as number, cand.lat, cand.lng);
        if (km > LINK_DISTANCE_KM) continue;
      } else if (score < LINK_NAME_MIN_NO_COORDS) {
        continue;
      }
      pairs.push({ candidateId: cand.id, local, score });
    }
  }

  pairs.sort((a, b) => b.score - a.score);
  const byCandidate = new Map<string, LocalCourse>();
  const claimed = new Set<string>();
  for (const pair of pairs) {
    if (byCandidate.has(pair.candidateId) || claimed.has(pair.local.id)) continue;
    byCandidate.set(pair.candidateId, pair.local);
    claimed.add(pair.local.id);
  }
  return byCandidate;
}

async function handleStateImport(
  state: string,
  offset: number,
  limit: number,
  adminUserId: string
): Promise<Response> {
  const code = state.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(code)) return errorResponse(400, 'state must be a 2-letter code');

  const pageSize = Math.min(Math.max(Math.trunc(limit) || 250, 1), 500);
  const from = Math.max(Math.trunc(offset) || 0, 0);

  const { courses: incoming, total } = await ogCoursesByState(code, {
    limit: pageSize,
    offset: from
  });

  const supabase = serviceClient();
  // Everything already held for this state, matched in memory — one query
  // beats a lookup per candidate, and a state is at most a few thousand rows.
  const { data: existingRows, error: existingErr } = await supabase
    .from('courses')
    .select('id, name, club_name, city, state, lat, lng, opengolf_id')
    .eq('state', code);
  if (existingErr) return errorResponse(500, 'Could not load existing courses', existingErr.message);

  const existing = (existingRows ?? []) as LocalCourse[];
  const linkedIds = new Set(
    existing.map((c) => c.opengolf_id).filter((id): id is string => Boolean(id))
  );

  const unlinkedCandidates = incoming.filter((c) => !linkedIds.has(c.id));
  const linkPlan = planLinks(existing, unlinkedCandidates);

  const inserts: Array<Record<string, unknown>> = [];
  const links: StateImportResult['links'] = [];
  let linked = 0;
  const skipped = incoming.length - unlinkedCandidates.length;

  for (const cand of unlinkedCandidates) {
    const match = linkPlan.get(cand.id);

    if (match) {
      const patch: Record<string, unknown> = { opengolf_id: cand.id };
      // Only fill what's missing — never overwrite coordinates an admin fixed
      // by hand, or ones GolfCourseAPI already got right.
      if (match.lat == null || match.lng == null) {
        patch.lat = cand.lat ?? null;
        patch.lng = cand.lng ?? null;
        patch.osm_status = 'pending';
        patch.osm_error = null;
      }
      const { error } = await supabase.from('courses').update(patch).eq('id', match.id);
      if (error) return errorResponse(500, 'Could not link course', error.message);
      links.push({
        courseId: match.id,
        localName: match.name,
        matchName: cand.course_name,
        score: Math.round(scoreCandidate(match, cand) * 100) / 100,
        km:
          typeof match.lat === 'number' && typeof match.lng === 'number'
            ? Math.round(
                haversineKm(match.lat, match.lng, cand.lat as number, cand.lng as number) * 100
              ) / 100
            : null
      });
      linked++;
      continue;
    }

    inserts.push({
      name: cand.course_name,
      city: cand.city ?? null,
      state: cand.state ?? code,
      country: cand.country_iso ?? 'US',
      lat: cand.lat ?? null,
      lng: cand.lng ?? null,
      total_par: cand.par ?? null,
      opengolf_id: cand.id,
      source: 'opengolf',
      osm_status: 'pending',
      osm_synced_at: null,
      osm_error: null,
      created_by_user: adminUserId
    });
  }

  let imported = 0;
  if (inserts.length > 0) {
    // Upsert on opengolf_id so re-running a page is a no-op rather than a
    // duplicate — the unique index from migration 037 backs this.
    const { error } = await supabase
      .from('courses')
      .upsert(inserts, { onConflict: 'opengolf_id' });
    if (error) return errorResponse(500, 'Could not import courses', error.message);
    imported = inserts.length;
  }

  const consumed = from + incoming.length;
  const result: StateImportResult = {
    state: code,
    total,
    scanned: incoming.length,
    imported,
    linked,
    skipped,
    links,
    nextOffset: incoming.length > 0 && consumed < total ? consumed : null,
    attribution: OPENGOLF_ATTRIBUTION
  };
  return jsonResponse(result);
}

// ---------------------------------------------------------------------------
// manualLayout — holes from clicked points, for courses OSM never mapped
// ---------------------------------------------------------------------------
// ~2000 courses in the library have no OSM geometry and never will: nobody has
// traced them. Segmentation finds their greens, bunkers and water from aerial
// imagery, but it cannot know which green is the 7th — no source we have
// carries hole identity (GolfCourseAPI's per-hole payload is {par, yardage,
// handicap}; OpenGolfAPI's coordinates are the paid tier).
//
// So identity comes from a human clicking greens in order, and this turns those
// clicks into the same rows the OSM sync produces. Downstream — hole map,
// distance-to-green, auto-tracking — cannot tell the difference.

interface ManualHoleInput {
  number: number;
  tee: LngLat;
  green: LngLat;
  par?: number | null;
}

interface ManualFeatureInput {
  featureType: string;
  /** Outer ring, [lng, lat] pairs. */
  coords: LngLat[];
}

async function handleManualLayout(args: Record<string, unknown>): Promise<Response> {
  const courseId = String(args.courseId ?? '');
  if (!courseId) return errorResponse(400, 'courseId is required');
  const holesIn = (args.holes ?? []) as ManualHoleInput[];
  if (!Array.isArray(holesIn) || holesIn.length === 0) {
    return errorResponse(400, 'holes is required');
  }
  const featuresIn = (args.features ?? []) as ManualFeatureInput[];
  const supabase = serviceClient();

  const holeRows = holesIn
    .filter((h) => Number.isFinite(h.number) && h.tee?.length === 2 && h.green?.length === 2)
    .map((h) => {
      // Same derivation the OSM path uses, so the geometry means the same
      // thing: rotation orients the map tee-up, and the bbox is padded so the
      // hole's features fall inside it.
      const bbox = expandBBox(bboxOf([h.tee, h.green]), 60);
      return {
        course_id: courseId,
        hole_number: h.number,
        par: h.par ?? null,
        tee_lng: h.tee[0],
        tee_lat: h.tee[1],
        green_lng: h.green[0],
        green_lat: h.green[1],
        rotation_radians: rotationRadians(h.tee, h.green),
        // The admin placed both ends by hand, so orientation is not inferred —
        // it is the one thing here we know for certain.
        orientation_confidence: 'manual',
        bbox_min_lng: bbox.minLng,
        bbox_min_lat: bbox.minLat,
        bbox_max_lng: bbox.maxLng,
        bbox_max_lat: bbox.maxLat,
        centerline: [h.tee, h.green],
        centerline_distance_m: haversineMeters(h.tee, h.green),
        straight_distance_m: haversineMeters(h.tee, h.green)
      };
    });

  const { error: holeErr } = await supabase
    .from('holes')
    .upsert(holeRows, { onConflict: 'course_id,hole_number' });
  if (holeErr) return errorResponse(500, 'Could not write holes', holeErr.message);

  const { data: saved, error: readErr } = await supabase
    .from('holes')
    .select('id, hole_number, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat')
    .eq('course_id', courseId);
  if (readErr) return errorResponse(500, 'Could not read holes back', readErr.message);

  // Replace only what a previous manual run wrote. OSM-derived features carry
  // an osm_id; these do not, which is what makes them separable.
  const { error: delErr } = await supabase
    .from('hole_features')
    .delete()
    .eq('course_id', courseId)
    .is('osm_id', null);
  if (delErr) return errorResponse(500, 'Could not clear previous features', delErr.message);

  let featureCount = 0;
  if (featuresIn.length > 0) {
    const rows = featuresIn
      .filter((f) => Array.isArray(f.coords) && f.coords.length >= 3)
      .map((f) => {
        const c = f.coords;
        const cx = c.reduce((s, p) => s + p[0], 0) / c.length;
        const cy = c.reduce((s, p) => s + p[1], 0) / c.length;
        const owner = (saved ?? []).find(
          (h) =>
            cx >= (h.bbox_min_lng as number) &&
            cx <= (h.bbox_max_lng as number) &&
            cy >= (h.bbox_min_lat as number) &&
            cy <= (h.bbox_max_lat as number)
        );
        return {
          course_id: courseId,
          hole_id: owner?.id ?? null,
          osm_id: null,
          feature_type: f.featureType,
          is_line: false,
          coords: [c]
        };
      });
    const { error: featErr } = await supabase.from('hole_features').insert(rows);
    if (featErr) return errorResponse(500, 'Could not write features', featErr.message);
    featureCount = rows.length;
  }

  await supabase
    .from('courses')
    .update({ osm_status: 'synced', osm_error: null, osm_synced_at: new Date().toISOString() })
    .eq('id', courseId);

  return jsonResponse({ holes: holeRows.length, features: featureCount });
}
