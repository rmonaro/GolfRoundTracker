# Scorer Mode — tournament shot tracking by an assigned scorekeeper

A tournament admin assigns a **scorekeeper** to a tee time in TournamentManagement
(TM). That person signs into GolfRoundTracker (GRT) on their phone, sees the 2–4
athletes in their group, and records shots for each of them. Scores flow live to
TM's leaderboard; the round lands in each athlete's GRT history.

This document is the build plan. It spans **both repos** — TM owns assignment,
GRT owns tracking.

Companion docs: `docs/TM_INTEGRATION.md` (GRT side of the existing athlete
integration), `TournamentManagement/INTEGRATION.md` (the contract),
`docs/OFFLINE_MODE.md`.

---

## Decisions (locked)

| # | Decision | Chosen |
| - | -------- | ------ |
| 1 | Repo scope | Both apps change |
| 2 | Athlete GRT account | **Not required.** Rounds are tracked against the TM registration and claimed later by email |
| 3 | Capture depth | **Full shot detail** per athlete, with a **quick-entry** path for when there's no time |
| 4 | Ball positions | **Map tap** (reuses `HoleLayoutCard.onShotLanded`) |
| 5 | Scorer identity | GRT account, assigned **by email** in TM — same linking pattern athletes already use |
| 6 | Conflict rule | **Athlete wins.** If the athlete tracks their own round, theirs is primary; the scorer's is retained as a marker backup |
| 7 | Attestation | Athlete **confirms at round end**. Live-pushes to TM as it happens, flagged unconfirmed in GRT history until confirmed |
| 8 | Offline | **Full offline** for all 2–4 rounds |

---

## What already exists (verified)

**TM**
- `tee_groups` (tournament_id, round_number, starting_hole, tee_time, name) and
  `pairing_slots` (group_id, registration_id, position) — tee times and groups
  are already modeled. `supabase/migrations/20260609120500_schema.sql:199-217`.
- `GET/POST /api/pairings` + `DELETE /api/pairings/[id]`, gated by
  `requireRole(SCORING_ADMIN | EVENT_ADMIN)`.
- `src/components/admin/TeeTimesTab.tsx` (282 lines) — the tee sheet UI.
- Role ladder `SUPER_ADMIN > ORG_ADMIN > EVENT_ADMIN > SCORING_ADMIN`
  (`src/lib/permissions.ts`, migration `20260806100000_role_privileges.sql`).
- Integration endpoints `/api/integration/{players/tournaments,link,scores,shots}`,
  all key-authed via `verifyIntegrationKey`.
- **Nothing assigns a person to a tee group**, and no integration endpoint
  answers "which groups am I scoring?".

**GRT**
- `supabase/functions/tm-integration/index.ts` — the server-side proxy holding
  `INTEGRATION_API_KEY`.
- `tm_links` (migration 021) caching registration ids per user;
  `rounds.tm_registration_id / tm_round_number / tm_tournament_slug`.
- `useStartRound` with its `tm` context + early `/scores` link call.
- `roundSync.syncRound(round, completion)` is already a **pure function over one
  `ActiveRound` snapshot** — the single most important seam for this feature.
  `drainOutbox` already loops a list of them.
- `HoleLayoutCard` already supports **tap-to-record** via `onShotLanded`, which
  returns start/end coords, computed distance, and inferred lie + target result.

**The three obstacles**
1. `callerOwnsTarget` in the edge function hard-codes *"you may only push for
   yourself"* (`tm-integration/index.ts:263-288`). A scorer pushes for others.
2. `roundStore` holds exactly one `active: ActiveRound | null`. Scorer mode needs
   2–4 concurrent live rounds.
3. GRT RLS scopes rounds to `user_id = auth.uid()`, and `round_holes`/`shots`
   policies check the parent round's `user_id` (documented at
   `src/services/roundSync.ts:11-14`). A scorer writing into an athlete's round
   is denied — and an unclaimed athlete has no `user_id` at all.

---

## Ownership model — the load-bearing decision

**The scorer owns every row they write, until the round is finalized. Then it
transfers to the athlete.**

