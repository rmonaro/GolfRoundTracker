-- Migration 035 — a scorekeeper can read the bag of a player they're scoring.
-- Dialect: PostgreSQL (Supabase). Safe to re-run.
--
-- When a scorer records a shot they have to say which club it was, and the
-- useful answer is the club from THAT PLAYER'S bag — with the player's own
-- typical carry distances, so the app can suggest one from the distance the
-- scorer just tapped on the map. Using the scorekeeper's own bag would put the
-- wrong club names on somebody else's round.
--
-- PURELY ADDITIVE and READ-ONLY. Postgres ORs permissive policies together, so
-- this only widens SELECT; the existing owner policy is untouched and nobody
-- gains write access to anyone else's bag.
--
-- Scope is deliberately narrow: readable only while an assignment row says this
-- caller is scoring a group containing that athlete. The assignment cache is
-- written by the tm-integration edge function from TM's own pairing data, so a
-- client cannot grant itself access by writing its own row — tm_scorer_assignments
-- is owner-scoped, but its contents come from TM.
--
-- What this exposes: club names and typical carry yardages, to a person the
-- tournament assigned to walk with that player. Nothing else in user_bag is
-- sensitive, and no other table is touched.

do $$ begin
  drop policy if exists "user_bag_scorer_select" on public.user_bag;
  create policy "user_bag_scorer_select" on public.user_bag
    for select using (
      exists (
        select 1
        from public.tm_scorer_assignments a
        where a.user_id = auth.uid()
          and a.players @> jsonb_build_array(
                jsonb_build_object('grt_athlete_id', public.user_bag.user_id::text)
              )
      )
    );
end $$;
