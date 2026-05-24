# Golf Round Tracker

Mobile-first, dark-mode-by-default golf score and shot tracking app.

- **React 18** + **Vite** + **TypeScript**
- **Material UI v6** with a custom green-on-near-black theme and 48 px+ tap targets
- **Supabase** for Postgres + Auth (Row Level Security; users only ever read their own data)
- **Zustand** for client state (persisted active rounds + theme) plus **TanStack Query** for server cache
- **PWA** (installable, offline shell, theme color, safe-area-aware)
- Watch UI mock (round-context simplified view)

The architecture leaves room for a V2 GPS / strokes-gained engine without changing the data model — the GPS columns already exist on `shots` as nullable, ready for population.

---

## Quick start

```bash
# 1. install
npm install

# 2. configure supabase
cp .env.example .env.local
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 3. push the schema to your Supabase project
#    Either:
#      a) NEW PROJECT: paste supabase/schema.sql into the Supabase SQL editor.
#      b) EXISTING PROJECT: paste each file in supabase/migrations/ in order.
#         Files are idempotent — re-running them is safe.

# 4. run the dev server
npm run dev
```

Open http://localhost:5173 on a phone (same WiFi) to test the mobile experience.

### Supabase setup

1. Create a new project at https://supabase.com.
2. In **SQL Editor**, run `supabase/schema.sql`. This creates every table, enum, index, the auto-profile trigger, and all RLS policies in one shot.
3. (Optional) After signing up at least one user via the app, replace `:USER_UUID` in `supabase/seed.sql` with that user's id (Auth → Users) and run it for demo data.
4. In **Authentication → Providers**, email/password is on by default — leave it.
5. Copy your project URL and anon key into `.env.local`.

> The `supabase/migrations/*.sql` files are the *historical* trail (001 → 006). Brand-new projects only need `schema.sql`. Existing projects that ran an earlier `schema.sql` should run the migrations from the highest version they're already past, forward.
>
> Some editors (VS Code SQL Server extension) will lint these files as T-SQL and show false positives on `add column if not exists`, `gin` indexes, `alter type … add value`, and `numeric(p,s)`. The files are valid PostgreSQL — paste them into Supabase as-is.

---

## Migrations

| File | What it adds |
|---|---|
| `supabase/schema.sql` | Full current schema. Idempotent — safe to re-run. |
| `001_user_bag_personal_columns.sql` | `user_bag.brand / model / loft` |
| `002_courses_address.sql` | `courses.address / city / state / zip` |
| `003_round_holes_clubs_used.sql` | `round_holes.clubs_used uuid[]` (V1 unused; V2 derivation hook) |
| `004_shot_details_and_gps_placeholders.sql` | `shots.distance / distance_unit` + GPS columns + extended `shot_result` enum |
| `005_structured_shot_outcomes.sql` | `shots.target_type / target_result / lie` |
| `006_shot_penalty_type.sql` | `shots.penalty_type` |

---

## Folder structure

