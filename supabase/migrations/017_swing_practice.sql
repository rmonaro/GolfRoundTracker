-- 017_swing_practice.sql
-- Apple Watch motion-based swing feedback (practice mode).
--
-- IMPORTANT: every value stored here is a MOTION-BASED ESTIMATE or a RELATIVE
-- CONSISTENCY SCORE derived from Apple Watch inertial sensors. None of these
-- columns represent launch-monitor measurements — no club path, face angle,
-- swing-plane degrees, launch angle, ball speed, spin, or carry distance.
--
-- Additive only: no existing table is modified. Rounds / shots / holes are
-- untouched, so the live round-tracking flow is unaffected.

-- A single practice session = a bucket of swings the user takes at the range.
create table if not exists public.swing_sessions (
  id uuid primary key default uuid_generate_v4(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  -- Club the session started on (the user can change it per swing).
  primary_club_id uuid references public.clubs(id) on delete set null,
  swing_count integer not null default 0,
  -- Session rollups (filled at end-of-session by the rules engine).
  avg_tempo_ratio numeric(4, 2),
  tempo_consistency_score integer,            -- 0-100 relative
  plane_consistency_score integer,            -- 0-100 relative "swing motion pattern"
  fatigue_trend text check (fatigue_trend in ('none', 'possible', 'likely')),
  notes text
);
create index if not exists swing_sessions_user_started_idx
  on public.swing_sessions (user_id, started_at desc);

-- One row per detected swing. The watch computes the per-swing motion metrics
-- and ships them over WatchConnectivity; the phone persists them here.
create table if not exists public.swing_metrics (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references public.swing_sessions(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  swing_index integer not null,               -- 0-based order within the session
  club_id uuid references public.clubs(id) on delete set null,
  captured_at timestamptz not null default now(),

  -- Timing (milliseconds) — derived from the motion phase machine.
  backswing_time_ms integer not null,
  downswing_time_ms integer not null,
  tempo_ratio numeric(4, 2) not null,         -- backswing : downswing

  -- Relative 0-100 scores. NOT physical measurements.
  transition_score integer not null,
  estimated_hand_speed integer not null,      -- relative effort, NOT mph
  wrist_rotation_score integer not null,
  finish_stability_score integer not null,
  -- Derived on the phone against the session/user baseline (null until a
  -- baseline of >= ~3-5 swings exists).
  swing_consistency_score integer,
  plane_consistency_score integer,
  -- Unit rotation-axis vector [x,y,z] used only to compare swing-motion
  -- pattern consistency across swings. Not an absolute plane angle.
  plane_axis jsonb,

  -- Optional manual shot-result entry by the user.
  shot_result text check (shot_result in (
    'straight', 'left', 'right', 'short', 'long',
    'thin', 'fat', 'toe', 'heel',
    'bunker', 'rough', 'fairway', 'green'
  )),
  created_at timestamptz not null default now()
);
create index if not exists swing_metrics_session_idx
  on public.swing_metrics (session_id, swing_index);
create index if not exists swing_metrics_user_idx
  on public.swing_metrics (user_id, captured_at desc);

-- Feedback emitted by the rules engine (and, later, the AI coach). Stored so
-- the session summary and history can replay what the user was told.
create table if not exists public.swing_feedback (
  id uuid primary key default uuid_generate_v4(),
  session_id uuid not null references public.swing_sessions(id) on delete cascade,
  -- Null swing_id = session-level feedback (consistency, fatigue, etc.).
  swing_id uuid references public.swing_metrics(id) on delete cascade,
  level text not null check (level in ('positive', 'neutral', 'attention')),
  code text not null,                         -- e.g. 'TEMPO_GOOD', 'FINISH_UNSTABLE'
  message text not null,
  source text not null default 'rules' check (source in ('rules', 'ai')),
  ai_payload jsonb,                           -- explanation/drill/focus (V2 AI coach)
  created_at timestamptz not null default now()
);
create index if not exists swing_feedback_session_idx
  on public.swing_feedback (session_id, created_at);

-- Row Level Security: owner-only, mirroring the rounds/shots policies.
alter table public.swing_sessions enable row level security;
alter table public.swing_metrics enable row level security;
alter table public.swing_feedback enable row level security;

create policy "swing_sessions_owner_rw" on public.swing_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create policy "swing_metrics_owner_rw" on public.swing_metrics
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Feedback is owned transitively through its session.
create policy "swing_feedback_owner_rw" on public.swing_feedback
  for all using (
    exists (
      select 1 from public.swing_sessions s
      where s.id = swing_feedback.session_id and s.user_id = auth.uid()
    )
  ) with check (
    exists (
      select 1 from public.swing_sessions s
      where s.id = swing_feedback.session_id and s.user_id = auth.uid()
    )
  );
