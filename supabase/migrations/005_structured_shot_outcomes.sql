-- Migration 005 — structured shot outcomes
-- Dialect: PostgreSQL (Supabase). Editors with a T-SQL linter will flag these
-- as errors; they are valid Postgres. Safe to re-run.
--
-- Splits the old monolithic shot_result enum into three orthogonal columns:
--   • target_type   — what the golfer was aiming at (green / fairway / putt)
--   • target_result — outcome relative to that target
--   • lie           — where the ball ended up
--
-- shot_result stays on the table as a derived backwards-compat field.

alter table public.shots add column if not exists target_type text
  check (target_type in ('green', 'fairway', 'putt'));

alter table public.shots add column if not exists target_result text
  check (target_result in ('hit', 'left', 'right', 'short', 'long', 'made', 'missed'));

alter table public.shots add column if not exists lie text
  check (lie in ('fairway', 'rough', 'bunker', 'green', 'penalty'));
