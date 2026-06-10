# TournamentManagement ⇄ GolfRoundTracker integration

This document is the contract between the **TournamentManagement (TM)** app and
the **GolfRoundTracker (GRT)** app. TM's side is implemented (endpoints below);
this spec drives the GRT-side work.

The two apps run on **separate Supabase projects** and are loosely coupled by
shared identifiers — no shared database.

## End-to-end flow

1. A player **registers** for a tournament on TM's public page.
2. In **GRT**, the player sees their tournaments by calling TM's
   **entitlements** endpoint (matched by email now; by `jgh_player_id` later).
3. GRT **gates the round start** using the `can_start` flag (true once
   `now ≥ tee_time`).
4. The player records the round in GRT. GRT **pushes each hole** to TM's
   **score webhook** → lands in `scorecards`/`hole_scores` → the DB recompute
   trigger updates TM's **live leaderboard** instantly.
5. GRT **pushes shot/GPS data** to TM (system of record stays GRT). TM stores a
   copy so **parents can replay each shot online** on the public tournament site
   (`/t/<slug>/players/<registrationId>`), and admins see the same in the
   Scoring tab — no per-view calls back to GRT.

## Identifiers & linking

| Key | Where | Purpose |
| --- | --- | --- |
| `email` | TM `registrations.email`, GRT account | Initial link between a registration and a GRT user |
| `grt_athlete_id` | TM `registrations.grt_athlete_id` / `players.grt_athlete_id` | GRT's user id, stored on TM after first connect |
| TM `registration_id` | returned by TM, stored in GRT | TM's id for the registration, stored on GRT's side |
| `round_tracking_round_id` | TM `scorecards.round_tracking_round_id` | GRT's round id, links a TM scorecard ↔ a GRT round |
| `external_course_id` | TM `courses.external_course_id` | golfcourseapi course id — both apps use it to match the course |
| `jgh_player_id` | TM placeholder columns | Future canonical identity (Junior Golf Hub) |

**Linking strategy:** match by `email` initially. On the first authenticated
call, GRT passes its `grt_athlete_id`; TM stamps it on the matching
registrations (and returns the TM `registration_id`s, which GRT should store).
After that, both apps reference each other by id. When JGH lands, switch the
canonical key to `jgh_player_id`.

## Authentication

- **GRT → TM** (entitlements, link, scores, shots): send header
  `x-integration-key: <INTEGRATION_API_KEY>`. Configure the same value in both
  apps. TM rejects missing/invalid keys with `401`.

TM env: `INTEGRATION_API_KEY` (inbound). (`GRT_API_BASE_URL`/`GRT_API_KEY` are
reserved for any future TM→GRT calls; shots are pushed, so no pull is needed.)

---

## Endpoints TM exposes (GRT calls these)

### 1. Entitlements — `GET /api/integration/players/tournaments`

Query: `email` and/or `grt_athlete_id` (at least one). If both are sent, TM
links the `grt_athlete_id` onto the player's registrations.

Response:
```json
{
  "data": {
    "player": { "email": "jack@example.com", "grt_athlete_id": "grt_123" },
    "tournaments": [
      {
        "registration_id": "uuid",
        "registration_status": "CONFIRMED",
        "tournament": {
          "id": "uuid", "name": "2026 Summer Junior Open", "slug": "2026-summer-junior-open",
          "status": "IN_PROGRESS", "number_rounds": 2,
          "start_date": "…", "end_date": "…",
          "external_course_id": "6959", "course_name": "James Baird State Park Gc"
        },
        "division": { "id": "uuid", "name": "Boys 15-18" },
        "rounds": [
          {
            "round_number": 1,
            "tee_time": "2026-06-16T12:00:00Z",
            "starting_hole": 1,
            "can_start": true,
            "can_start_reason": "ok",           // "ok" | "before_tee_time" | "no_tee_time"
            "scorecard": {
              "id": "uuid",
              "round_tracking_round_id": "grt_round_abc",  // null until GRT links one
              "status": "IN_PROGRESS",
              "gross_total": 38, "to_par": 2, "holes_completed": 9
            }
          }
        ]
      }
    ]
  }
}
```

**GRT uses:** `external_course_id` to match the course it already pulled from
golfcourseapi; `can_start` to enable/disable the Start button; `round_number` +
`registration_id` to attribute scores.

### 2. Link — `POST /api/integration/link`

Body: `{ "email": "...", "grt_athlete_id": "..." }`. Stamps `grt_athlete_id`
on all registrations (and players) with that email. Returns:
```json
{ "data": { "linked": 2, "registrations": [ { "id": "uuid", "tournament_id": "uuid", "status": "CONFIRMED" } ] } }
```
GRT should persist the returned TM `registration_id`s.

### 3. Live score webhook — `POST /api/integration/scores`

Call this as each hole is recorded (or in batches). TM resolves the scorecard,
applies strokes, marks it `scoring_source = "GRT"`, stores the
`round_tracking_round_id`, and the recompute trigger updates the leaderboard.

