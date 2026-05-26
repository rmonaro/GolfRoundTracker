// sync-course-osm edge function
// ---------------------------------------------------------------------------
// Pulls OSM golf features via Overpass, normalizes them into holes + hole_features,
// and writes results back to Supabase. Designed for:
//   • Manual single-course resync from the admin panel.
//   • Cron-driven batch sync (see migrations/008_osm_sync_cron.sql).
//
// Deploy:
//   supabase functions deploy sync-course-osm --no-verify-jwt
//
// Manual single-course (admin JWT):
//   curl -X POST "https://$PROJECT.supabase.co/functions/v1/sync-course-osm" \
//     -H "Authorization: Bearer $USER_JWT" \
//     -H "Content-Type: application/json" \
//     -d '{"courseId":"<uuid>"}'
//
// Cron batch (uses service-role key in pg_cron):
//   { "syncAll": true }  -> processes up to 100 pending API-sourced courses
//   { }                  -> processes up to 10 pending API-sourced courses
// ---------------------------------------------------------------------------

import { resolveAuth, requireAdmin, serviceClient } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/json.ts';
import {
  bboxContains,
  bboxOf,
  centroid,
  expandBBox,
  haversineMeters,
  pathLengthMeters,
  rotationRadians,
  type BBox,
  type LngLat
} from '../_shared/geo.ts';

// Primary + fallback Overpass mirrors, ordered by data freshness:
//   * overpass-api.de — canonical, fully up-to-date (mod_security gated)
//   * overpass.kumi.systems — usually current, slow under load
//   * overpass.osm.ch — runs an OLD snapshot; returns empty for any course
//     added to OSM since their last sync. Last-resort only.
// The French mirror was removed — 403 "white-listed usages only".
const OVERPASS_MIRRORS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.osm.ch/api/interpreter'
];
// Browser-style UA. Combined with Origin + Referer matching Overpass Turbo,
// this gets past the mod_security 406 on overpass-api.de.
const OVERPASS_UA =
  'Mozilla/5.0 (compatible; GolfRoundTracker/1.0; +https://example.com)';
// Mimic Overpass Turbo's request envelope. mod_security on overpass-api.de
// returns 406 on `Accept: application/json` + bot-like UA combos, but accepts
// `Accept: */*` + a Turbo-origin Referer (the public Turbo UI is whitelisted).
const OVERPASS_BROWSER_HEADERS = {
  Accept: '*/*',
  Origin: 'https://overpass-turbo.eu',
  Referer: 'https://overpass-turbo.eu/'
} as const;
const BATCH_DEFAULT = 10;
const BATCH_SYNC_ALL = 100;
const PER_COURSE_GAP_MS = 2000;

// ---------------------------------------------------------------------------
// OSM types (minimal subset of what Overpass returns)
// ---------------------------------------------------------------------------

interface OverpassNode {
  type: 'node';
  id: number;
  lat: number;
  lon: number;
  tags?: Record<string, string>;
}
interface OverpassWay {
  type: 'way';
  id: number;
  geometry?: Array<{ lat: number; lon: number }>;
  tags?: Record<string, string>;
}
interface OverpassRelation {
  type: 'relation';
  id: number;
  members?: Array<{
    type: 'way' | 'node';
    geometry?: Array<{ lat: number; lon: number }>;
  }>;
  tags?: Record<string, string>;
}
type OverpassElement = OverpassNode | OverpassWay | OverpassRelation;

