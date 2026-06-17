-- Record which aim target a range shot was hit at, so each shot can report its
-- result relative to that target (on target / left / right / short / long).
-- Nullable: shots taken with no target selected stay null. ON DELETE SET NULL
-- so deleting a target doesn't cascade-delete the shots aimed at it.
alter table public.range_shots
  add column if not exists target_id uuid references public.range_targets(id) on delete set null;

create index if not exists range_shots_target_id_idx on public.range_shots (target_id);