```
during play            finalize                   claim (if unlinked)
──────────             ────────                   ───────────────────
rounds.user_id                                    rounds.user_id
  = scorer      ──►    linked athlete?  yes ──►     = athlete
                              │                    confirmed_at = null
                              │ no
                              ▼
                       stays scorer-owned,
                       pending_athlete_email set,
                       invisible in scorer's
                       own history/stats
```

Why this shape:

- **The entire existing offline stack works unchanged.** `syncRound` writes rows
  the scorer owns, so RLS passes with no new write policies during play, and the
  reconciler needs no awareness of scorer mode.
- **No nullable `rounds.user_id`.** Making the owner nullable would ripple
  through every RLS policy and every query that assumes it is set.
- **Transfer is one `UPDATE rounds SET user_id`.** Because `round_holes` and
  `shots` derive their policy from the parent round, moving the round moves
  everything under it atomically.

Two consequences that must be handled, not glossed over:

- Marker rounds would otherwise pollute the scorer's own round list, stats and
  handicap. Every personal query must exclude `scoring_mode = 'MARKER'` —
  `roundRepo.list`, `roundRepo.listRecent`, the stats aggregations, and
  `PastRoundsPage`. **This is a required change, not a nice-to-have.**
- After transfer the scorer must still be able to read the card (and fix it if
  disputed). That needs new `scored_by_user_id`-keyed policies — see below.

---

## Part 1 — TM: assign a scorer to a tee time

### 1.1 Migration `supabase/migrations/2026081000000_tee_group_scorers.sql`

```sql
create table tee_group_scorers (
  id            uuid primary key default gen_random_uuid(),
  group_id      uuid not null references tee_groups (id) on delete cascade,
  email         text not null,
  name          text,
  -- Stamped on first authenticated pull, same link-on-read pattern as
  -- registrations.grt_athlete_id.
  grt_user_id   text,
  assigned_by   uuid references profiles (id),
  created_at    timestamptz not null default now(),
  unique (group_id, lower(email))
);
create index idx_tee_group_scorers_email on tee_group_scorers (lower(email));
create index idx_tee_group_scorers_grt on tee_group_scorers (grt_user_id);
```

A table rather than a column on `tee_groups`, so a group can carry a primary and
a backup scorer, and so reassignment is an insert/delete rather than a mutation.

RLS mirrors `pairing_slots`: readable/writable by admins in the tournament's
organization.

### 1.2 API

- `GET /api/pairings` — extend the existing select to include
  `scorers:tee_group_scorers(id, email, name, grt_user_id)`.
- `POST /api/pairings/[id]/scorers` — `requireRole(EVENT_ADMIN)`, body
  `{ email, name? }`. Normalizes the email, upserts.
- `DELETE /api/pairings/[id]/scorers/[scorerId]` — `requireRole(EVENT_ADMIN)`.

### 1.3 UI — `src/components/admin/TeeTimesTab.tsx`

Each group card gains a **Scorer** row under the player list: assigned scorers as
removable chips, plus an inline "Assign scorer" email input. Show an unlinked
state (`grt_user_id is null`) as "invited — hasn't opened GRT yet", so an admin
can tell a typo from a no-show.

### 1.4 New integration endpoint

`GET /api/integration/scorers/assignments?email=&grt_user_id=`

Key-authed like the others. Link-on-read: when both params are present, stamp
`grt_user_id` onto matching rows by email.

```json
{
  "data": {
    "scorer": { "email": "coach@example.com", "grt_user_id": "…" },
    "assignments": [
      {
        "tee_group_id": "uuid",
        "round_number": 1,
        "tee_time": "2026-06-16T12:00:00Z",
        "starting_hole": 1,
        "can_start": true,
        "can_start_reason": "ok",
        "tournament": {
          "id": "uuid", "name": "…", "slug": "…", "status": "IN_PROGRESS",
          "external_course_id": "6959", "course_name": "…"
        },
        "players": [
          {
            "registration_id": "uuid",
            "first_name": "Jack", "last_name": "Doe",
            "email": "jack@example.com",
            "grt_athlete_id": "uuid-or-null",
            "division": { "id": "uuid", "name": "Boys 15-18" },
            "position": 1,
            "scorecard": {
              "id": "uuid", "status": "IN_PROGRESS",
              "round_tracking_round_id": null,
              "holes_completed": 0
            }
          }
        ]
      }
    ]
  }
}
```