// ---------------------------------------------------------------------------
// HTTP entrypoint
// ---------------------------------------------------------------------------

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse(405, 'POST only');

  // Service-role calls (pg_cron) skip the JWT verify and proceed as admin.
  // Per-user calls must be from an admin.
  const isServiceRole =
    req.headers.get('Authorization')?.includes(Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '__none__') ??
    false;

  try {
    // ?action=recalc-distances — one-time backfill of the two distance columns
    // for already-synced holes. Service role only (manual trigger after deploy).
    // Computes from cached `centerline` + tee/green coords; never re-hits Overpass.
    const url = new URL(req.url);
    if (url.searchParams.get('action') === 'recalc-distances') {
      if (!isServiceRole) return errorResponse(403, 'Service role required');
      const supabase = serviceClient();
      const result = await recalcAllDistances(supabase);
      return jsonResponse(result);
    }

    if (!isServiceRole) {
      const auth = await resolveAuth(req);
      requireAdmin(auth);
    }

    const body = (await req.json().catch(() => ({}))) as {
      courseId?: string;
      syncAll?: boolean;
      /**
       * Escape hatch: when our edge IPs are blocked by Overpass mirrors, the
       * admin can paste the raw JSON from Overpass Turbo and we'll feed it
       * into the normalize/write logic without calling Overpass ourselves.
       * Accepts the JSON either as a string (what you'd get from a paste) or
       * already-parsed object.
       */
      overpassJson?: string | { elements?: OverpassElement[]; remark?: string };
    };
    const supabase = serviceClient();

    if (body.courseId) {
      let pasted: { elements: OverpassElement[]; remark?: string } | undefined;
      if (body.overpassJson != null) {
        try {
          const parsed =
            typeof body.overpassJson === 'string'
              ? JSON.parse(body.overpassJson)
              : body.overpassJson;
          if (!parsed || !Array.isArray(parsed.elements)) {
            return errorResponse(
              400,
              'pasted overpassJson must contain an `elements` array (paste the full response from Overpass Turbo)'
            );
          }
          pasted = {
            elements: parsed.elements as OverpassElement[],
            remark: typeof parsed.remark === 'string' ? parsed.remark : undefined
          };
        } catch (err) {
          return errorResponse(
            400,
            `pasted overpassJson is not valid JSON: ${
              err instanceof Error ? err.message : 'unknown'
            }`
          );
        }
      }
      const result = await syncOneCourse(supabase, body.courseId, pasted);
      return jsonResponse(result, result.ok ? 200 : 500);
    }

    const limit = body.syncAll ? BATCH_SYNC_ALL : BATCH_DEFAULT;
    const { data: pending, error: pendingErr } = await supabase
      .from('courses')
      .select('id')
      .eq('source', 'api')
      .or('osm_status.eq.pending,osm_synced_at.is.null')
      .order('osm_synced_at', { ascending: true, nullsFirst: true })
      .limit(limit);

    if (pendingErr) return errorResponse(500, 'Could not query pending courses', pendingErr.message);

    const summary: Array<{ courseId: string; status: string; error?: string }> = [];
    for (const row of pending ?? []) {
      try {
        const res = await syncOneCourse(supabase, row.id);
        summary.push({ courseId: row.id, status: res.status, error: res.error });
      } catch (err) {
        summary.push({
          courseId: row.id,
          status: 'failed',
          error: err instanceof Error ? err.message : 'Unknown'
        });
      }
      await sleep(PER_COURSE_GAP_MS);
    }

    return jsonResponse({ processed: summary.length, results: summary });
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[sync-course-osm]', message, err);
    return errorResponse(status, message);
  }
});

// ---------------------------------------------------------------------------
// Per-course orchestration
// ---------------------------------------------------------------------------

interface SyncResult {
  ok: boolean;
  status: 'synced' | 'no_coverage' | 'failed';
  courseId: string;
  holes?: number;
  features?: number;
  error?: string;
  /** Surfaced to admin UI so no_coverage can be diagnosed without digging through function logs. */
  diagnostics?: SyncDiagnostics;
}

interface SyncDiagnostics {
  /** Total elements Overpass returned (before any filtering). */
  overpassElements: number;
  /** Element count keyed by golf=* tag value (e.g. { green: 18, hole: 18, fairway: 18 }). */
  golfTagCounts: Record<string, number>;
  /** Elements that had a golf=* tag but no usable geometry — likely cause of false no_coverage. */
  golfTaggedWithoutGeometry: number;
  /** golf=hole ways missing the `ref` tag — dropped from holes, not added to features either. */
  holeWaysWithoutRef: number;
  /** Overpass "remark" field (server-side warning, e.g. rate limit / partial result). */
  overpassRemark?: string;
  /** Which mirror+method produced the response we used. */
  mirror?: string;
  /** Mirrors+methods we tried in order — useful when all return empty. */
  attemptedMirrors?: string[];
  /** Per-attempt status/body details. Only populated on no_coverage so we can confirm what each mirror sent. */
  attemptDetails?: OverpassAttemptDetail[];
}

