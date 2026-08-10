// tm-integration edge function
// ---------------------------------------------------------------------------
// Server-side proxy to the TournamentManagement (TM) integration API. The
// shared INTEGRATION_API_KEY never reaches the client — it lives here as a Deno
// secret and is injected as the `x-integration-key` header on every TM call.
// Mirrors the `courses-api` pattern: action-routed via the request body, caller
// JWT verified before anything is forwarded.
//
//   { action: 'entitlements' }                    → GET  {TM}/api/integration/players/tournaments
//   { action: 'link' }                            → POST {TM}/api/integration/link
//   { action: 'scorer_assignments' }              → GET  {TM}/api/integration/scorers/assignments
//   { action: 'scores', ...scoreBody }            → POST {TM}/api/integration/scores
//   { action: 'shots',  ...shotBody }             → POST {TM}/api/integration/shots
//
// The caller's identity is always resolved server-side — `grt_athlete_id` from
// the verified JWT, `email` from their profile — so a client can never claim to
// be someone else.
//
// Two kinds of push are authorized here (see docs/SCORER_MODE.md):
//
//   SELF   — the golfer pushing their own round. Attributed to the caller.
//   SCORER — an assigned scorekeeper pushing for one of the 2-4 players in a
//            tee group they were assigned to in TM. Attributed to the ATHLETE,
//            never the caller.
//
// That distinction is the sharpest edge in this file. A scorer push stamped
// with the caller's id would resolve to the SCORER's registration on the TM
// side and land a player's strokes on the wrong leaderboard row.
//
// Deploy:
//   supabase functions deploy tm-integration --no-verify-jwt
//   supabase secrets set TM_BASE_URL=https://your-tm.vercel.app
//   supabase secrets set INTEGRATION_API_KEY=<same value as TM's .env>
//
// Test:
//   curl -X POST 'https://<project>.supabase.co/functions/v1/tm-integration' \
//     -H "Authorization: Bearer $USER_JWT" -H "Content-Type: application/json" \
//     -d '{"action":"entitlements"}'
// ---------------------------------------------------------------------------

import { resolveAuth, serviceClient } from '../_shared/auth.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { errorResponse, jsonResponse } from '../_shared/json.ts';

const TM_BASE_URL = (Deno.env.get('TM_BASE_URL') ?? '').replace(/\/+$/, '');
const INTEGRATION_API_KEY = Deno.env.get('INTEGRATION_API_KEY') ?? '';
// Optional: Vercel "Protection Bypass for Automation" token. Set this if the TM
// deployment keeps Deployment Protection on — it lets server-to-server calls
// through. https://vercel.com/docs/deployment-protection
const TM_BYPASS_TOKEN = Deno.env.get('TM_BYPASS_TOKEN') ?? '';

function tmHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-integration-key': INTEGRATION_API_KEY
  };
  if (TM_BYPASS_TOKEN) {
    h['x-vercel-protection-bypass'] = TM_BYPASS_TOKEN;
    h['x-vercel-set-bypass-cookie'] = 'true';
  }
  return h;
}

function tmHost(): string {
  try {
    return new URL(TM_BASE_URL).host;
  } catch {
    return TM_BASE_URL || '(unset)';
  }
}

/**
 * Fetch a TM endpoint with a hard timeout. A deployed edge function runs in
 * Supabase's cloud, so it can ONLY reach a publicly-routable TM_BASE_URL — a TM
 * on localhost is unreachable and would otherwise stall the request until the
 * function's wall-clock limit, surfacing as an endless client spinner. The
 * timeout turns that into a fast, explicit error instead.
 */
