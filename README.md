# Golf Round Tracker

Mobile-first, dark-mode-by-default golf score and shot tracking app.

- **React 18** + **Vite** + **TypeScript**
- **Material UI v6** with a custom green-on-near-black theme and 48px+ tap targets
- **Supabase** for Postgres + Auth (Row Level Security; users only ever read their own data)
- **Zustand** for client state, persisted active rounds, plus **TanStack Query** for server cache
- **PWA** (installable, offline shell, theme color, safe-area-aware)
- Watch UI mock (round-context simplified view)

The architecture leaves room for a V2 GPS / strokes-gained engine without changing the data model.

---

## Quick start

```bash
# 1. install
npm install

# 2. configure supabase
cp .env.example .env.local
# fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY

# 3. push the schema to your Supabase project
#    (in the Supabase dashboard SQL editor, paste supabase/schema.sql)

# 4. run the dev server
npm run dev
```

Open http://localhost:5173 on a phone (same WiFi) to test the mobile experience.

### Supabase setup

1. Create a new project at https://supabase.com.
2. In **SQL Editor**, run `supabase/schema.sql`. This creates all tables, types, indexes, the auto-profile trigger, and RLS policies.
3. (Optional) After signing up at least one user via the app, replace `:USER_UUID` in `supabase/seed.sql` with that user's id (Auth → Users) and run it for demo data.
4. In **Authentication → Providers**, enable email/password (it's on by default).
5. Copy your project URL and anon key into `.env.local`.

---

## Folder structure

```
src/
  app/                application bootstrap, providers, global CSS
  components/         reusable UI building blocks
    layout/           shell, page header
    ui/               StatCard, EmptyState, ToggleGroup, NumberStepper
    forms/            (reserved for shared form bits)
    charts/           (reserved for V2 custom charts)
  pages/
    auth/             AuthLayout, Login, SignUp, ForgotPassword
    bag/              BagPage
    round/            RoundHome, StartRound, HoleTracking, RoundSummary, PastRounds
    stats/            StatsPage
    settings/         SettingsPage
    watch/            WatchPage (round-context simplified UI)
  features/
    auth/             AuthProvider, AuthGuard
    bag/              useBag hook, default-club seed
    round/            useStartRound, useAutosaveHole, AddShotDialog, computeRoundTotals
    stats/            useRounds, computeStats
    course/           (reserved)
  services/           Repository pattern over Supabase + AppError wrapper
    profileRepo.ts
    bagRepo.ts
    courseRepo.ts
    roundRepo.ts
    authService.ts
    errors.ts
  stores/             Zustand stores
    authStore.ts
    bagStore.ts
    roundStore.ts     ← active round is persisted to localStorage
    statsStore.ts
    settingsStore.ts  ← theme mode + watch toggle, persisted
  hooks/              (reserved for shared cross-feature hooks)
  models/             domain-facing type re-exports (Profile, Round, Shot, etc.)
  utils/              handicap math, formatters
  router/             AppRouter — public auth routes + AuthGuard'd app shell
  theme/              MUI dark + light theme tokens, brand colors
  types/              database.ts — hand-typed Supabase types
  lib/                supabase.ts client
supabase/
  schema.sql          tables, types, RLS, trigger
  seed.sql            sample data (requires a real user id)
public/
  favicon.svg
```

---

## How the round flow works

1. **Start Round** picks an existing course or creates one with rating/slope/par/yardage.
2. The round is created, then 9/18/N empty holes are batch-upserted so each hole has a stable id.
3. The **Hole Tracking** screen edits strokes / putts / penalty via 48px steppers, plus fairway result (Hit/Left/Right/Short/Long/N/A), Sand y/n, GIR y/n, and an **Add Shot** dialog populated from the user's bag.
4. Edits flow through Zustand → debounced autosave (`useAutosaveHole`) → Supabase. The active round is also persisted to `localStorage`, so closing the app and returning resumes the exact state.
5. **Finish Round** updates the round with total score, score-vs-par, and `completed_at`, then navigates to the summary, where the **handicap differential** is computed and persisted: `(score − courseRating) × 113 / slopeRating`.
6. **Stats** aggregates across rounds: rolling estimated handicap (1–2 rounds → message, 3–19 → lowest, 20+ → average best 8 of last 20), score trend, differential trend, club usage.

The summary screen and stats screen both display the disclaimer **"Estimated handicap only. Not an official USGA handicap."**

---

## Watch UI

`/watch` renders a watch-shaped frame with two screens:

- **Home**: hole number, par, yardage, score, plus *Add Shot*, *+ Stroke*, *+ Putt*, *Next*.
- **Club picker**: 5 large category tiles (Driver / Wood / Iron / Wedge / Putter).

Each tile records a quick shot using the first matching club from the bag. The screen is purely for V1 visualization; the wear-os/Apple-watch native build is V2.

---

## V2 placeholders

The codebase deliberately leaves room for these without schema migration risk:

- GPS-based shot distance, club averages, longest drive
- Miss tendency / shot dispersion AI on top of the `shots` table
- Course hole-map storage in Supabase Storage
- Strokes gained calculations driven by the existing `shots.shot_result` enum
- Putting analytics from `round_holes.putts` plus shot-level `green` events

`features/course/`, `components/charts/`, and `hooks/` are scaffolded empty to absorb that work.

---

## Notes

- We treat `estimated_handicap` as a computed value, not authoritative truth. The differential per round is what we persist.
- The `clubs` table is shared (public read, authenticated insert). The user's *bag composition* is private via `user_bag` + RLS.
- `courses.created_by_user` can be null, in which case the row is visible to everyone — leaves the door open for an admin-seeded shared course catalog.
- Errors from Supabase are normalised through `AppError` so the UI shows a friendly message every time.