async function syncOneCourse(
  supabase: ReturnType<typeof serviceClient>,
  courseId: string,
  pasted?: { elements: OverpassElement[]; remark?: string }
): Promise<SyncResult> {
  const { data: course, error } = await supabase
    .from('courses')
    .select('id, lat, lng, search_radius, source, osm_status')
    .eq('id', courseId)
    .single();

  if (error || !course) {
    return { ok: false, status: 'failed', courseId, error: 'Course not found' };
  }
  // Manual admin sync (via courseId) is allowed for ANY source as long as the
  // course has lat/lng. Batch / cron sync is still gated to source='api' at
  // the query level above. This lets the admin edit a user-added course
  // (add lat/lng + flip osm_status to 'pending') and resync it on demand.
  if (course.lat == null || course.lng == null) {
    await markStatus(supabase, courseId, 'no_coverage', 'Missing lat/lng');
    return { ok: false, status: 'no_coverage', courseId, error: 'Missing lat/lng' };
  }

  const radius = course.search_radius ?? 1500;
  let overpassResp: OverpassResponse;
  if (pasted) {
    // Admin pasted the JSON directly — skip the network call. We still want
    // every downstream step (normalize, write rows, mark status) to behave
    // identically, so we shape the pasted payload like a queryOverpass result.
    overpassResp = {
      elements: pasted.elements,
      remark: pasted.remark,
      mirror: 'pasted-json',
      attemptedMirrors: ['pasted-json']
    };
    console.log(
      `[sync] course=${courseId} using pasted Overpass JSON (${pasted.elements.length} elements)`
    );
  } else {
    try {
      overpassResp = await queryOverpass(course.lat, course.lng, radius);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Overpass failed';
      await markStatus(supabase, courseId, 'failed', msg);
      return { ok: false, status: 'failed', courseId, error: msg };
    }
  }
  const overpass = overpassResp.elements;

  // Build diagnostics from the raw response BEFORE normalization, so we can
  // distinguish "Overpass returned nothing" from "Overpass returned data but
  // normalize dropped everything." These get surfaced in the API response.
  const diagnostics: SyncDiagnostics = {
    overpassElements: overpass.length,
    golfTagCounts: {},
    golfTaggedWithoutGeometry: 0,
    holeWaysWithoutRef: 0,
    overpassRemark: overpassResp.remark,
    mirror: overpassResp.mirror,
    attemptedMirrors: overpassResp.attemptedMirrors,
    // Only attach per-attempt details on empty results so we don't bloat
    // success responses with full HTTP traces.
    attemptDetails: overpass.length === 0 ? overpassResp.attemptDetails : undefined
  };
  for (const el of overpass) {
    const golfTag = (el.tags as Record<string, string> | undefined)?.golf;
    if (!golfTag) continue;
    diagnostics.golfTagCounts[golfTag] =
      (diagnostics.golfTagCounts[golfTag] ?? 0) + 1;
    if (elementCoords(el).length === 0) {
      diagnostics.golfTaggedWithoutGeometry++;
    }
    if (golfTag === 'hole' && el.type === 'way' && !el.tags?.ref) {
      diagnostics.holeWaysWithoutRef++;
    }
  }
  console.log(`[sync] course=${courseId} diagnostics`, diagnostics);

  const { holes, features } = normalizeOverpass(overpass);
  if (holes.length === 0 && features.length === 0) {
    await markStatus(supabase, courseId, 'no_coverage', null);
    return { ok: true, status: 'no_coverage', courseId, diagnostics };
  }

  console.log(`[sync] course=${courseId} holes=${holes.length} features=${features.length}`);

  // Build hole rows with orientation
  const tees = features.filter((f) => f.featureType === 'tee');
  const greens = features.filter((f) => f.featureType === 'green');

  // Fallback: if OSM has no `golf=hole` linestrings (common — many courses only
  // map polygonal features), synthesize one hole per green by pairing with the
  // nearest tee. Numbering is arbitrary (lat-then-lng order); the admin
  // orientation-review queue can re-number / flip later.
  let effectiveHoles = holes;
  if (effectiveHoles.length === 0 && greens.length > 0 && tees.length > 0) {
    effectiveHoles = synthesizeHolesFromPolygons(greens, tees);
    console.log(
      `[sync] synthesized ${effectiveHoles.length} holes from ${greens.length} greens + ${tees.length} tees`
    );
  }
  const holeRows = effectiveHoles.map((h) => buildHoleRow(courseId, h, tees, greens));

  // Assign all non-hole-line features to their nearest hole bbox
  const featureRows = features.map((f) => ({
    courseId,
    holeId: null as string | null, // patched after insert
    osmId: f.osmId,
    featureType: f.featureType,
    isLine: f.isLine,
    coords: f.coords as unknown
  }));

  // Wipe existing holes + features for this course. Surface errors so a silent
  // failure can't leave duplicates that violate the (course_id, hole_number) unique constraint.
  const { error: delFeatErr } = await supabase
    .from('hole_features')
    .delete()
    .eq('course_id', courseId);
  if (delFeatErr) {
    console.error('[sync] hole_features delete failed', delFeatErr);
    await markStatus(supabase, courseId, 'failed', `feature delete: ${delFeatErr.message}`);
    return { ok: false, status: 'failed', courseId, error: `feature delete: ${delFeatErr.message}` };
  }
  const { error: delHoleErr } = await supabase
    .from('holes')
    .delete()
    .eq('course_id', courseId);
  if (delHoleErr) {
    console.error('[sync] holes delete failed', delHoleErr);
    await markStatus(supabase, courseId, 'failed', `hole delete: ${delHoleErr.message}`);
    return { ok: false, status: 'failed', courseId, error: `hole delete: ${delHoleErr.message}` };
  }

  // Insert holes, get their generated ids back
  let insertedHoles: Array<{
    id: string;
    hole_number: number;
    bbox_min_lng: number | null;
    bbox_min_lat: number | null;
    bbox_max_lng: number | null;
    bbox_max_lat: number | null;
  }> = [];
  if (holeRows.length) {
    // Dedupe by hole_number in our own batch (synthesis should never produce dupes,
    // but defend against any future weirdness in buildHoleRow / OSM ref parsing).
    const seen = new Set<number>();
    const dedupedRows = holeRows.filter((h) => {
      if (seen.has(h.holeNumber)) return false;
      seen.add(h.holeNumber);
      return true;
    });
    if (dedupedRows.length !== holeRows.length) {
      console.warn(
        `[sync] deduped ${holeRows.length - dedupedRows.length} hole rows by hole_number`
      );
    }

    // Upsert on (course_id, hole_number) so a leftover row from a partial earlier
    // run can't break us — the unique key guides Postgres to update instead of insert.
    const { data, error: insertErr } = await supabase
      .from('holes')
      .upsert(
        dedupedRows.map((h) => ({
          course_id: h.courseId,
          hole_number: h.holeNumber,
          par: h.par,
          tee_lng: h.tee?.[0] ?? null,
          tee_lat: h.tee?.[1] ?? null,
          green_lng: h.green?.[0] ?? null,
          green_lat: h.green?.[1] ?? null,
          rotation_radians: h.rotationRadians,
          orientation_confidence: h.orientationConfidence,
          bbox_min_lng: h.bbox?.minLng ?? null,
          bbox_min_lat: h.bbox?.minLat ?? null,
          bbox_max_lng: h.bbox?.maxLng ?? null,
          bbox_max_lat: h.bbox?.maxLat ?? null,
          centerline: h.centerline as unknown,
          centerline_distance_m: h.centerlineDistanceM,
          straight_distance_m: h.straightDistanceM
        })),
        { onConflict: 'course_id,hole_number' }
      )
      .select('id, hole_number, bbox_min_lng, bbox_min_lat, bbox_max_lng, bbox_max_lat');
    if (insertErr) {
      console.error('[sync] hole upsert failed', insertErr);
      await markStatus(supabase, courseId, 'failed', `hole upsert: ${insertErr.message}`);
      return { ok: false, status: 'failed', courseId, error: `hole upsert: ${insertErr.message}` };
    }
    insertedHoles = (data ?? []) as typeof insertedHoles;
    console.log(`[sync] upserted ${insertedHoles.length} holes`);
  }

  // Build a quick lookup of (bbox, holeId) for feature assignment
  const holeBoxes = insertedHoles.map((h) => ({
    holeId: h.id as string,
    bbox: {
      minLng: h.bbox_min_lng,
      minLat: h.bbox_min_lat,
      maxLng: h.bbox_max_lng,
      maxLat: h.bbox_max_lat
    } as BBox
  }));

  for (const fr of featureRows) {
    const flatCoords = flatPointArray(fr.coords as LngLat[] | LngLat[][]);
    if (flatCoords.length === 0) continue;
    const c = centroid(flatCoords);
    const owner = holeBoxes.find((hb) => bboxContains(hb.bbox, c));
    if (owner) fr.holeId = owner.holeId;
  }

  let featureCount = 0;
  if (featureRows.length) {
    const { error: featErr } = await supabase.from('hole_features').insert(
      featureRows.map((fr) => ({
        course_id: fr.courseId,
        hole_id: fr.holeId,
        osm_id: fr.osmId,
        feature_type: fr.featureType,
        is_line: fr.isLine,
        coords: fr.coords
      }))
    );
    if (featErr) console.error('[sync] feature insert', featErr);
    else featureCount = featureRows.length;
  }

  await markStatus(supabase, courseId, 'synced', null);
  return {
    ok: true,
    status: 'synced',
    courseId,
    holes: insertedHoles.length,
    features: featureCount,
    diagnostics
  };
}