```
src/
  app/                application bootstrap, providers, global CSS
  components/         reusable UI building blocks
    layout/           MobileShell (bottom-nav), PageHeader
    ui/               StatCard, EmptyState, ToggleGroup, NumberStepper
    forms/            (reserved)
    charts/           (reserved)
  pages/
    auth/             AuthLayout, Login, SignUp, ForgotPassword
    bag/              BagPage (5-tier club add/edit with brand+model+loft)
    round/            RoundHome, StartRound, HoleTracking, RoundSummary, PastRounds
    stats/            StatsPage
    settings/         SettingsPage
    watch/            WatchPage
    HomePage.tsx
  features/
    auth/             AuthProvider, AuthGuard, SessionHydrator
    bag/              useBag hook, brands list, default-club catalog
    round/
      AddShotSheet         — bottom-sheet shot logger (club → distance → target → lie → penalty → notes)
      ShotSelectors        — BullseyeTarget (green/putt), FairwaySelector (par 4/5 tee),
                              LieSelector, PenaltySelector
      ClubIcons            — custom SVG glyphs for Driver/Wood/Iron/Wedge/Putter
      useStartRound        — creates round + course + seeds blank holes
      useAutosaveHole      — debounced hole-level autosave to Supabase
      computeRoundTotals   — hole-total derivation (strokes + penalty_strokes)
    stats/            useRounds, computeStats, detailRoundStats
    course/           (reserved for V2 GPS hole maps)
  services/           Repository pattern over Supabase + AppError wrapper
    profileRepo.ts
    bagRepo.ts
    courseRepo.ts
    roundRepo.ts    ← add/update/delete shot, hole upsert, round update
    authService.ts
    errors.ts       ← duck-types Supabase PostgrestError so messages surface in UI
  stores/             Zustand stores
    authStore.ts
    bagStore.ts     ← hydrated by SessionHydrator at session start
    roundStore.ts   ← active round is persisted to localStorage
    statsStore.ts
    settingsStore.ts ← theme mode + watch toggle, persisted
  hooks/              (reserved)
  models/             domain-facing type re-exports (Profile, Round, Shot, ...)
  utils/              handicap math, formatters
  router/             AppRouter — public auth routes + AuthGuard'd app shell + standalone full-screen routes
  theme/              MUI dark + light theme tokens, brand colors
  types/              database.ts — hand-typed Supabase row interfaces
  lib/                supabase.ts client
supabase/
  schema.sql          full current schema (tables, types, RLS, trigger)
  seed.sql            sample data (requires a real user id)
  migrations/         001 → 006 historical migrations
public/
  favicon.svg
```

---

## My Bag

Each club is a `user_bag` row referencing a shared `clubs` catalog entry. The personal attributes live on `user_bag`:

- **Name** — auto-derived from category + (number OR loft), e.g. `5 Iron`, `56° Wedge`, `Driver`, `SW 56°`.
- **Brand** — picked from a curated list of ~48 OEMs and DTC brands, plus `Other…` (free text).
- **Model** — optional free text.
- **Loft** — required for wedges, optional elsewhere.

The bag starts **empty** for new accounts. Use *Add a Club* for one-at-a-time or *Quick Add Common Clubs* (chip multi-select) to onboard fast. A bag-level **Clear bag** option lives in the kebab menu.

---

## Round flow

1. **Start Round** — pick an existing course or fill in name + tee box + rating + slope + par + yardage + optional street address. A new `courses` row is created on the fly; the round is created and 9/18/N empty holes are batch-upserted so each one has a stable id.
2. **Hole Tracking** screen layout:
   - **Header** — hole number, tappable Par / Yards chips (open the Hole Details dialog with par 3/4/5 buttons + yardage input).
   - **Score readout** — read-only derived row: `Shots · Putts · Penalty · Hole`.
   - **Shots timeline** — vertical list of every logged shot. **Tap a row to edit it**, tap trash to delete.
   - **Add Shot** button → opens the bottom sheet.
3. **AddShotSheet** (the heart of round tracking — see next section).
4. **Finish Round** — writes total score and `completed_at`, navigates to summary, persists the handicap differential `(score − courseRating) × 113 / slopeRating`.
5. **Stats** — rolling estimated handicap (1–2 rounds: prompt; 3–19: lowest of available; 20+: average best 8 of last 20), score & differential trend lines, most-used clubs.

The summary and stats screens both display the disclaimer **"Estimated handicap only. Not an official USGA handicap."**

---

## Add Shot bottom sheet

A 5-section flow that adapts to the shot's context.

1. **Club** — 5 circular tiles in one row with SVG icons: Driver · Wood · Iron · Wedge · Putter. Driver and Putter tap-select directly; Wood / Iron / Wedge expand a sub-row of the user's actual clubs (hybrids ride with Woods).
2. **Distance** — number input with `yds` / `ft` toggle. Auto-flips to `ft` when a putter is the selected club.
3. **Target** — context-aware:
   - **Green Target** (SVG bullseye): center "GREEN", outer segments Long / Right / Short / Left. Used for approach shots and for par-3 tee shots.
   - **Fairway Selector** (SVG): wide central fairway oval with crescent-moon shaped Left / Right miss zones curving around it on each side. Used for par-4 / par-5 tee shots.
   - **Putt Target** (SVG bullseye): center "MADE", outer segments Long / Right / Short / Left. Used whenever a putter is selected.
   - All regions are toggleable — tap the active one to deselect.
