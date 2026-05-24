-- Migration 003 — track which clubs were used on each hole.
-- Stored as a uuid[] for V1 simplicity. For V2 analytics we may normalize this
-- into a junction table (round_hole_clubs) when shot-distance data starts flowing.
-- Safe to re-run.

alter table public.round_holes
  add column if not exists clubs_used uuid[] not null default '{}';

create index if not exists round_holes_clubs_used_idx
  on public.round_holes using gin (clubs_used);
