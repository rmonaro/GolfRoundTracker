// spectator-api edge function
// ---------------------------------------------------------------------------
// Serves a read-only live view of an athlete's tournament round to someone
// holding a share code. The viewer has no account and no Supabase session — the
// code is the whole credential — so every request re-validates it and this
// function is the ONLY thing that ever reads round data on their behalf.
//
// Action-routed via request body: { action, code, ... }
//
//   join    code -> athlete name + their tournament rounds
//   feed    code (+ roundId) -> one round with holes and shots
//   layout  code + courseId  -> hole geometry, so the map can draw
//
// Deploy:
//   supabase functions deploy spectator-api --no-verify-jwt
//   (--no-verify-jwt is REQUIRED: a spectator has no JWT to verify.)
//
// What a code can reach, and why that list is short:
//   • Only rounds carrying a tm_registration_id — tournament rounds. A casual
//     round is invisible without the athlete having to remember anything.
//   • Only that athlete's rounds, found through their tm_links registrations.
//   • Scores, shot detail and course geometry. NOT the athlete's live position:
//     recorded shots are minutes old by the time they sync, whereas a live GPS
//     feed of a junior athlete readable by anyone holding a forwarded code is a
//     different kind of thing entirely.
// ---------------------------------------------------------------------------

import { serviceClient } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/json.ts';

/** How many past tournament rounds a spectator can page back through. */
const ROUND_HISTORY = 12;
/**
 * Wrong codes are answered no faster than this.
 *
 * The code space is ~8.5e11 so guessing is not a practical attack, but a
 * uniform floor means a near-miss can't be told from a wild guess by timing,
 * and it caps how fast an automated sweep can run.
 */
const WRONG_CODE_DELAY_MS = 400;

interface Share {
  id: string;
  athlete_user_id: string;
  code: string;
  revoked_at: string | null;
  expires_at: string | null;
}

/** Dashes and spaces are presentation; "abcd efgh" must match "ABCD-EFGH". */
function normaliseCode(raw: unknown): string {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

/**
 * Resolve a code to a live share, or throw.
 *
 * Revoked and expired codes are refused with the same message as an unknown
 * one. Telling the holder of a revoked code that it *used* to work tells them
 * the athlete revoked it, which is not theirs to know.
 */
async function resolveShare(
  supabase: ReturnType<typeof serviceClient>,
  rawCode: unknown
): Promise<Share> {
  const code = normaliseCode(rawCode);
  const reject = async (): Promise<never> => {
    await sleep(WRONG_CODE_DELAY_MS);
    const err = new Error('That code is not valid. Check it and try again.');
    (err as Error & { status: number }).status = 404;
    throw err;
  };

  if (code.length < 6) await reject();

  const { data, error } = await supabase
    .from('spectator_shares')
    .select('id, athlete_user_id, code, revoked_at, expires_at')
    .eq('code', code)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) await reject();

  const share = data as Share;
  if (share.revoked_at) await reject();
  if (share.expires_at && new Date(share.expires_at).getTime() < Date.now()) await reject();
  return share;
}

/** Fire-and-forget usage counter, so an athlete can see a code is being used. */
async function noteView(supabase: ReturnType<typeof serviceClient>, share: Share, seen: number) {
  const { error } = await supabase
    .from('spectator_shares')
    .update({ last_viewed_at: new Date().toISOString(), view_count: seen + 1 })
    .eq('id', share.id);
  if (error) console.error('[spectator] could not record view', error.message);
}

async function athleteName(
  supabase: ReturnType<typeof serviceClient>,
  userId: string
): Promise<string> {
  const { data } = await supabase
    .from('profiles')
    .select('first_name, last_name')
    .eq('id', userId)
    .maybeSingle();
  const name = [data?.first_name, data?.last_name].filter(Boolean).join(' ').trim();
  return name || 'Your athlete';
}