// ---------------------------------------------------------------------------
// One-time distance backfill (?action=recalc-distances)
// Iterates every hole row in pages and updates centerline_distance_m +
// straight_distance_m from cached `centerline` + tee/green coords. No Overpass.
// ---------------------------------------------------------------------------

interface RecalcResult {
  processed: number;
  updated: number;
  skipped: number;
  errors: number;
}

async function recalcAllDistances(
  supabase: ReturnType<typeof serviceClient>
): Promise<RecalcResult> {
  const pageSize = 500;
  let from = 0;
  const result: RecalcResult = { processed: 0, updated: 0, skipped: 0, errors: 0 };

  while (true) {
    const { data, error } = await supabase
      .from('holes')
      .select('id, tee_lng, tee_lat, green_lng, green_lat, centerline')
      .range(from, from + pageSize - 1);

    if (error) throw new Error(`recalc page query failed: ${error.message}`);
    if (!data || data.length === 0) break;

    for (const h of data) {
      result.processed++;

      let straight: number | null = null;
      if (
        h.tee_lng != null && h.tee_lat != null &&
        h.green_lng != null && h.green_lat != null
      ) {
        straight = haversineMeters(
          [h.tee_lng as number, h.tee_lat as number],
          [h.green_lng as number, h.green_lat as number]
        );
      }

      let centerline: number | null = null;
      const cl = h.centerline as LngLat[] | null;
      if (Array.isArray(cl) && cl.length >= 2) {
        centerline = pathLengthMeters(cl);
      }

      if (straight == null && centerline == null) {
        result.skipped++;
        continue;
      }

      const { error: updErr } = await supabase
        .from('holes')
        .update({
          straight_distance_m: straight,
          centerline_distance_m: centerline
        })
        .eq('id', h.id as string);

      if (updErr) {
        result.errors++;
        console.warn(`[recalc] hole ${h.id} update failed: ${updErr.message}`);
      } else {
        result.updated++;
      }
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  return result;
}

async function markStatus(
  supabase: ReturnType<typeof serviceClient>,
  courseId: string,
  status: 'synced' | 'no_coverage' | 'failed',
  error: string | null
) {
  await supabase
    .from('courses')
    .update({
      osm_status: status,
      osm_synced_at: new Date().toISOString(),
      osm_error: error
    })
    .eq('id', courseId);
}

// ---------------------------------------------------------------------------
// Overpass query + normalization
// ---------------------------------------------------------------------------

interface OverpassResponse {
  elements: OverpassElement[];
  /** Server-side warning (rate limit, partial result, runtime error) — passed through to diagnostics. */
  remark?: string;
  /** Which mirror+method ultimately produced this response (for diagnostics). */
  mirror?: string;
  /** Mirrors+methods we tried — populated even on empty results so admins can diagnose. */
  attemptedMirrors?: string[];
  /** Per-attempt evidence: status code, body length, snippet. Surfaced when every mirror returns empty. */
  attemptDetails?: OverpassAttemptDetail[];
}

interface OverpassAttemptDetail {
  id: string;
  status: number | 'error';
  bodyChars: number;
  /** First 240 chars of the response body — enough to see the JSON envelope or a stray HTML error page. */
  snippet?: string;
  error?: string;
}

async function queryOverpass(lat: number, lng: number, radius: number): Promise<OverpassResponse> {
  // Server-side timeout matches our client-side abort budget so Overpass
  // releases its query slot if we give up. Worst case: 3 mirrors × 2 methods
  // × 20s = 120s — inside Supabase's 150s function budget, with headroom for
  // parse + DB writes. In practice GET-first usually returns on the first
  // attempt and we exit early.
  const PER_ATTEMPT_TIMEOUT_MS = 20_000;
  const query =
    `[out:json][timeout:20];` +
    `(way["golf"](around:${radius},${lat},${lng});` +
    `relation["golf"](around:${radius},${lat},${lng}););` +
    `out geom;`;

  const encoded = encodeURIComponent(query);

  let lastErr = '';
  // If every mirror returns 200 but empty, we'd otherwise have nothing to
  // hand back. Capture the first empty success so the caller still gets the
  // `remark` (rate-limit notice) for diagnostics.
  let emptyFallback: OverpassResponse | null = null;
  const attempted: string[] = [];
  const attemptDetails: OverpassAttemptDetail[] = [];

  for (const baseUrl of OVERPASS_MIRRORS) {
    // Each mirror gets a GET attempt first (matches Overpass Turbo's behavior
    // — empirically the most reliable across the three mirrors), then POST
    // as a fallback for any mirror that gates GET differently.
    for (const method of ['GET', 'POST'] as const) {
      const attemptId = `${method} ${baseUrl}`;
      attempted.push(attemptId);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), PER_ATTEMPT_TIMEOUT_MS);
      try {
        const init: RequestInit =
          method === 'GET'
            ? {
                method: 'GET',
                headers: { ...OVERPASS_BROWSER_HEADERS, 'User-Agent': OVERPASS_UA },
                signal: controller.signal
              }
            : {
                method: 'POST',
                headers: {
                  ...OVERPASS_BROWSER_HEADERS,
                  'Content-Type': 'application/x-www-form-urlencoded',
                  'User-Agent': OVERPASS_UA
                },
                body: `data=${encoded}`,
                signal: controller.signal
              };
        const url = method === 'GET' ? `${baseUrl}?data=${encoded}` : baseUrl;
        const res = await fetch(url, init);
        clearTimeout(timer);
        // Read body once, then JSON.parse — so we can capture a snippet even
        // when JSON parsing fails or the response is HTML (a clear sign of
        // mod_security blocking / a Cloudflare interstitial).
        const bodyText = await res.text();
        attemptDetails.push({
          id: attemptId,
          status: res.status,
          bodyChars: bodyText.length,
          snippet: bodyText.slice(0, 240)
        });
        if (res.ok) {
          let data: { elements?: OverpassElement[]; remark?: string };
          try {
            data = JSON.parse(bodyText);
          } catch {
            lastErr = `${attemptId} → 200 but body is not JSON (likely an HTML interstitial)`;
            console.warn('[overpass]', lastErr);
            continue;
          }
          const elements = (data.elements ?? []) as OverpassElement[];
          const remark = typeof data.remark === 'string' ? data.remark : undefined;
          if (elements.length > 0) {
            console.log(`[overpass] ${attemptId} → ${elements.length} elements`);
            return {
              elements,
              remark,
              mirror: attemptId,
              attemptedMirrors: attempted,
              attemptDetails
            };
          }
          // 200 OK but empty — treat as a soft miss and try the next mirror.
          // Mirrors occasionally cache empty responses or rate-limit silently.
          lastErr = `${attemptId} → 200 but 0 elements${remark ? ` (remark: ${remark})` : ''}`;
          console.warn('[overpass]', lastErr);
          if (!emptyFallback) {
            emptyFallback = {
              elements,
              remark,
              mirror: attemptId,
              attemptedMirrors: attempted,
              attemptDetails
            };
          }
        } else {
          lastErr = `${attemptId} → ${res.status}: ${bodyText.slice(0, 180)}`;
          console.warn('[overpass]', lastErr);
        }
      } catch (err) {
        clearTimeout(timer);
        const reason =
          err instanceof Error
            ? err.name === 'AbortError'
              ? `timeout after ${PER_ATTEMPT_TIMEOUT_MS}ms`
              : err.message
            : 'network';
        lastErr = `${attemptId} → ${reason}`;
        attemptDetails.push({
          id: attemptId,
          status: 'error',
          bodyChars: 0,
          error: reason
        });
        console.warn('[overpass] threw', lastErr);
      }
    }
    // Small back-off before trying the next mirror.
    await new Promise((r) => setTimeout(r, 500));
  }

  // No mirror returned data. If at least one returned 200 with [] we surface
  // that (with its remark) so admins see the genuine "no data here" case.
  if (emptyFallback) {
    return { ...emptyFallback, attemptedMirrors: attempted, attemptDetails };
  }
  throw new Error(
    `All Overpass attempts failed. Last: ${lastErr}. Attempted: ${attempted.join(', ')}`
  );
}