`can_start` reuses the same `now >= tee_time` rule as the athlete entitlements
endpoint, so the two screens gate identically.

**No change is needed to `/api/integration/scores` or `/shots`** — they already
resolve by `registration_id` / `round_tracking_round_id`, and they trust the
server-to-server key. The authorization gate for scorer pushes lives in GRT's
edge function, which is the only thing holding that key.

---

## Part 2 — GRT: schema

### Migration `supabase/migrations/034_scorer_mode.sql`

```sql
-- Who recorded this round, when it wasn't the owner.
alter table public.rounds
  add column if not exists scored_by_user_id uuid references auth.users (id),
  add column if not exists scoring_mode text not null default 'SELF'
    check (scoring_mode in ('SELF', 'MARKER')),
  -- Claim key: set while a marker round has no linked athlete.
  add column if not exists pending_athlete_email text,
  add column if not exists pending_registration_id text,
  -- Attestation (decision 7).
  add column if not exists athlete_confirmed_at timestamptz,
  add column if not exists athlete_dispute_note text,
  -- Precedence (decision 6). PRIMARY pushes to TM; MARKER_BACKUP does not.
  add column if not exists tm_card_role text
    check (tm_card_role in ('PRIMARY', 'MARKER_BACKUP'));

create index if not exists idx_rounds_scored_by on public.rounds (scored_by_user_id);
create index if not exists idx_rounds_pending_claim
  on public.rounds (lower(pending_athlete_email)) where pending_athlete_email is not null;
```

Scorer visibility after transfer — permissive policies, OR'd with the existing
owner policies exactly like migration 022's admin policies:

```sql
create policy "rounds_scorer_select" on public.rounds
  for select using (scored_by_user_id = auth.uid());
-- Same shape for round_holes / shots, via the parent round.

-- Scorer may still correct a card until the athlete confirms it.
create policy "rounds_scorer_update" on public.rounds
  for update using (scored_by_user_id = auth.uid() and athlete_confirmed_at is null);
```

Assignment cache — mirrors `tm_links`, and is what makes the group list work with
no signal:

```sql
create table public.tm_scorer_assignments (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users (id) on delete cascade,
  tee_group_id        text not null,
  tournament_id       text,
  tournament_slug     text,
  tournament_name     text,
  round_number        int,
  tee_time            timestamptz,
  starting_hole       int,
  external_course_id  text,
  players             jsonb not null default '[]'::jsonb,
  updated_at          timestamptz not null default now(),
  unique (user_id, tee_group_id)
);
```

Claim + transfer RPC (security definer, so it can move a row the caller doesn't
yet own):

```sql
-- Attach every unclaimed marker round matching this email to the caller.
-- Called after sign-in and after the entitlements refresh.
create function public.claim_marker_rounds() returns int ...

-- Finalize: hand a marker round to its athlete, if linked.
create function public.transfer_marker_round(round_id uuid, athlete_id uuid) returns void ...
```

---

## Part 3 — GRT: edge function

`supabase/functions/tm-integration/index.ts`:

1. **New action `scorer_assignments`** → `GET {TM}/api/integration/scorers/assignments`
   with the caller's profile email + user id. Upserts `tm_scorer_assignments`
   as a side effect, mirroring `upsertLinks`.

2. **`callerOwnsTarget` gains a third path.** A caller also owns the target when
   either:
   - a `tm_scorer_assignments` row for that caller contains the
     `registration_id` in its `players` snapshot, or
   - the round named by `round_tracking_round_id` has
     `scored_by_user_id = caller`.