/**
 * Every round this athlete has played in a tournament, newest first.
 *
 * Matched through tm_links.registration_id rather than rounds.user_id. In
 * scorer mode the round belongs to the MARKER until it finishes (migration
 * 034), so a user_id match would show a spectator nothing while the round was
 * actually being played. Self-tracked rounds are unioned in by owner as well,
 * because an athlete can start a tournament round without a marker assigned.
 */
async function tournamentRounds(
  supabase: ReturnType<typeof serviceClient>,
  athleteUserId: string
) {
  const { data: links, error: linkErr } = await supabase
    .from('tm_links')
    .select('registration_id')
    .eq('user_id', athleteUserId);
  if (linkErr) throw new Error(linkErr.message);
  const registrationIds = Array.from(
    new Set(((links ?? []) as Array<{ registration_id: string }>).map((l) => l.registration_id))
  );

  const columns =
    'id, course_id, course_name, started_at, completed_at, holes_played, score, par, score_vs_par, tee_name, tm_round_number, tm_tournament_slug, tm_registration_id, scoring_mode, user_id';

  const byRegistration = registrationIds.length
    ? await supabase
        .from('rounds')
        .select(columns)
        .in('tm_registration_id', registrationIds)
        .order('started_at', { ascending: false })
        .limit(ROUND_HISTORY)
    : { data: [], error: null };
  if (byRegistration.error) throw new Error(byRegistration.error.message);

  const byOwner = await supabase
    .from('rounds')
    .select(columns)
    .eq('user_id', athleteUserId)
    .not('tm_registration_id', 'is', null)
    .order('started_at', { ascending: false })
    .limit(ROUND_HISTORY);
  if (byOwner.error) throw new Error(byOwner.error.message);

  const merged = new Map<string, Record<string, unknown>>();
  for (const r of [...(byRegistration.data ?? []), ...(byOwner.data ?? [])]) {
    merged.set(String((r as { id: string }).id), r as Record<string, unknown>);
  }
  return [...merged.values()]
    .sort(
      (a, b) =>
        new Date(String(b.started_at)).getTime() - new Date(String(a.started_at)).getTime()
    )
    .slice(0, ROUND_HISTORY);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse(405, 'POST only');

  try {
    const body = await req.json().catch(() => ({}));
    const { action, code } = body as { action?: string; code?: string };
    const supabase = serviceClient();

    switch (action) {
      case 'join':
        return await handleJoin(supabase, code);
      case 'feed':
        return await handleFeed(supabase, code, (body as { roundId?: string }).roundId);
      case 'layout':
        return await handleLayout(supabase, code, (body as { courseId?: string }).courseId);
      default:
        return errorResponse(400, `Unknown action: ${action}`);
    }
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Unknown error';
    if (status >= 500) console.error('[spectator-api]', message, err);
    return errorResponse(status, message);
  }
});

/**
 * Redeem a code. Returns just enough for the spectator to confirm they are
 * following the right person and to pick a round.
 */
async function handleJoin(
  supabase: ReturnType<typeof serviceClient>,
  code: unknown
): Promise<Response> {
  const share = await resolveShare(supabase, code);
  const [name, rounds] = await Promise.all([
    athleteName(supabase, share.athlete_user_id),
    tournamentRounds(supabase, share.athlete_user_id)
  ]);
  return jsonResponse({
    athleteName: name,
    // Echoed back grouped, so the spectator can screenshot or re-read it.
    code: `${share.code.slice(0, 4)}-${share.code.slice(4)}`,
    rounds
  });
}

/**
 * One round's live state: the card, and every shot recorded on it.
 *
 * Returned whole rather than as a delta since the last poll. A round is at most
 * a few hundred shots, the client re-renders from it directly, and a cursor
 * would have to cope with shots being edited and deleted after the fact — which
 * they routinely are, when a golfer corrects a hole they already walked off.
 */