interface NormalizedHoleLine {
  osmId: number;
  ref: string;
  par: number | null;
  coords: LngLat[];
}

interface NormalizedFeature {
  osmId: number;
  featureType: string;
  isLine: boolean;
  coords: LngLat[] | LngLat[][];
}

function elementCoords(el: OverpassElement): LngLat[] {
  if (el.type === 'way') {
    return (el.geometry ?? []).map((g) => [g.lon, g.lat] as LngLat);
  }
  if (el.type === 'relation') {
    // Flatten member geometries — coarse but adequate for centroid + bbox.
    const out: LngLat[] = [];
    for (const m of el.members ?? []) {
      for (const g of m.geometry ?? []) out.push([g.lon, g.lat]);
    }
    return out;
  }
  return [];
}

function normalizeOverpass(elements: OverpassElement[]): {
  holes: NormalizedHoleLine[];
  features: NormalizedFeature[];
} {
  const holes: NormalizedHoleLine[] = [];
  const features: NormalizedFeature[] = [];

  for (const el of elements) {
    const tags = el.tags ?? {};
    const golfTag = tags.golf;
    if (!golfTag) continue;
    const coords = elementCoords(el);
    if (coords.length === 0) continue;

    if (golfTag === 'hole') {
      // Only ways with a `ref` are usable as hole centerlines.
      if (el.type !== 'way' || !tags.ref) continue;
      holes.push({
        osmId: el.id,
        ref: tags.ref,
        par: tags.par ? parseInt(tags.par, 10) || null : null,
        coords
      });
    } else {
      const isLine =
        el.type === 'way' &&
        coords.length >= 2 &&
        (coords[0][0] !== coords[coords.length - 1][0] ||
          coords[0][1] !== coords[coords.length - 1][1]);
      features.push({
        osmId: el.id,
        featureType: golfTag,
        isLine,
        coords: isLine ? coords : [coords]
      });
    }
  }

  return { holes, features };
}