4. **Lie** (optional) — Fairway · Rough · Bunker · Green · Penalty.
5. **Penalty** (optional) — 6 small selection circles: OB · Water · Lost · Unp · WB · Bunker. OB / Water / Lost / Unp / WB each add 1 stroke to the hole; Bunker is a tag only.

The sheet auto-pre-fills smart defaults (matching lie when you hit the center target, putt unit when a putter is selected, etc.), and tapping a shot in the timeline reopens it in edit mode with all fields populated.

---

## Derived hole stats

The shot list is the source of truth. Each shot change pushes derived values into `round_holes` via a `useEffect` so the next autosave persists them:

| Column | Derivation |
|---|---|
| `strokes` | `shots.length` |
| `putts` | shots where the club's category is `putter` |
| `penalty_strokes` | shots tagged with a stroke-adding penalty (`ob` / `water` / `lost_ball` / `unplayable` / `wrong_ball`) |
| `fairway_result` | `'na'` on par 3, otherwise shot 1's `target_result` when `target_type='fairway'` |
| `sand` | any shot has `lie='bunker'` or `penalty_type='bunker'` |
| `gir` | `(strokes − putts) ≤ max(1, par − 2)` |

The hole's **total score = strokes + penalty_strokes**. Putts are a *subset* of strokes (they're shots with a putter), so they're not added on top.

---

## Watch UI

`/watch` renders a watch-shaped frame with two screens:

- **Home**: hole number, par, yardage, score, plus *Add Shot*, *+ Stroke*, *+ Putt*, *Next*.
- **Club picker**: 5 large category tiles (Driver / Wood / Iron / Wedge / Putter).

Each tile records a quick shot using the first matching club from the bag. The screen is purely for V1 visualization; the wear-os/Apple-watch native build is V2.

---

## V2 hooks already in place

The codebase deliberately leaves room for these without further schema migrations:

- **GPS columns** on `shots`: `start_lat`, `start_lng`, `end_lat`, `end_lng`, `calculated_distance`. Comments in `AddShotSheet.tsx` mark the 4 hook points for the Start-Shot → Walk-to-Ball → End-Shot capture flow.
- **`round_holes.clubs_used` array** — currently unwritten in V1 (we derive clubs from shots), kept as a V2 backfill target if a normalized aggregate is preferred later.
- **Strokes-gained / dispersion analytics** drive off the structured `shots.target_type / target_result / lie / distance` fields with no schema work.
- **`features/course/`, `components/charts/`, and `hooks/`** are scaffolded empty to absorb V2 work.

---

## Notes

- We treat `estimated_handicap` as a computed value, not authoritative truth. The per-round differential is what we persist.
- The `clubs` table is shared (public read, authenticated insert). The user's *bag composition* is private via `user_bag` + RLS. `clubs.name` rows are not deduplicated — every "5 Iron" added by every user is its own row. Storage is cheap; the catalog can be normalized later.
- `courses.created_by_user` can be null, in which case the row is visible to everyone — leaves the door open for an admin-seeded shared course catalog.
- Errors from Supabase are routed through `AppError` in `src/services/errors.ts`. It duck-types `PostgrestError` (a plain object, not an `Error` instance) so the actual database message (`hint`, `details`, `code`) surfaces in the UI and the console.
- `SessionHydrator` mounts inside `AuthProvider` and fires `useBag()` at session start so every route — including full-screen routes outside `MobileShell` like `/round/play`, `/round/summary/:id`, and `/watch` — has the user's bag available without each page calling `useBag()` itself.

---

# Build: Pre-Loaded Course Library + OSM Hole Layouts

