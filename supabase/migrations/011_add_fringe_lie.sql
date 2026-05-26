-- ---------------------------------------------------------------------------
-- 011_add_fringe_lie.sql
--
-- Extends `shots.lie` to include 'fringe' — used by the AddShotSheet when
-- a putt overshoots the hole and lands just off the green.
--
-- The original constraint was added inline by migration 004; Postgres named
-- it `shots_lie_check`. Drop + re-add idempotently.
-- ---------------------------------------------------------------------------

alter table public.shots drop constraint if exists shots_lie_check;

alter table public.shots add constraint shots_lie_check
  check (lie in ('fairway', 'rough', 'bunker', 'green', 'penalty', 'fringe'));
