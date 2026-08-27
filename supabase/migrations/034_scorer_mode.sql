-- Migration 034 — Scorer mode (tournament rounds tracked by an assigned scorekeeper)
-- Dialect: PostgreSQL (Supabase). Safe to re-run.
--
-- A TournamentManagement admin assigns a scorekeeper to a tee group; that person 
-- opens GRT and records shots for the 2-4 players in their group. See
-- docs/SCORER_MODE.md for the full design.
--
-- PURELY ADDITIVE. Every column here is nullable or defaulted, every policy is
-- PERMISSIVE (Postgres ORs permissive policies together, exactly like the admin
-- policies in migration 022), and no existing policy is touched. A golfer
-- starting and tracking their own round is unaffected — their rounds get
-- scoring_mode = 'SELF' and behave exactly as before.
--
-- Ownership model (the load-bearing decision):
--   The scorer OWNS every row they write while tracking (rounds.user_id = the
--   scorer). That is what lets the existing offline reconciler work untouched —
--   it writes rows the caller owns, so the existing owner policies pass and no
--   new write policy is needed during play. On finish, ownership transfers to
--   the athlete: because round_holes and shots derive their policy from the
--   parent round, one UPDATE of rounds.user_id moves the whole round graph.
--   The policies below are what keep the scorer able to see (and, until the
--   athlete confirms, correct) the card after it has left their hands.

