-- Sample seed data. Run AFTER schema.sql.
-- The seed assumes you've already signed up a user and copied the auth uuid below.
-- To use:
--   1. Sign up via the app to create an auth.users row.
--   2. Replace :USER_UUID below with that user's id (visible in Supabase dashboard).
--   3. Run this file in the SQL editor.

-- A starter course
insert into public.courses (id, name, tee_box, course_rating, slope_rating, total_par, total_yardage, created_by_user)
values (
  'a0000000-0000-0000-0000-000000000001',
  'Pebble Hills Public',
  'White',
  71.2,
  124,
  72,
  6543,
  :USER_UUID
) on conflict (id) do nothing;

-- A demo completed round (front 9 only) so stats has something to render.
with new_round as (
  insert into public.rounds (
    id, user_id, course_id, course_name, holes_played,
    score, par, score_vs_par, started_at, completed_at,
    course_rating, slope_rating, handicap_differential
  ) values (
    'b0000000-0000-0000-0000-000000000001',
    :USER_UUID,
    'a0000000-0000-0000-0000-000000000001',
    'Pebble Hills Public',
    9,
    44,
    36,
    8,
    now() - interval '2 days',
    now() - interval '2 days' + interval '2 hours',
    71.2,
    124,
    round(((44 - 71.2) * 113.0 / 124.0)::numeric, 1)
  ) on conflict (id) do nothing
  returning id
)
insert into public.round_holes (round_id, hole_number, par, yardage, strokes, putts, fairway_result, sand, gir, penalty_strokes)
select 'b0000000-0000-0000-0000-000000000001', g.n, 4, 380, 5, 2, 'hit'::fairway_result, false, false, 0
from generate_series(1, 9) as g(n)
on conflict (round_id, hole_number) do nothing;