Body:
```json
{
  "round_tracking_round_id": "grt_round_abc",   // preferred link; set this when GRT starts the round
  "registration_id": "uuid",                     // OR resolve via the next 3 fields
  "tournament_slug": "2026-summer-junior-open",
  "grt_athlete_id": "grt_123",                   // or "email"
  "email": "jack@example.com",
  "round_number": 1,
  "status": "IN_PROGRESS",                        // optional: "IN_PROGRESS" | "SUBMITTED"
  "holes": [
    { "hole_number": 1, "strokes": 4, "putts": 2 },
    { "hole_number": 2, "strokes": 5 }
  ]
}
```

**Resolution order:** `round_tracking_round_id` → `registration_id` →
`tournament_slug` + (`grt_athlete_id` | `email`). If no scorecard exists yet,
TM creates one (scaffolding holes/par from the tournament's course). Send
`status: "SUBMITTED"` on the final push to lock the round.

Response: `{ "data": { "scorecard": { "id", "status", "gross_total", "to_par", "holes_completed", "round_tracking_round_id", "scoring_source" } } }`.

**Recommended:** when GRT starts a round, generate the GRT round id and send a
first `/scores` call (even with the first hole) including
`round_tracking_round_id` + `registration_id` so the link is established early.

### 4. Shot/GPS push — `POST /api/integration/shots`

GRT pushes shot/GPS for a round so TM can render the **public parent replay**
and the admin map. Same scorecard resolution as `/scores`. Re-sends are
idempotent — the shots for each hole provided are **replaced**.

Body:
```json
{
  "round_tracking_round_id": "grt_round_abc",
  "registration_id": "uuid",            // or tournament_slug + (grt_athlete_id|email)
  "round_number": 1,
  "holes": [
    {
      "hole_number": 1,
      "shots": [
        { "sequence": 1, "lat": 41.781, "lng": -73.747, "club": "Driver", "distance_yards": 268, "result": "fairway" },
        { "sequence": 2, "lat": 41.783, "lng": -73.745, "club": "7i",     "distance_yards": 158, "result": "green" },
        { "sequence": 3, "lat": 41.7831, "lng": -73.7449, "club": "Putter", "distance_yards": 18, "result": "holed" }
      ]
    }
  ]
}
```
Response: `{ "data": { "scorecard_id", "shots_written", "holes" } }`.

Push shots as the player finishes each hole (or in a batch at round end). The
public replay shows them at `/t/<slug>/players/<registrationId>` (linked from
every leaderboard row).

---

## TM-side reference (already implemented)

- Columns: `registrations.grt_athlete_id`, `players.grt_athlete_id`,
  `scorecards.scoring_source` (`MANUAL` | `GRT`), `scorecards.round_tracking_round_id`.
- `shots` table (per-shot GPS), with admin RLS + public RPCs
  `get_public_player_rounds`, `get_public_round_shots`.
- Routes: `src/app/api/integration/{players/tournaments,link,scores,shots}`,
  admin `src/app/api/scorecards/[id]/shots`, public `src/app/api/public/rounds/[scorecardId]/shots`.
- Public replay page: `src/app/t/[slug]/players/[registrationId]/page.tsx`
  (linked from every leaderboard row). Shared view: `src/components/ShotReplayView.tsx`.
- Libs: `src/lib/integration.ts` (key check), `src/lib/integrationScorecard.ts` (resolver).
- Migrations: `…125000_grt_integration.sql`, `…125500_shots.sql`.

## GRT-side checklist (built)

- [x] Store `grt_athlete_id` ↔ TM `registration_id` mapping per user.
      (`grt_athlete_id` = our auth user id; TM ids in `public.tm_links`, migration 021.)
- [x] "My tournaments" screen backed by TM's entitlements endpoint.
      (`src/pages/tournaments/MyTournamentsPage.tsx`, `useMyTournaments`.)
- [x] Disable round start unless `can_start` is true. (Gated `Start` button + reason.)
- [x] On start: create the GRT round, call TM `/scores` to set `round_tracking_round_id`.
      (`useStartRound` accepts `tm` context; round id IS the round_tracking_round_id.)
- [x] Push hole scores to TM `/scores` during play; send `SUBMITTED` at the end.
      (`useTmRoundSync` — pushes on each shot, SUBMITTED in `finalizeRound`.)
- [x] Push shot/GPS to TM `/shots` (per hole) for the public replay. (`useTmRoundSync`.)
- [x] Match courses by `external_course_id` (== our `courses.course_api_id`).
      (`useTournamentCourse` — matches, or imports on demand from GolfCourseAPI.)

**GRT-side implementation notes:**
- All TM calls are proxied through the **`tm-integration` Supabase edge function**
  so the shared `INTEGRATION_API_KEY` never ships in the client bundle. Config
  lives as edge-function secrets (`TM_BASE_URL`, `INTEGRATION_API_KEY`), not as
  `VITE_*` vars. See `supabase/functions/.env.example`.
- The edge function resolves `grt_athlete_id` (= auth user id) and `email` from
  the caller's session/profile — clients can't query/attribute another user.
- Deploy: `supabase functions deploy tm-integration --no-verify-jwt`, then
  `supabase secrets set TM_BASE_URL=… INTEGRATION_API_KEY=…`. Apply migration 021.