-- ---------------------------------------------------------------------------
-- 1. rounds — who recorded it, claim state, attestation, TM precedence.
-- ---------------------------------------------------------------------------
alter table public.rounds
  -- Set when someone other than the owner recorded the round. Survives the
  -- ownership transfer; it is the scorer's only handle on the card afterwards.
  add column if not exists scored_by_user_id uuid references public.profiles(id),
  -- 'SELF'   — the golfer tracked their own round (everything before this
  --            migration, and every non-tournament round after it).
  -- 'MARKER' — recorded by an assigned scorekeeper.
  add column if not exists scoring_mode text not null default 'SELF',
  -- Claim keys. Set while a marker round has no linked GRT athlete: the player
  -- registered for the tournament but has never opened GRT. Cleared on claim.
  add column if not exists pending_athlete_email text,
  add column if not exists pending_registration_id uuid,
  -- Attestation. Real golf has the player sign the marker's card; until this is
  -- stamped the round shows as unconfirmed in the athlete's history.
  add column if not exists athlete_confirmed_at timestamptz,
  add column if not exists athlete_dispute_note text,
  -- Which card feeds TM's leaderboard when an athlete ALSO tracked themselves.
  -- 'PRIMARY' pushes; 'MARKER_BACKUP' is kept but not forwarded. Null for the
  -- ordinary case where only one card exists.
  add column if not exists tm_card_role text;

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'rounds_scoring_mode_check') then
    alter table public.rounds add constraint rounds_scoring_mode_check
      check (scoring_mode in ('SELF', 'MARKER'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'rounds_tm_card_role_check') then
    alter table public.rounds add constraint rounds_tm_card_role_check
      check (tm_card_role is null or tm_card_role in ('PRIMARY', 'MARKER_BACKUP'));
  end if;
end $$;

create index if not exists rounds_scored_by_idx
  on public.rounds(scored_by_user_id) where scored_by_user_id is not null;
-- Drives the claim lookup: "any unclaimed card waiting for this email?"
create index if not exists rounds_pending_claim_idx
  on public.rounds(lower(pending_athlete_email)) where pending_athlete_email is not null;

-- ---------------------------------------------------------------------------
-- 2. RLS — the scorer's access to a card they recorded.
--
-- Additive only. During play none of this is load-bearing (the scorer is the
-- owner); it matters after the round transfers to the athlete.
--   • select — always, so the scorer can review what they submitted.
--   • write  — only until the athlete confirms, so a disputed card can be
--              corrected but a signed one cannot be quietly rewritten.
-- ---------------------------------------------------------------------------
do $$ begin
  drop policy if exists "rounds_scorer_select" on public.rounds;
  create policy "rounds_scorer_select" on public.rounds
    for select using (scored_by_user_id = auth.uid());

  drop policy if exists "rounds_scorer_write" on public.rounds;
  create policy "rounds_scorer_write" on public.rounds
    for update
    using (scored_by_user_id = auth.uid() and athlete_confirmed_at is null)
    with check (scored_by_user_id = auth.uid() and athlete_confirmed_at is null);

  drop policy if exists "round_holes_scorer_select" on public.round_holes;
  create policy "round_holes_scorer_select" on public.round_holes
    for select using (exists (
      select 1 from public.rounds r
      where r.id = round_holes.round_id and r.scored_by_user_id = auth.uid()
    ));

  drop policy if exists "round_holes_scorer_write" on public.round_holes;
  create policy "round_holes_scorer_write" on public.round_holes
    for all
    using (exists (
      select 1 from public.rounds r
      where r.id = round_holes.round_id
        and r.scored_by_user_id = auth.uid()
        and r.athlete_confirmed_at is null
    ))
    with check (exists (
      select 1 from public.rounds r
      where r.id = round_holes.round_id
        and r.scored_by_user_id = auth.uid()
        and r.athlete_confirmed_at is null
    ));

  drop policy if exists "shots_scorer_select" on public.shots;
  create policy "shots_scorer_select" on public.shots
    for select using (exists (
      select 1 from public.rounds r
      where r.id = shots.round_id and r.scored_by_user_id = auth.uid()
    ));

  drop policy if exists "shots_scorer_write" on public.shots;
  create policy "shots_scorer_write" on public.shots
    for all
    using (exists (
      select 1 from public.rounds r
      where r.id = shots.round_id
        and r.scored_by_user_id = auth.uid()
        and r.athlete_confirmed_at is null
    ))
    with check (exists (
      select 1 from public.rounds r
      where r.id = shots.round_id
        and r.scored_by_user_id = auth.uid()
        and r.athlete_confirmed_at is null
    ));
end $$;

-- ---------------------------------------------------------------------------
-- 3. tm_scorer_assignments — cache of "tee groups I'm scoring".
--
-- Same shape and purpose as tm_links (migration 021): refreshed from TM's
-- /api/integration/scorers/assignments by the tm-integration edge function, and
-- read straight from here when there is no signal. A tournament course with a
-- dead cell zone must not be able to hide a scorer's group list from them.
-- ---------------------------------------------------------------------------
create table if not exists public.tm_scorer_assignments (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  -- TM's tee_groups.id — the unit of assignment.
  tee_group_id uuid not null,
  tournament_id uuid,
  tournament_slug text,
  tournament_name text,
  round_number integer,
  tee_time timestamptz,
  starting_hole integer,
  external_course_id text,
  -- The 2-4 players in the group, as returned by TM: registration_id, name,
  -- email, grt_athlete_id, division, scorecard. This snapshot is also what the
  -- edge function checks a scorer's push against, so it is authorization data,
  -- not just a render cache.
  players jsonb not null default '[]'::jsonb,
  snapshot jsonb,
  updated_at timestamptz not null default now(),
  unique (user_id, tee_group_id)
);

create index if not exists tm_scorer_assignments_user_idx
  on public.tm_scorer_assignments(user_id);

alter table public.tm_scorer_assignments enable row level security;

do $$ begin
  drop policy if exists "tm_scorer_assignments_owner_rw" on public.tm_scorer_assignments;
  create policy "tm_scorer_assignments_owner_rw" on public.tm_scorer_assignments
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
end $$;

-- ---------------------------------------------------------------------------
-- 4. claim_marker_rounds() — attach unclaimed marker cards to their athlete.
--
-- Called after sign-in and after each entitlements refresh, so an athlete who
-- registers for GRT after their tournament finds the round already waiting.
--
-- The caller can only ever claim rounds whose pending_athlete_email equals
-- THEIR OWN profile email, and that email originates from the TM registration
-- record rather than anything the scorer typed. SECURITY DEFINER because the
-- caller does not yet own the rows it is about to hand them.
--
-- The reverse direction (scorer -> athlete at finish time) is deliberately NOT
-- exposed as an RPC: it would mean trusting a client-supplied athlete id, which
-- would let a scorer push a bogus card into any user's history. That transfer
-- runs in the tm-integration edge function, which knows the real athlete id
-- from TM's assignment payload.
-- ---------------------------------------------------------------------------
create or replace function public.claim_marker_rounds()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := auth.uid();
  caller_email text;
  claimed integer;
begin
  if caller is null then return 0; end if;

  select lower(trim(email)) into caller_email from public.profiles where id = caller;
  if caller_email is null or caller_email = '' then return 0; end if;

  update public.rounds
     set user_id = caller,
         pending_athlete_email = null
   where scoring_mode = 'MARKER'
     and pending_athlete_email is not null
     and lower(trim(pending_athlete_email)) = caller_email
     and user_id is distinct from caller;

  get diagnostics claimed = row_count;
  return claimed;
end;
$$;

grant execute on function public.claim_marker_rounds() to authenticated;
