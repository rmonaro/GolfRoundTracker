-- ---------------------------------------------------------------------------
-- 016_holes_shared_pin.sql
--
-- Adds shared, course-wide pin position columns to `public.holes`. When any
-- player moves the pin on the green, the new position is saved against the
-- course library hole so every other player on that course inherits it on
-- their next round.
--
-- Writes are gated behind a SECURITY DEFINER RPC so users can only update
-- the pin coordinates, never anything else on the global holes table.
-- Idempotent: safe to re-run.
-- ---------------------------------------------------------------------------

alter table public.holes
  add column if not exists pin_lng double precision,
  add column if not exists pin_lat double precision;

create or replace function public.set_hole_pin(
  p_hole_id uuid,
  p_lng double precision,
  p_lat double precision
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.holes
  set pin_lng = p_lng,
      pin_lat = p_lat
  where id = p_hole_id;
$$;

revoke all on function public.set_hole_pin(uuid, double precision, double precision) from public;
grant execute on function public.set_hole_pin(uuid, double precision, double precision) to authenticated;