async function tmFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    return await fetch(`${TM_BASE_URL}${path}`, { ...init, signal: ctrl.signal });
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    const err = new Error(
      aborted
        ? `Tournament server at ${tmHost()} did not respond within 10s. If TM is on localhost it isn't reachable from this cloud function — point TM_BASE_URL at a public URL (deployed TM or a tunnel).`
        : `Could not reach the tournament server at ${tmHost()}: ${
            e instanceof Error ? e.message : String(e)
          }`
    );
    (err as Error & { status: number }).status = aborted ? 504 : 502;
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/** Forward a TM response through verbatim, surfacing TM's status + error shape. */
async function relay(res: Response): Promise<Response> {
  const contentType = res.headers.get('content-type') ?? '';
  const text = await res.text();
  const isJson = contentType.includes('application/json');
  let body: unknown = null;
  if (isJson || (text.trim().startsWith('{') && text.trim().endsWith('}'))) {
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = null;
    }
  }

  if (!res.ok) {
    // Vercel Deployment Protection bounces server-to-server calls to an HTML
    // login wall. Detect it and return one actionable line instead of dumping
    // the whole page as the "error message".
    if (!body && /Authentication Required|_vercel_sso|vercel\.com/i.test(text)) {
      return errorResponse(
        502,
        `Tournament server (${tmHost()}) is behind Vercel Deployment Protection, so the integration call was blocked. ` +
          `Disable Deployment Protection for the TM project, or set a Protection Bypass token (supabase secret TM_BYPASS_TOKEN).`
      );
    }
    const message =
      (body as { error?: { message?: string } })?.error?.message ??
      (isJson
        ? `TM request failed (${res.status})`
        : `TM returned HTTP ${res.status} (${contentType || 'no content-type'}) — expected JSON.`);
    return errorResponse(res.status, message, body ?? text.slice(0, 300));
  }
  return jsonResponse(body, 200);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (req.method !== 'POST') return errorResponse(405, 'POST only');
  if (!TM_BASE_URL) return errorResponse(500, 'TM_BASE_URL not configured');
  if (!INTEGRATION_API_KEY) return errorResponse(500, 'INTEGRATION_API_KEY not configured');

  try {
    const auth = await resolveAuth(req);
    const db = serviceClient();

    // The caller's email is the link key on the TM side. Read it from the
    // profile rather than trusting the client.
    const { data: profile } = await db
      .from('profiles')
      .select('email')
      .eq('id', auth.userId)
      .single();
    const email = (profile?.email ?? '').toLowerCase().trim();
    const grtAthleteId = auth.userId;

    const body = await req.json().catch(() => ({}));
    const { action, ...args } = body as { action?: string; [k: string]: unknown };

    switch (action) {
      case 'entitlements':
        return await handleEntitlements(db, email, grtAthleteId);
      case 'link':
        return await handleLink(db, email, grtAthleteId);
      case 'scorer_assignments':
        return await handleScorerAssignments(db, email, grtAthleteId);
      case 'scores':
        return await handlePush(db, 'scores', args, grtAthleteId);
      case 'shots':
        return await handlePush(db, 'shots', args, grtAthleteId);
      default:
        return errorResponse(400, `Unknown action: ${action}`);
    }
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    const message = err instanceof Error ? err.message : 'Unknown error';
    console.error('[tm-integration]', message, err);
    return errorResponse(status, message);
  }
});

// ---------------------------------------------------------------------------
// entitlements — a player's tournaments, tee times, can_start, scorecards.
// Persists/refreshes tm_links as a side effect so "My Tournaments" has a cache.
// ---------------------------------------------------------------------------
async function handleEntitlements(
  db: ReturnType<typeof serviceClient>,
  email: string,
  grtAthleteId: string
): Promise<Response> {
  if (!email) return errorResponse(400, 'Caller has no email on file');

  const path =
    `/api/integration/players/tournaments` +
    `?email=${encodeURIComponent(email)}&grt_athlete_id=${encodeURIComponent(grtAthleteId)}`;
  const res = await tmFetch(path, { headers: tmHeaders() });
  if (!res.ok) return await relay(res);

  const payload = (await res.json()) as {
    data?: { tournaments?: TmTournament[] };
  };
  const tournaments = payload?.data?.tournaments ?? [];
  await upsertLinks(db, grtAthleteId, tournaments);

  return jsonResponse(payload, 200);
}

// ---------------------------------------------------------------------------
// link — explicit email → grt_athlete_id link. Persists returned registration
// ids so we hold the TM ids locally for later score/shot attribution.
// ---------------------------------------------------------------------------
async function handleLink(
  db: ReturnType<typeof serviceClient>,
  email: string,
  grtAthleteId: string
): Promise<Response> {
  if (!email) return errorResponse(400, 'Caller has no email on file');

  const res = await tmFetch(`/api/integration/link`, {
    method: 'POST',
    headers: tmHeaders(),
    body: JSON.stringify({ email, grt_athlete_id: grtAthleteId })
  });
  if (!res.ok) return await relay(res);

  const payload = (await res.json()) as {
    data?: { linked?: number; registrations?: TmLinkReg[] };
  };
  const regs = payload?.data?.registrations ?? [];
  if (regs.length) {
    await db.from('tm_links').upsert(
      regs.map((r) => ({
        user_id: grtAthleteId,
        registration_id: r.id,
        tournament_id: r.tournament_id ?? null,
        registration_status: r.status ?? null,
        updated_at: new Date().toISOString()
      })),
      { onConflict: 'user_id,registration_id' }
    );
  }
  return jsonResponse(payload, 200);
}

