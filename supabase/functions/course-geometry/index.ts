// course-geometry edge function
// ---------------------------------------------------------------------------
// Serves a course's static hole geometry to TournamentManagement (TM), so its
// scorecard replay map draws the same holes this app does instead of guessing.
//
// The mirror image of `tm-integration`: that one pushes rounds INTO TM with the
// shared INTEGRATION_API_KEY; this one lets TM pull course geometry back OUT
// with the same key. No user JWT is involved — the caller is a server, not a
// person — so the key is the whole of the authorization, and the function only
// ever reads course-level geometry. It exposes nothing about users or rounds.
//
//   { action: 'course', course_api_id: '6959' }   → holes + features for one course
//   { action: 'course', course_id: '<uuid>' }     → same, by GRT course id
//
// `course_api_id` is the GolfCourseAPI id, which is what TM stores on its own
// courses as `external_course_id` — the only key the two databases share.
//
// Deploy:
//   supabase functions deploy course-geometry --no-verify-jwt
//   (no-verify-jwt is required: the caller presents the integration key, not a
//   user JWT. The key check below is what gates the function.)
//   supabase secrets set INTEGRATION_API_KEY=<same value as TM's .env>
//
// Test:
//   curl -X POST 'https://<project>.supabase.co/functions/v1/course-geometry' \
//     -H "x-integration-key: $INTEGRATION_API_KEY" -H "Content-Type: application/json" \
//     -d '{"action":"course","course_api_id":"6959"}'
// ---------------------------------------------------------------------------

import { serviceClient } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/json.ts';

const INTEGRATION_API_KEY = Deno.env.get('INTEGRATION_API_KEY') ?? '';

/** Constant-time-ish compare so the key can't be probed a character at a time. */
function keyMatches(presented: string): boolean {
  if (!INTEGRATION_API_KEY || presented.length !== INTEGRATION_API_KEY.length) return false;
  let diff = 0;
  for (let i = 0; i < presented.length; i++) {
    diff |= presented.charCodeAt(i) ^ INTEGRATION_API_KEY.charCodeAt(i);
  }
  return diff === 0;
}

interface HoleRow {
  id: string;
  hole_number: number;
  par: number | null;
  tee_lng: number | null;
  tee_lat: number | null;
  green_lng: number | null;
  green_lat: number | null;
  rotation_radians: number | null;
  orientation_confidence: string | null;
  bbox_min_lng: number | null;
  bbox_min_lat: number | null;
  bbox_max_lng: number | null;
  bbox_max_lat: number | null;
  centerline: unknown;
}

interface FeatureRow {
  hole_id: string | null;
  feature_type: string;
  is_line: boolean | null;
  coords: unknown;
}

// Features the map has a use for. `rough` and `path` are dropped: they cover
// most of the course, so shipping them triples the payload to draw the parts a
// satellite basemap already shows.
const DRAWN_TYPES = new Set([
  'tee',
  'green',
  'fairway',
  'bunker',
  'water_hazard',
  'lateral_water_hazard',
  'pond',
  'water'
]);

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse(405, 'Use POST');
  if (!INTEGRATION_API_KEY) {
    return errorResponse(503, 'INTEGRATION_API_KEY is not configured on this function');
  }
  if (!keyMatches(req.headers.get('x-integration-key') ?? '')) {
    return errorResponse(401, 'Invalid integration key');
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'Body must be JSON');
  }

  const action = String(body.action ?? 'course');
  if (action !== 'course') return errorResponse(400, `Unknown action: ${action}`);

  const courseApiId = body.course_api_id ? String(body.course_api_id) : null;
  const courseId = body.course_id ? String(body.course_id) : null;
  if (!courseApiId && !courseId) {
    return errorResponse(400, 'course_api_id or course_id is required');
  }

  const db = serviceClient();

  const courseQuery = db
    .from('courses')
    .select('id, name, course_api_id, lat, lng, osm_status, osm_synced_at')
    .limit(1);
  const { data: courses, error: courseErr } = courseApiId
    ? await courseQuery.eq('course_api_id', courseApiId)
    : await courseQuery.eq('id', courseId!);
  if (courseErr) return errorResponse(500, courseErr.message);

  const course = courses?.[0];
  if (!course) {
    // A 404 rather than an empty payload: TM should be able to tell "this
    // course was never imported here" from "imported, but OSM had nothing".
    return errorResponse(404, 'No course in GRT with that id');
  }

  const [{ data: holes, error: holeErr }, { data: features, error: featErr }] = await Promise.all([
    db
      .from('holes')
      .select(
        'id, hole_number, par, tee_lng, tee_lat, green_lng, green_lat, rotation_radians,' +
          'orientation_confidence, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat, centerline'
      )
      .eq('course_id', course.id)
      .order('hole_number'),
    db
      .from('hole_features')
      .select('hole_id, feature_type, is_line, coords')
      .eq('course_id', course.id)
  ]);
  if (holeErr) return errorResponse(500, holeErr.message);
  if (featErr) return errorResponse(500, featErr.message);

  // Features are grouped by their stored hole_id. GRT's own reader reassigns
  // them to the nearest hole on read, because the OSM sync's bbox assignment
  // misfiles some — TM only draws them as scenery under the shot dots, so a
  // feature on a neighbouring hole is cosmetic there rather than wrong. The
  // unassigned ones ride along under `course_features` so TM can still draw
  // them if it wants the full picture.
  const byHole = new Map<string, FeatureRow[]>();
  const orphans: FeatureRow[] = [];
  for (const f of (features ?? []) as unknown as FeatureRow[]) {
    if (!DRAWN_TYPES.has(f.feature_type)) continue;
    if (!f.hole_id) {
      orphans.push(f);
      continue;
    }
    const list = byHole.get(f.hole_id);
    if (list) list.push(f);
    else byHole.set(f.hole_id, [f]);
  }

  const shape = (f: FeatureRow) => ({
    type: f.feature_type,
    is_line: Boolean(f.is_line),
    // [[lng,lat],…] for a line, [[[lng,lat],…]] for a polygon — unchanged from
    // how this app stores and draws them.
    coords: f.coords
  });

  return jsonResponse({
    data: {
      course: {
        id: course.id,
        name: course.name,
        course_api_id: course.course_api_id,
        lat: course.lat,
        lng: course.lng,
        // "no_coverage" means OSM had nothing to map here, which is the
        // difference between "TM asked too early" and "there is nothing to get".
        osm_status: course.osm_status,
        osm_synced_at: course.osm_synced_at
      },
      holes: ((holes ?? []) as unknown as HoleRow[]).map((h) => ({
        hole_number: h.hole_number,
        par: h.par,
        tee: h.tee_lat != null && h.tee_lng != null ? { lat: h.tee_lat, lng: h.tee_lng } : null,
        green:
          h.green_lat != null && h.green_lng != null
            ? { lat: h.green_lat, lng: h.green_lng }
            : null,
        rotation_radians: h.rotation_radians,
        orientation_confidence: h.orientation_confidence,
        bbox:
          h.bbox_min_lng != null && h.bbox_min_lat != null
            ? {
                min_lng: h.bbox_min_lng,
                min_lat: h.bbox_min_lat,
                max_lng: h.bbox_max_lng,
                max_lat: h.bbox_max_lat
              }
            : null,
        centerline: h.centerline ?? null,
        features: (byHole.get(h.id) ?? []).map(shape)
      })),
      course_features: orphans.map(shape)
    }
  });
});