3. **`handlePush` must stop blindly stamping the caller's id.** Today it sets
   `grt_athlete_id: grtAthleteId` unconditionally (`index.ts:254`). For a scorer
   push that is the *scorer's* id, and TM's resolution order would attribute the
   score to the wrong person. Fix: stamp the **athlete's** `grt_athlete_id` when
   the push is a scorer push (read it from the assignment snapshot or the round),
   and omit the field entirely when unknown — `registration_id` and
   `round_tracking_round_id` both resolve without it.

   > This is the single highest-risk line in the whole feature. Scores landing on
   > the wrong player's leaderboard row is the failure mode to guard hardest.

4. **Precedence resolution (decision 6).** On each push the function checks
   whether a `scoring_mode = 'SELF'` round exists for the same
   (registration_id, round_number). If it does, the athlete's card is `PRIMARY`;
   a marker push is accepted and stored in GRT but **not forwarded to TM**, and
   the response carries `{ primary: false }` so the scorer's app can show the
   backup banner. Resolving this server-side is deliberate — an offline scorer
   cannot know the athlete started their own round.

---

## Part 4 — GRT: multi-round store

**Built differently from the original plan, and better.** The plan called for
`active: ActiveRound | null` to become `rounds: ActiveRound[]` with `active`
derived, and a `PERSIST_VERSION` 1 → 2 migration. What shipped instead adds a
**sibling** field:

```ts
interface RoundState {
  active: ActiveRound | null;              // unchanged
  parked: Record<string, ActiveRound>;     // new; empty outside scorer mode
  addParallelRound: (round: ActiveRound) => void;
  switchRound: (roundId: string) => void;
  closeRound: (roundId: string) => void;
  // Sync stamps take an OPTIONAL roundId — omitted means "the one on screen",
  // which is exactly what every pre-existing call site already passes.
  markRoundSynced: (roundId?: string) => void;
  markSynced: (holeIds: string[], shotIds: string[], roundId?: string) => void;
  clearShotTombstones: (shotIds: string[], roundId?: string) => void;
}
```

Why this is the better shape:

- **No persist version bump, and nothing to migrate.** A payload written before
  scorer mode simply has no `parked` key, and zustand's shallow merge leaves the
  initial `{}` in place. The plan's riskiest step — a store migration running on
  phones mid-round — disappears entirely.
- **Every existing mutator is untouched.** They all still operate on `active`,
  so a golfer tracking their own round runs the same code as before rather than
  a rewritten version of it. `HoleTrackingPage` (3,911 lines) needed no change.
- `parked` **is** persisted: a scorer's other 1–3 players are unsynced data
  exactly like the one on screen, and must survive an app restart mid-round.

`src/services/roundSync.ts`:
- `reconcileActiveRound` → `reconcileLiveRounds`, looping every live round and
  calling the already-pure `syncRound` per round. One player's failure must not
  strand the others — unlike `drainOutbox`, where stopping early is right
  because the queue is ordered and a shared cause fails the rest identically.
  An expired session is the one exception: it stops the loop, since every
  remaining round would fail the same way.
- `SyncStatusChip` sums pending work across the group, so "3 unsynced" means the
  scorekeeper's 3 and not just the player on screen.

Still to come in Phase 4: `ActiveRound` gains `scoredByUserId`, `scoringMode`,
`athleteName`, `registrationId`, `teeGroupId`, `pendingAthleteEmail`.

---

## Part 5 — GRT: scorer UI

New files under `src/pages/tournaments/` and `src/features/tournaments/`:

| File | Role |
| ---- | ---- |
| `useScorerAssignments.ts` | Calls the `scorer_assignments` action; falls back to the `tm_scorer_assignments` cache when offline |
| `ScorerAssignmentsPage.tsx` | "Groups I'm scoring" — tee time, course, player names, `can_start` gate |
| `useScorerGroupRounds.ts` | Starts/resumes one `ActiveRound` per player in the group (N parallel `useStartRound`-equivalent calls, scorer-owned) |
| `ScorerGroupPage.tsx` | The tracking screen |
| `ScorerQuickEntry.tsx` | Compact hole grid: one row per player, strokes / putts / penalty |
| `scorerPush.ts` | Per-player TM score + shot push, honoring the `primary` flag |

**`ScorerGroupPage` layout**