// ---------------------------------------------------------------------------
// scorer_assignments — the tee groups this user was assigned to SCORE, and the
// 2-4 players in each. Mirrors handleEntitlements, including the link-on-read
// side effect (TM stamps our user id onto the assignment rows) and the local
// cache write, which is what lets the group list render with no signal.
// ---------------------------------------------------------------------------
async function handleScorerAssignments(
  db: ReturnType<typeof serviceClient>,
  email: string,
  userId: string
): Promise<Response> {
  if (!email) return errorResponse(400, 'Caller has no email on file');

  const path =
    `/api/integration/scorers/assignments` +
    `?email=${encodeURIComponent(email)}&grt_user_id=${encodeURIComponent(userId)}`;
  const res = await tmFetch(path, { headers: tmHeaders() });
  if (!res.ok) return await relay(res);

  const payload = (await res.json()) as { data?: { assignments?: TmAssignment[] } };
  const assignments = payload?.data?.assignments ?? [];
  await upsertScorerAssignments(db, userId, assignments);

  return jsonResponse(payload, 200);
}

// ---------------------------------------------------------------------------
// scores / shots — forward the client body to TM.
//
// Before forwarding we resolve WHO the push belongs to. Two things come out of
// that: whether the caller is allowed to push at all, and which athlete id to
// attribute it to. Getting the second wrong is worse than getting the first
// wrong — a rejected push shows an error, a misattributed one silently posts a
// player's score to somebody else's leaderboard row.
// ---------------------------------------------------------------------------
async function handlePush(
  db: ReturnType<typeof serviceClient>,
  endpoint: 'scores' | 'shots',
  args: Record<string, unknown>,
  callerId: string
): Promise<Response> {
  const registrationId =
    typeof args.registration_id === 'string' ? args.registration_id : null;
  const rtrid =
    typeof args.round_tracking_round_id === 'string'
      ? args.round_tracking_round_id
      : null;

  const auth = await resolvePushAuth(db, callerId, registrationId, rtrid);
  if (!auth) {
    return errorResponse(
      403,
      'You can only push scores for your own rounds, or for players in a tee group you were assigned to score'
    );
  }

  // Attribution. For a SELF push this is the caller, exactly as before. For a
  // SCORER push it is the ATHLETE — and when that athlete has never opened GRT
  // there is no id to send, so the field is OMITTED rather than defaulted to
  // the caller. TM resolves fine without it: registration_id and
  // round_tracking_round_id both come earlier in its resolution order.
  const outbound: Record<string, unknown> = { ...args };
  if (auth.athleteGrtId) {
    outbound.grt_athlete_id = auth.athleteGrtId;
  } else {
    delete outbound.grt_athlete_id;
  }

  const res = await tmFetch(`/api/integration/${endpoint}`, {
    method: 'POST',
    headers: tmHeaders(),
    body: JSON.stringify(outbound)
  });
  return await relay(res);
}

interface PushAuth {
  kind: 'SELF' | 'SCORER';
  /** Athlete id to attribute to. Null means "omit it and let TM resolve". */
  athleteGrtId: string | null;
}

/**
 * Decide whether this caller may push, and on whose behalf. Returns null when
 * they may not.
 */
async function resolvePushAuth(
  db: ReturnType<typeof serviceClient>,
  callerId: string,
  registrationId: string | null,
  rtrid: string | null
): Promise<PushAuth | null> {
  // 1. The round row is the most specific evidence available, so it is checked
  //    first. It also disambiguates a case a plain ownership test gets wrong:
  //    while a scorer is tracking, they ARE rounds.user_id (see the ownership
  //    model in migration 034), so "user_id = caller" alone would classify a
  //    marker push as SELF and stamp the scorer's own athlete id.
  if (rtrid) {
    const { data: round } = await db
      .from('rounds')
      .select('user_id, scoring_mode, scored_by_user_id, tm_registration_id')
      .eq('id', rtrid)
      .maybeSingle();

    if (round) {
      if (round.scoring_mode === 'MARKER') {
        if (round.scored_by_user_id !== callerId) return null;
        const regId = registrationId ?? round.tm_registration_id ?? null;
        const assigned = await scorerAssignmentFor(db, callerId, regId);
        // The round says marker and names this caller as its recorder, so the
        // push is legitimate even if the assignment cache has since gone stale
        // (a group reshuffled mid-round shouldn't strand recorded strokes).
        return { kind: 'SCORER', athleteGrtId: assigned?.athleteGrtId ?? null };
      }
      if (round.user_id === callerId) {
        return { kind: 'SELF', athleteGrtId: callerId };
      }
      return null;
    }
  }

  if (registrationId) {
    // 2. The caller's own registration — the original, unchanged path.
    const { data: link } = await db
      .from('tm_links')
      .select('id')
      .eq('user_id', callerId)
      .eq('registration_id', registrationId)
      .maybeSingle();
    if (link) return { kind: 'SELF', athleteGrtId: callerId };

    // 3. A player in a tee group this caller was assigned to score.
    const assigned = await scorerAssignmentFor(db, callerId, registrationId);
    if (assigned) return { kind: 'SCORER', athleteGrtId: assigned.athleteGrtId };
  }

  return null;
}