async function handleFeed(
  supabase: ReturnType<typeof serviceClient>,
  code: unknown,
  roundId: string | undefined
): Promise<Response> {
  const share = await resolveShare(supabase, code);
  const rounds = await tournamentRounds(supabase, share.athlete_user_id);
  if (rounds.length === 0) {
    return jsonResponse({
      athleteName: await athleteName(supabase, share.athlete_user_id),
      round: null,
      rounds: [],
      holes: [],
      shots: [],
      fetchedAt: new Date().toISOString()
    });
  }

  // Default to the newest round, which during a tournament is the one in play.
  const round =
    (roundId && rounds.find((r) => String(r.id) === roundId)) || rounds[0];
  const id = String(round.id);

  const [holesRes, shotsRes, name] = await Promise.all([
    supabase
      .from('round_holes')
      .select('*')
      .eq('round_id', id)
      .order('hole_number', { ascending: true }),
    supabase
      .from('shots')
      .select('*')
      .eq('round_id', id)
      .order('created_at', { ascending: true }),
    athleteName(supabase, share.athlete_user_id)
  ]);
  if (holesRes.error) throw new Error(holesRes.error.message);
  if (shotsRes.error) throw new Error(shotsRes.error.message);

  // Shots carry a club_id into the global `clubs` catalogue, which a spectator
  // has no session to read. Resolve the names here so "7 Iron" reaches them as
  // words rather than a uuid.
  const shots = (shotsRes.data ?? []) as Array<{ club_id: string | null }>;
  const clubIds = Array.from(
    new Set(shots.map((s) => s.club_id).filter((id): id is string => Boolean(id)))
  );
  const clubs: Record<string, string> = {};
  if (clubIds.length) {
    const { data: clubRows, error: clubErr } = await supabase
      .from('clubs')
      .select('id, name')
      .in('id', clubIds);
    if (clubErr) console.error('[spectator] could not load clubs', clubErr.message);
    for (const c of (clubRows ?? []) as Array<{ id: string; name: string }>) {
      clubs[c.id] = c.name;
    }
  }

  await noteView(supabase, share, 0);

  return jsonResponse({
    athleteName: name,
    round,
    rounds,
    holes: holesRes.data ?? [],
    shots: shotsRes.data ?? [],
    clubs,
    fetchedAt: new Date().toISOString()
  });
}

/**
 * Course geometry for the hole map.
 *
 * The whole course goes over at once (~300 KB before compression for a busy
 * one) rather than hole by hole. The client already knows how to turn
 * `{ holes, features }` into a single hole's layout — `assignFeaturesToHole`
 * does it for downloaded courses — so sending the same shape means the
 * spectator map reuses that code instead of a parallel implementation, and it
 * is fetched once per round rather than once per hole.
 *
 * Gated on a valid code like everything else. The geometry is OSM-derived and
 * public, but there is no reason to serve it to someone who isn't watching.
 */
async function handleLayout(
  supabase: ReturnType<typeof serviceClient>,
  code: unknown,
  courseId: string | undefined
): Promise<Response> {
  const share = await resolveShare(supabase, code);
  if (!courseId) return errorResponse(400, 'courseId is required');

  // The course must be one the athlete actually played, or a code becomes a
  // general-purpose reader of the course library.
  const rounds = await tournamentRounds(supabase, share.athlete_user_id);
  if (!rounds.some((r) => String(r.course_id) === courseId)) {
    return errorResponse(403, 'That course is not part of a round you can watch');
  }

  const [holesRes, featuresRes, courseRes] = await Promise.all([
    supabase.from('holes').select('*').eq('course_id', courseId).order('hole_number'),
    supabase.from('hole_features').select('*').eq('course_id', courseId),
    supabase
      .from('courses')
      .select('id, name, osm_status, city, state')
      .eq('id', courseId)
      .maybeSingle()
  ]);
  if (holesRes.error) throw new Error(holesRes.error.message);
  if (featuresRes.error) throw new Error(featuresRes.error.message);

  return jsonResponse({
    course: courseRes.data ?? null,
    holes: holesRes.data ?? [],
    features: featuresRes.data ?? []
  });
}