```
┌────────────────────────────────────────────┐
│  Hole 7 · Par 4 · 385y          [Quick ▾]  │
├────────────────────────────────────────────┤
│ ⦿ Jack D  │  Amy R  │  Ben T  │  Cara W    │  ← player tabs: name, thru, ±
│   +2 (7)  │  E (7)  │  +5 (7) │  -1 (7)    │
├────────────────────────────────────────────┤
│                                            │
│        [ map — tap to place ball ]         │  ← HoleLayoutCard, onShotLanded
│                                            │
├────────────────────────────────────────────┤
│  Jack D — shots this hole                  │
│   1  Driver   268y  fairway          [ ✎ ] │
│   2  7i       158y  green            [ ✎ ] │
│   + Add shot                               │
└────────────────────────────────────────────┘
```

- Switching player tabs calls `switchRound(roundId)`. The per-player body reuses
  the existing shot list, `AddShotSheet`, and `ShotSelectors` — the full-detail
  path is the same components the athlete already uses.
- **Quick mode** swaps the body for `ScorerQuickEntry`: all players on one hole,
  strokes/putts/penalty steppers, one tap each. Shot detail can be filled in
  later on any hole — quick mode and full mode write the same rows.
- **Map tap** is the primary position input (decision 4). `onShotLanded` already
  returns computed distance and inferred lie/target result, so a tapped shot
  arrives essentially complete.
- Auto-track (`useAutoTrack`), watch integration, and live-GPS club selection are
  **off** in scorer mode — the phone's GPS is the scorer's position, not any
  athlete's ball.

**Finish flow.** "Finish group" per player or all at once → sets
`completed_at`, pushes `status: "SUBMITTED"` to TM, and calls
`transfer_marker_round` for linked athletes. Unlinked athletes' rounds stay
scorer-owned with `pending_athlete_email` set.

---

## Part 6 — GRT: athlete side

- **Claim.** `claim_marker_rounds()` runs after sign-in and after each
  entitlements refresh. A newly-signed-up athlete finds their tournament rounds
  already waiting.
- **Confirm / dispute** (decision 7). A round with `scoring_mode = 'MARKER'` and
  `athlete_confirmed_at is null` renders in `PastRoundsPage` and
  `RoundSummaryPage` with a "Recorded by {scorer}" banner and Confirm / Something's
  wrong actions. Disputing writes `athlete_dispute_note` and surfaces the round
  back to the scorer (who still has update access while unconfirmed).
- **Backup banner** (decision 6). If the athlete tracks their own round, theirs
  is `PRIMARY`; the scorer's card flips to `MARKER_BACKUP`, stops pushing to TM,
  and the scorer's screen says so.
- **Exclusion from the scorer's own data.** `roundRepo` list queries and the
  stats aggregations must filter `scoring_mode = 'MARKER'` out of the scorer's
  personal history and handicap.

---

## Phasing

| Phase | Scope | Status |
| ----- | ----- | ------ |
| 1 | TM: migration, scorer API, `TeeTimesTab` UI, `/integration/scorers/assignments` | **Built** — TM commit `3a4d41f` |
| 2 | GRT: migration 034, edge-function action + push authorization + attribution fix | **Built** |
| 3 | GRT: multi-round store + `roundSync` loop | **Built** — no persist version bump was needed, see below |
| 4 | GRT: scorer UI — assignments list, group page, quick entry, map tap | **Built** — first user-visible milestone |
| 5 | Ownership transfer, claim, athlete confirm/dispute | **Built** |
| 6 | Precedence (athlete wins), offline hardening for N rounds | **Built** — field test outstanding |

### Deploy order (both phases)

1. Apply TM migration `…20260810120000_tee_group_scorers.sql`, **then** deploy TM.
   `GET /api/pairings` embeds `scorers:tee_group_scorers(...)`; code-first is a
   broken tee sheet.
2. Apply GRT migration `034_scorer_mode.sql`, **then**
   `supabase functions deploy tm-integration --no-verify-jwt`. The function
   selects `rounds.scoring_mode` / `scored_by_user_id`; without them the query
   errors and pushes silently fall back to the old ownership path.

### How to try it (once the migrations are applied)