/**
 * Is `registrationId` one of the players in a tee group this user is assigned
 * to score? Returns the player's GRT athlete id (null when they have never
 * opened GRT), or null when there is no such assignment.
 */
async function scorerAssignmentFor(
  db: ReturnType<typeof serviceClient>,
  callerId: string,
  registrationId: string | null
): Promise<{ athleteGrtId: string | null } | null> {
  if (!registrationId) return null;

  // NOT maybeSingle(): one scorer is routinely assigned to the same players for
  // round 1 and round 2 of a tournament, which is two rows containing this
  // registration. The athlete's id is the same in both, so the first will do.
  const { data } = await db
    .from('tm_scorer_assignments')
    .select('players')
    .eq('user_id', callerId)
    .contains('players', [{ registration_id: registrationId }])
    .limit(1);

  const row = data?.[0];
  if (!row) return null;

  const player = (row.players as TmAssignmentPlayer[] | null)?.find(
    (p) => p.registration_id === registrationId
  );
  return { athleteGrtId: player?.grt_athlete_id ?? null };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------
async function upsertLinks(
  db: ReturnType<typeof serviceClient>,
  grtAthleteId: string,
  tournaments: TmTournament[]
): Promise<void> {
  if (!tournaments.length) return;
  const rows = tournaments.map((t) => ({
    user_id: grtAthleteId,
    registration_id: t.registration_id,
    tournament_id: t.tournament?.id ?? null,
    tournament_slug: t.tournament?.slug ?? null,
    tournament_name: t.tournament?.name ?? null,
    registration_status: t.registration_status ?? null,
    external_course_id: t.tournament?.external_course_id ?? null,
    division_name: t.division?.name ?? null,
    snapshot: t,
    updated_at: new Date().toISOString()
  }));
  await db.from('tm_links').upsert(rows, { onConflict: 'user_id,registration_id' });
}

interface TmTournament {
  registration_id: string;
  registration_status?: string;
  tournament?: {
    id?: string;
    name?: string;
    slug?: string;
    status?: string;
    external_course_id?: string | null;
  };
  division?: { id?: string; name?: string } | null;
  rounds?: unknown[];
}

interface TmLinkReg {
  id: string;
  tournament_id?: string;
  status?: string;
}

/**
 * Cache the scorer's assignments locally. This is not only a render cache —
 * `players` is what resolvePushAuth checks a scorer push against, so a stale or
 * missing row costs a scorer the ability to push. Refreshed on every pull.
 */
async function upsertScorerAssignments(
  db: ReturnType<typeof serviceClient>,
  userId: string,
  assignments: TmAssignment[]
): Promise<void> {
  if (!assignments.length) return;
  const rows = assignments.map((a) => ({
    user_id: userId,
    tee_group_id: a.tee_group_id,
    tournament_id: a.tournament?.id ?? null,
    tournament_slug: a.tournament?.slug ?? null,
    tournament_name: a.tournament?.name ?? null,
    round_number: a.round_number ?? null,
    tee_time: a.tee_time ?? null,
    starting_hole: a.starting_hole ?? null,
    external_course_id: a.tournament?.external_course_id ?? null,
    players: a.players ?? [],
    snapshot: a,
    updated_at: new Date().toISOString()
  }));
  await db
    .from('tm_scorer_assignments')
    .upsert(rows, { onConflict: 'user_id,tee_group_id' });
}

interface TmAssignmentPlayer {
  registration_id: string;
  first_name?: string;
  last_name?: string;
  email?: string | null;
  /** Null when this player has never opened GRT — the round is claimed later. */
  grt_athlete_id?: string | null;
}

interface TmAssignment {
  tee_group_id: string;
  round_number?: number;
  tee_time?: string | null;
  starting_hole?: number | null;
  tournament?: {
    id?: string;
    name?: string;
    slug?: string;
    status?: string;
    external_course_id?: string | null;
  };
  players?: TmAssignmentPlayer[];
}