// ---------------------------------------------------------------------------
// Per-hole row build (orientation + bbox)
// ---------------------------------------------------------------------------

interface HoleRowBuild {
  courseId: string;
  holeNumber: number;
  par: number | null;
  tee: LngLat | null;
  green: LngLat | null;
  rotationRadians: number | null;
  orientationConfidence: 'confirmed' | 'reversed' | 'assumed';
  bbox: BBox | null;
  centerline: LngLat[];
  centerlineDistanceM: number | null;
  straightDistanceM: number | null;
}

function buildHoleRow(
  courseId: string,
  hole: NormalizedHoleLine,
  tees: NormalizedFeature[],
  greens: NormalizedFeature[]
): HoleRowBuild {
  const endA = hole.coords[0];
  const endB = hole.coords[hole.coords.length - 1];

  const teeCentroids = tees.map((t) => centroid(flatPointArray(t.coords)));
  const greenCentroids = greens.map((g) => centroid(flatPointArray(g.coords)));

  const nearestTee = nearest(teeCentroids, endA, endB);
  const nearestGreen = nearest(greenCentroids, endA, endB);

  let tee: LngLat | null = null;
  let green: LngLat | null = null;
  let confidence: 'confirmed' | 'reversed' | 'assumed' = 'assumed';

  if (nearestGreen.bestPoint && nearestTee.bestPoint) {
    // Both signals present — figure out which end matches which.
    if (nearestTee.bestEnd === 'A' && nearestGreen.bestEnd === 'B') {
      tee = endA; green = endB; confidence = 'confirmed';
    } else if (nearestTee.bestEnd === 'B' && nearestGreen.bestEnd === 'A') {
      tee = endB; green = endA; confidence = 'reversed';
    } else {
      // Signals agree on the same end — trust the green
      green = nearestGreen.bestEnd === 'A' ? endA : endB;
      tee = nearestGreen.bestEnd === 'A' ? endB : endA;
      confidence = 'assumed';
    }
  } else if (nearestGreen.bestPoint) {
    green = nearestGreen.bestEnd === 'A' ? endA : endB;
    tee = nearestGreen.bestEnd === 'A' ? endB : endA;
    confidence = 'assumed';
  } else if (nearestTee.bestPoint) {
    tee = nearestTee.bestEnd === 'A' ? endA : endB;
    green = nearestTee.bestEnd === 'A' ? endB : endA;
    confidence = 'assumed';
  } else {
    // No tee/green polygons nearby — fall back to line direction blindly.
    tee = endA;
    green = endB;
    confidence = 'assumed';
  }

  const rotation = rotationRadians(tee, green);
  const bbox = expandBBox(bboxOf(hole.coords), 60);

  const straightDistanceM =
    tee && green ? haversineMeters(tee, green) : null;
  const centerlineDistanceM =
    hole.coords.length >= 2 ? pathLengthMeters(hole.coords) : null;

  const holeNumber = parseInt(hole.ref, 10) || 0;
  return {
    courseId,
    holeNumber,
    par: hole.par,
    tee,
    green,
    rotationRadians: rotation,
    orientationConfidence: confidence,
    bbox,
    centerline: hole.coords,
    centerlineDistanceM,
    straightDistanceM
  };
}