1. In TM, assign yourself to a tee group by the email on your GRT account.
2. In GRT: **My Tournaments → Scoring for others → Start scoring**.
3. Route is `/scoring`, group screen is `/scoring/:teeGroupId`.

### Handover, as built (Phase 5)

Finishing a group runs three steps per player: stamp `completed_at` via
`syncRound`, submit to TM, then **transfer**.

Transfer is the `transfer_marker_rounds` edge-function action, not a
client-callable RPC — deliberately. Writing somebody else's user id onto a round
means the athlete id must come from **TM's registration**, never the client;
otherwise a scorer could push a fabricated card into any account. The function
verifies the caller recorded the card, resolves the athlete from the assignment
snapshot, and checks the profile exists before assigning (a missing profile
would fail the foreign key, so those stay claimable instead).

A player with no GRT account can't be transferred to anyone, so their card stays
with the scorer carrying `pending_athlete_email`. `useClaimMarkerRounds` runs
once per session at the app root and calls `claim_marker_rounds()`, which
matches only rounds whose pending email equals the caller's own profile email —
an address that came from the TM registration, so there's nothing to spoof.

Attestation is `MarkerCardBanner` on the round summary, plus a Confirm/Flagged
chip in the history list. Confirming **freezes** the card: the scorer's write
policy is conditioned on `athlete_confirmed_at is null`, so afterwards they can
read it but not change it. Disputing deliberately leaves it unconfirmed, which
is exactly what keeps them able to fix it.

### Precedence, as built (Phase 6)

Decided **server-side**, in the edge function, on every scorer push. A scorer in
a dead zone has no way to know the athlete started tracking themselves ten
minutes ago, so the device cannot be trusted with this.

`athleteIsTracking()` requires *evidence of play* — a `SELF` round for that
registration **and** a hole with strokes on it — not merely that a round row
exists. A player who taps Start and walks away would otherwise silently demote
their scorekeeper and stall the leaderboard for the rest of the round.

When the athlete is tracking, the scorer's push is **accepted into GRT but not
forwarded to TM**, and the response carries `{ primary: false }`. The round is
stamped `MARKER_BACKUP`, the scorer's screen says so plainly, and their tab is
labelled *backup*. They keep scoring — a marker's copy is the point.

No merge is attempted. Holes the athlete hasn't reached keep whatever the scorer
already pushed, because nothing overwrites them. That's the "mid-round switch"
question from the open items, answered by doing nothing clever.

`roundSync` only sends `tm_card_role` once a value is known, since sending null
on every reconcile would clear a demotion the edge function had just written.

### Offline hardening (Phase 6)

`drainOutbox` no longer aborts the whole queue on the first failure. That was
right when the queue held one golfer's round, but finishing a tee group enqueues
up to four at once, and one entry failing for its own reason would have held
three other players' rounds hostage indefinitely. Auth failures still stop the
drain — every remaining entry fails identically and it needs the user.
- The **shared hole** is component state on the group screen rather than being
  written back to each card's `currentHoleIndex`, so reopening a group starts at
  the card's own resume hole. Fine today; revisit if it reads oddly in the field.

Phase 3 is the one to be most careful with: it touches a persisted store that
live rounds depend on, and a bad migration loses somebody's afternoon.

---

## Open items to settle before Phase 5/6

1. **Mid-round primary switch.** If a scorer has pushed holes 1–5 and the athlete
   then starts their own round, the leaderboard has scorer data on it. Proposed:
   the athlete's card becomes primary and re-pushes all of its holes, overwriting;
   holes the athlete hasn't entered keep the scorer's values rather than reverting
   to blank. Needs confirmation before implementing.
2. **Do unclaimed / unconfirmed marker rounds count toward the athlete's
   handicap and stats?** Proposed: they appear in history immediately but are
   excluded from handicap until confirmed.
3. **Withdrawals and no-shows.** What the scorer does with a player who WDs
   mid-round — TM has registration statuses, GRT has no concept of it.
4. **Scorer scoring their own round too.** A playing marker would need a self
   round plus marker rounds in the same group. The multi-round store supports it;
   the UI does not, and it is out of scope unless asked for.