## Context

This adds to my existing **Golf Round Tracker** app (see README above). It's a React 18 + Vite + TypeScript + MUI v6 + Supabase + Capacitor PWA for tracking matchplay rounds.

I want to do three things:

1. **Pre-load a course library** that I (admin) curate by importing from **GolfCourseAPI** (https://api.golfcourseapi.com).
2. **Enhance the existing course picker** in the Start Round flow so users pick from this library first, and only fall back to manual entry if their course isn't there.
3. **Render top-down hole layouts** on the active hole-tracking screen, sourced from **OpenStreetMap via Overpass API**, cached in Supabase, oriented tee-at-bottom / green-at-top.

## Read Before You Start

- `README.md` — full architecture, folder structure, conventions
- `src/types/database.ts` — current Supabase row types
- `supabase/schema.sql` — current schema (including the existing `courses` table)
- `src/services/courseRepo.ts` — existing repository for courses
- `src/pages/round/StartRound.tsx` — the flow we're enhancing
- `src/pages/round/HoleTracking.tsx` — where layouts will appear
- 2–3 existing components in `src/components/ui/` to match style

Match existing conventions exactly:
- Repository pattern over Supabase via `services/`
- `AppError` wrapping for all DB errors (`src/services/errors.ts`)
- TanStack Query for server cache, Zustand only for client state
- MUI v6 with the existing dark green theme + 48 px tap targets
- All Supabase row types live in `src/types/database.ts`
- File layout follows the structure in the README

## Two Data Pipelines (independent, linked by course id)

- **GolfCourseAPI** → scorecard data. Admin imports courses in bulk; data lives in `courses.scorecard_external` jsonb.
- **OSM (Overpass)** → hole geometry. Auto-runs on a schedule after a course is imported.

## Tech / Auth Constraints

- All third-party API calls (GolfCourseAPI, Overpass) go through **Supabase Edge Functions**. The client never sees the GolfCourseAPI key.
- Server-side secrets: `GOLFCOURSEAPI_KEY` (Supabase secret), plus the built-in `SUPABASE_SERVICE_ROLE_KEY`.
- Admin gate: there's no `is_admin` column yet. Add it to the `profiles` table (default `false`), and add a check helper. I'll manually set my own profile to `true` after the migration runs.
- Mobile-first. The hole-tracking screen is dense — the layout component must fit above the existing UI without pushing it off-screen.
- **Do not refactor existing files beyond what's necessary** for the integration points.

---

## Phase 1: Schema Migration

Add migration `supabase/migrations/007_course_library_and_layouts.sql`.

**Extend existing `courses` table** — do not recreate it. Use `add column if not exists`:
- `course_api_id` text unique — id from GolfCourseAPI (nullable; user-added courses won't have one)
- `club_name` text
- `country` text
- `lat` double precision
- `lng` double precision
- `search_radius` integer default 1500
- `scorecard_external` jsonb — raw GolfCourseAPI payload
- `osm_synced_at` timestamptz
- `osm_status` text default 'pending' — `pending`, `synced`, `no_coverage`, `failed`, `skip` (skip = user-added, never try OSM)
- `osm_error` text
- `source` text default 'user' — `user` (added in-app) or `api` (admin-imported)

**Extend existing `profiles` table:**
- `is_admin` boolean default false

**New table `holes`:**
- `id` uuid PK default `gen_random_uuid()`
- `course_id` uuid not null references courses(id) on delete cascade
- `hole_number` integer not null
- `par` integer
- `tee_lng`, `tee_lat`, `green_lng`, `green_lat` double precision
- `rotation_radians` double precision
- `orientation_confidence` text — `confirmed`, `reversed`, `assumed`, `manual`
- `bbox_min_lng`, `bbox_min_lat`, `bbox_max_lng`, `bbox_max_lat` double precision
- `centerline` jsonb
- unique on `(course_id, hole_number)`

> Naming note: there's already a `round_holes` table for per-round hole data. This new `holes` table is course-level (the static geometry). Keep them distinct — don't conflate.

**New table `hole_features`:**
- `id` uuid PK default `gen_random_uuid()`
- `course_id` uuid not null references courses(id) on delete cascade
- `hole_id` uuid references holes(id) on delete cascade
- `osm_id` bigint
- `feature_type` text not null
- `is_line` boolean default false
- `coords` jsonb not null
- `created_at` timestamptz default now()
- Indexes on `course_id`, `hole_id`, `feature_type`

**RLS policies:**
- `holes`, `hole_features`: public read (any authenticated user). Writes restricted to service role.
- `courses`: keep existing user-insert policy (so the Start Round fallback still works). Add an admin-update policy. Service role can do anything.
- `profiles.is_admin`: only service role can update this column. Users cannot self-promote.

**Helper SQL function:** `is_admin(uuid) returns boolean` that reads from `profiles.is_admin`. Use it in RLS policies that need admin checks.

**Update `src/types/database.ts`** with the new columns and tables. Match the existing hand-typed style.

**Acceptance:**
- Migration runs cleanly with `supabase db push`. Re-running is safe (idempotent guards).
- Existing user-created courses remain readable with `source = 'user'` and `osm_status = 'skip'` (backfill in the migration).
- I can manually run `update profiles set is_admin = true where id = '<my-uuid>';` and have that take effect.

---

## Phase 2: GolfCourseAPI Edge Function (`courses-api`)

Create `supabase/functions/courses-api/index.ts`.

**Read GolfCourseAPI docs first** at `https://api.golfcourseapi.com/docs/api/` to confirm endpoint shapes, parameter names, and pagination. Do not guess.

Single function, action-routed via request body `{ action: 'search' | 'import' | 'bulkImport', ...args }`.

**Action: `search`** (admin only)
- Body: `{ query: string }`
- Verify JWT, then call `is_admin()` for the caller. Reject if not admin.
- Proxy to GolfCourseAPI search.
- Return `{ courseApiId, name, clubName, city, state, country, lat, lng, alreadyImported }`.

**Action: `import`** (admin only)
- Body: `{ courseApiId: string }`
- Fetch full course detail from GolfCourseAPI.
- Upsert into `courses` with `source = 'api'`, `osm_status = 'pending'`, full payload in `scorecard_external`.
- Return the row.

**Action: `bulkImport`** (admin only)
- Body: `{ courseApiIds: string[] }` (max 50 per call)
- Sequentially import each (with a 250 ms gap to be polite to GolfCourseAPI).
- Return `{ imported: number, failed: { id, error }[] }`.

**Acceptance:**
- I can hit each action from the admin UI.
- Non-admin users get 403.
- Imports populate `courses.scorecard_external` with the raw payload.

---

## Phase 3: OSM Sync Edge Function (`sync-course-osm`)

Create `supabase/functions/sync-course-osm/index.ts`.

**Behavior:**
- Accepts `POST` with `{ courseId?: string, syncAll?: boolean }`.
- Admin can pass `courseId` to manually resync one. Service role (cron) can batch.
- Batch mode: pull up to 10 (or 100 if `syncAll`) courses where `osm_status IN ('pending') OR osm_synced_at IS NULL`, AND `source = 'api'` (skip user-added courses entirely — they're marked `osm_status = 'skip'`).

**Per-course logic:**
1. Query Overpass:
   ```
   [out:json][timeout:30];
   (
     way["golf"](around:${radius},${lat},${lng});
     relation["golf"](around:${radius},${lat},${lng});
   );
   out geom;
   ```
2. Normalize features.
3. For each `golf=hole` line with `ref`:
   - Find nearest `golf=tee` and `golf=green` polygon centroids to each endpoint.
   - Decide tee/green ends. If signals conflict, trust the green side.
   - Set `orientation_confidence` accordingly.
   - Compute `rotation_radians = PI/2 - atan2((greenLat - teeLat), (greenLng - teeLng) * cos(midLat * PI/180))`.
4. Wipe and reinsert `holes` and `hole_features` for the course.
5. Assign features to holes via bbox containment.
6. Update `courses.osm_status` to `synced` / `no_coverage` / `failed`.

**Rate limiting:** 2-second sleep between courses in batch mode. Try/catch each course independently.

**Cron:** add pg_cron schedule, every 6 hours, POSTing `{ syncAll: false }`.

**Acceptance:**
- Manually triggering on an imported Pebble Beach populates ~18 hole rows and many feature rows within ~30 s.
- `no_coverage` courses don't retry indefinitely.
- User-added courses (`source = 'user'`) are never synced.

---

## Phase 4: Admin Panel

There is no admin UI yet — build it from scratch following existing conventions.

**Routing:** Add `/admin/*` routes in the existing router, wrapped in an `<AdminGuard>` that:
- Redirects unauthenticated users to login.
- Redirects non-admin authenticated users to `/`.
- Uses TanStack Query to read `profiles.is_admin` (cached) — never trust client-side state alone; the RLS policies are the real gate.

**Pages:**

`/admin` — overview dashboard. Card grid:
- "Course Library" → count of `api`-sourced courses, breakdown by `osm_status`.
- "Sync Queue" → count of `pending` + `failed`.
- "Orientation Review" → count of holes with `orientation_confidence IN ('assumed', 'reversed')`.

`/admin/courses` — course library table. Columns: name, club, city/state, source, OSM status (colored chip), holes, last synced, actions menu (Resync OSM, View Layouts, Open in Map).

`/admin/courses/import` — search + select + bulk import.
- Search field calls `courses-api` action `search`.
- Results show as a list with checkboxes (disabled + label "Already imported" if `alreadyImported`).
- Sticky bottom bar: "Import N courses" button → calls `bulkImport`.
- Show progress toast.

`/admin/courses/:id` — single course detail. Shows metadata, scorecard summary, sync status, "Resync OSM" button, 18-hole preview grid using the `HoleLayout` component (Phase 5).

`/admin/review` — orientation review queue.
- One hole shown at a time, full-screen-ish preview using `HoleLayout`.
- Header: course name, hole number, par, confidence chip.
- Filter chips at top: All / Assumed / Reversed.
- Three primary buttons (MUI Button with 48 px+ height):
  - **Looks right** → `UPDATE holes SET orientation_confidence = 'manual'`
  - **Flip it** → swap tee/green coords, `rotation_radians = (rotation_radians + PI) % (2*PI)`, set to `manual`
  - **Skip** → next hole, no DB change
- "Preview flip" secondary button that rotates the SVG 180° in place before committing.
- Progress: "12 reviewed · 47 remaining".

**Folder:** `src/admin/` with `pages/`, `components/`, `hooks/`. Use existing MUI theme and `PageHeader` component pattern.

**Repository additions:**
- `src/services/adminCoursesRepo.ts` — admin-scoped course queries (all sources, including `api`).
- `src/services/holesRepo.ts` — read/update holes + features.

**Acceptance:**
- Logging in as admin shows the `/admin` link (in the user menu or settings — wire it in cleanly).
- Non-admins navigating to `/admin/*` are redirected.
- I can search GolfCourseAPI, bulk-import 20 courses, watch them sync over the next cron cycle (or trigger manually), and review the few that come back with low-confidence orientations.

---

## Phase 5: Hole Layout Component (`src/features/course/`)

The README already calls out `src/features/course/` as reserved for V2 GPS hole maps — this is that feature.

**Files:**

`src/features/course/useHoleLayout.ts` — TanStack Query hook.
```ts
export function useHoleLayout(courseId: string | null, holeNumber: number)
```
Returns `{ data, isLoading, status }` where `status` is one of:
- `loading` — fetching
- `ready` — data is here
- `unavailable` — course is `no_coverage` or `skip`
- `pending` — course is still `pending` or `failed`
- `none` — no courseId provided

`src/features/course/projectHoleCoords.ts` — pure function. Returns a `(lng, lat) => [x, y]` projector from the cached `rotation_radians`.

`src/features/course/HoleLayout.tsx` — SVG component.
- Props: `courseId`, `holeNumber`, `compact?: boolean`, `className?: string`.
- Renders fairway, green, bunkers, water, tee polygons, hole centerline.
- Markers: Tee pill at the tee, small red flag at the green.
- In `compact` mode: smaller markers, no extra padding, fills width.
- Colors: fairway `#7cb342`, green `#a5d6a7`, bunker `#fdd835`, water `#4fc3f7`, tee `#c5e1a5`. Background `#2d3e2d`.
- Fallback states (`unavailable`, `pending`) render a clean MUI Card with par + yardage from the existing scorecard data — no broken-looking empty SVG.

`src/features/course/HoleLayoutCard.tsx` — wrapper that combines the SVG with par/yardage chips for use on the hole tracking screen.

**Integration into `HoleTracking.tsx`:**
- Add `<HoleLayoutCard courseId={round.courseId} holeNumber={currentHole} compact />` **above** the existing score readout, **below** the page header.
- Constrain max height to ~30 % of viewport on phones so the score entry stays prominent. Use `sx={{ maxHeight: { xs: '30vh', sm: '40vh' } }}`.
- If `status === 'pending'`, show a small inline loading indicator inside the card. Refetch when the screen regains focus (TanStack Query default `refetchOnWindowFocus` is fine).

**Do not modify** the existing shot logging, autosave, or scoring logic. The layout is purely visual.

**Acceptance:**
- On a synced course, the current hole's layout appears at the top of the tracking screen.
- Advancing holes transitions smoothly (TanStack Query keeps adjacent holes cached).
- User-added courses show the fallback card, not an empty SVG.
- Removing the component would leave the rest of the page working unchanged (no coupling).

---

## Phase 6: Enhance Start Round Picker

Update `src/pages/round/StartRound.tsx` minimally:

- The existing flow lets users pick an existing course or fill in a new one. Keep both paths.
- Add a search field at the top of the picker that filters the existing course list client-side first.
- If no results match the search, show a "Add this course manually" button that opens the existing manual entry path with the search query pre-filled in the name field.
- For `api`-sourced courses, show a small "Verified" or 🏌️ badge so users learn to prefer them.

**Do not** add GolfCourseAPI search to the user flow — that's admin-only. Users only see courses already in the library plus the existing manual fallback.

**Acceptance:**
- User flow is unchanged for power users — they can still type a course name and create one.
- New behavior: typing in the search box filters the visible list. Picking a pre-loaded course is one tap.
- The admin-imported courses look slightly more polished than user-added ones (the badge).

---

## Implementation Order

Do this in order. **Stop after each phase**, summarize what changed, tell me how to test, and wait for my confirmation before moving on.

1. Phase 1 — schema migration + types
2. Phase 2 — GolfCourseAPI edge function (test with curl/Postman before UI)
3. Phase 3 — OSM sync edge function + cron
4. Phase 5 — `HoleLayout` component + hooks (before admin, so admin can use it)
5. Phase 4 — admin panel
6. Phase 6 — Start Round picker enhancements

> Phase 5 before Phase 4 is intentional — admin panel needs the layout component for previews and orientation review.

## What to Ask Me Before Starting

- Confirm my user id / email so I can set `is_admin = true` after Phase 1
- Whether `GOLFCOURSEAPI_KEY` is already a Supabase secret or needs adding
- Where the admin link should live — Settings page, user menu, or a separate icon in the header

## What NOT to Do

- Don't refactor `HoleTracking.tsx`, `AddShotSheet.tsx`, `useAutosaveHole`, `roundStore`, or any scoring logic.
- Don't add new state management or UI libraries.
- Don't call Overpass or GolfCourseAPI from the client.
- Don't deduplicate or reorganize existing `clubs` / `user_bag` code.
- Don't run Overpass synchronously on import (keep user-facing edge functions fast).
- Don't write tests unless I ask — ship the feature first.
