-- Migration 006 — per-shot penalty_type
-- Dialect: PostgreSQL (Supabase). T-SQL linter false-positives expected; paste as-is.
-- Safe to re-run.
--
-- Replaces the old hole-level `penalty_strokes` editing flow with per-shot
-- penalty tagging. The hole's penalty_strokes column is still populated
-- (derived client-side from shots) so handicap math is unchanged.

alter table public.shots add column if not exists penalty_type text
  check (penalty_type in ('ob', 'water', 'lost_ball', 'unplayable', 'wrong_ball', 'bunker'));
