// courses-api edge function
// ---------------------------------------------------------------------------
// Admin-gated proxy to GolfCourseAPI. The client never sees the API key.
// Action-routed via request body: { action: 'search' | 'import' | 'bulkImport', ...args }
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
    requireAdmin(auth);

    const body = await req.json().catch(() => ({}));
    const { action, ...args } = body as { action?: string; [k: string]: unknown };

    switch (action) {
      case 'search':
        return await handleSearch(String(args.query ?? '').trim());
      case 'import':
        return await handleImport(String(args.courseApiId ?? ''), auth.userId);
      case 'bulkImport':
        return await handleBulkImport(args.courseApiIds as string[], auth.userId);
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
  return await res.json();
}

function mapDetailToCourseRow(detail: GolfCourseDetail, adminUserId: string) {
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
      const { error } = await supabase
        .from('courses')
        .upsert(row, { onConflict: 'course_api_id' });
      if (error) throw new Error(error.message);
      imported++;
    } catch (err) {
      failed.push({ id, error: err instanceof Error ? err.message : 'Unknown' });
    }
    await new Promise((r) => setTimeout(r, BULK_GAP_MS));
  }

  return jsonResponse({ imported, failed });
}