function nearest(points: LngLat[], a: LngLat, b: LngLat): {
  bestPoint: LngLat | null;
  bestEnd: 'A' | 'B' | null;
  bestDist: number;
} {
  let best: { p: LngLat; end: 'A' | 'B'; d: number } | null = null;
  for (const p of points) {
    const dA = haversineMeters(p, a);
    const dB = haversineMeters(p, b);
    if (!best || dA < best.d) best = { p, end: 'A', d: dA };
    if (!best || dB < best.d) best = { p, end: 'B', d: dB };
  }
  return best
    ? { bestPoint: best.p, bestEnd: best.end, bestDist: best.d }
    : { bestPoint: null, bestEnd: null, bestDist: Infinity };
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * Greedy distance-based clustering. Points within `maxMeters` of any point already
 * in a cluster join that cluster; otherwise a new cluster is started. Returns the
 * centroid of each cluster. Good enough for collapsing OSM's "1 hole = many polygons"
 * (multiple tee boxes per hole, multi-tier greens, fringes split out, etc.).
 */
function clusterCentroids(points: LngLat[], maxMeters: number): LngLat[] {
  const clusters: LngLat[][] = [];
  for (const p of points) {
    let joined = false;
    for (const c of clusters) {
      if (c.some((q) => haversineMeters(q, p) <= maxMeters)) {
        c.push(p);
        joined = true;
        break;
      }
    }
    if (!joined) clusters.push([p]);
  }
  return clusters.map((c) => centroid(c));
}

/**
 * Used when OSM has no `golf=hole` linestrings. Clusters greens and tees by
 * proximity to collapse multi-polygon-per-hole tagging, then pairs each green
 * cluster with the nearest tee cluster (within 500 m). Numbering is arbitrary
 * (lat-then-lng); admin orientation review re-numbers later.
 */
function synthesizeHolesFromPolygons(
  greens: NormalizedFeature[],
  tees: NormalizedFeature[]
): NormalizedHoleLine[] {
  const greenPts = greens.map((g) => centroid(flatPointArray(g.coords)));
  const teePts = tees.map((t) => centroid(flatPointArray(t.coords)));

  // Cluster: greens within 80 m are the same hole; tee boxes spread further so 120 m.
  const greenClusters = clusterCentroids(greenPts, 80);
  const teeClusters = clusterCentroids(teePts, 120);

  console.log(
    `[sync] cluster collapse: greens ${greens.length} → ${greenClusters.length}, tees ${tees.length} → ${teeClusters.length}`
  );

  // Stable ordering: south-to-north, then west-to-east.
  greenClusters.sort((a, b) => (a[1] !== b[1] ? a[1] - b[1] : a[0] - b[0]));

  const out: NormalizedHoleLine[] = [];
  let holeNumber = 1;
  for (const gPt of greenClusters) {
    let nearest: LngLat | null = null;
    let nearestDist = Infinity;
    for (const tPt of teeClusters) {
      const d = haversineMeters(gPt, tPt);
      if (d < nearestDist && d < 500) {
        nearestDist = d;
        nearest = tPt;
      }
    }
    if (nearest) {
      out.push({
        osmId: holeNumber, // synthetic — no real OSM id
        ref: String(holeNumber),
        par: null,
        coords: [nearest, gPt]
      });
      holeNumber++;
    }
  }
  return out;
}

/**
 * Normalize either a polygon (LngLat[][]) or a linestring (LngLat[]) to a flat
 * list of points. The previous `Array.isArray(coords[0])` check was ambiguous
 * because BOTH a polygon's outer ring AND a linestring's first point are arrays;
 * we need to check depth, not just type.
 */
function flatPointArray(coords: unknown): LngLat[] {
  if (!Array.isArray(coords) || coords.length === 0) return [];
  const first = coords[0] as unknown;
  // Polygon: coords[0] is an outer ring → its [0] is a point (an array).
  // Linestring: coords[0] is a point → its [0] is a number.
  if (Array.isArray(first) && first.length > 0 && Array.isArray((first as unknown[])[0])) {
    return first as LngLat[];
  }
  // Linestring or single ring already at the right depth.
  return coords as LngLat[];
}
