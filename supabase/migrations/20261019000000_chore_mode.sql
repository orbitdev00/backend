-- ════════════════════════════════════════════════════════════════════════════
-- Household Chore Dashboard (chore mode) — see ORBIT_CHORE_MODE.md
--
-- Live tables are read-only for the public (anon) role. Every edit is written
-- to pending_changes and only reaches the live tables after a reviewer with
-- CHORE_APPROVAL_PIN approves it via the FastAPI backend (POST /chores/review),
-- which uses the service role key.
--
-- Additive only: does not touch any existing Orbit table, policy or function.
-- Uses plain CREATE (no IF NOT EXISTS / OR REPLACE) so it fails loudly instead
-- of attaching to an existing object if a name were ever already taken.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Tables ──────────────────────────────────────────────────────────────────

create table public.chore_members (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (char_length(name) between 1 and 40),
  color       text not null default '#6366f1' check (color ~ '^#[0-9a-fA-F]{6}$'),
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table public.chores (
  id                 uuid primary key default gen_random_uuid(),
  title              text not null check (char_length(title) between 1 and 120),
  frequency          text not null check (frequency in ('daily', 'weekly', 'monthly')),
  zone               text not null default 'General' check (char_length(zone) between 1 and 40),
  minutes            integer not null default 15 check (minutes between 1 and 600),
  preferred_weekday  smallint check (preferred_weekday between 0 and 6),   -- 0 = Sunday (weekly)
  month_day          smallint check (month_day between 1 and 31),          -- monthly
  active             boolean not null default true,
  created_at         timestamptz not null default now()
);

-- Manual (non-rotation) assignment of one chore occurrence to a member.
create table public.chore_assignments (
  id          uuid primary key default gen_random_uuid(),
  chore_id    uuid not null references public.chores(id) on delete cascade,
  date        date not null,
  member_id   uuid references public.chore_members(id) on delete cascade,
  overridden  boolean not null default true,
  unique (chore_id, date)
);

create table public.chore_completions (
  id            uuid primary key default gen_random_uuid(),
  chore_id      uuid not null references public.chores(id) on delete cascade,
  date          date not null,
  completed_at  timestamptz not null default now(),
  unique (chore_id, date)
);

create table public.chore_settings (
  id                smallint primary key default 1 check (id = 1),
  rotation_enabled  boolean not null default true
);

create table public.pending_changes (
  id            uuid primary key default gen_random_uuid(),
  change_type   text not null check (change_type in (
                  'chore_add', 'chore_edit', 'chore_delete',
                  'member_add', 'member_edit', 'member_remove',
                  'assignment_set', 'completion_set',
                  'rotation_toggle', 'reset_defaults')),
  target_table  text not null,
  target_id     uuid,
  payload       jsonb not null default '{}'::jsonb,
  summary       text not null check (char_length(summary) between 1 and 300),
  submitted_at  timestamptz not null default now(),
  status        text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_at   timestamptz
);

create index chore_assignments_date_idx on public.chore_assignments (date);
create index chore_completions_date_idx on public.chore_completions (date);
create index pending_changes_status_idx on public.pending_changes (status, submitted_at);

-- ── Row level security ──────────────────────────────────────────────────────
-- anon/authenticated: SELECT only. There are no INSERT/UPDATE/DELETE policies, so
-- only the service role (the backend) writes. Submissions go through the backend's
-- rate-limited POST /chores/submit and can't be inserted directly with the anon key.

alter table public.chore_members     enable row level security;
alter table public.chores            enable row level security;
alter table public.chore_assignments enable row level security;
alter table public.chore_completions enable row level security;
alter table public.chore_settings    enable row level security;
alter table public.pending_changes   enable row level security;

create policy "chore_members public read"     on public.chore_members     for select to anon, authenticated using (true);
create policy "chores public read"            on public.chores            for select to anon, authenticated using (true);
create policy "chore_assignments public read" on public.chore_assignments for select to anon, authenticated using (true);
create policy "chore_completions public read" on public.chore_completions for select to anon, authenticated using (true);
create policy "chore_settings public read"    on public.chore_settings    for select to anon, authenticated using (true);
create policy "pending_changes public read"   on public.pending_changes   for select to anon, authenticated using (true);

-- Belt and braces: table privileges match the policies above.
revoke insert, update, delete, truncate on public.chore_members, public.chores, public.chore_assignments,
  public.chore_completions, public.chore_settings, public.pending_changes from anon, authenticated;
grant select on public.chore_members, public.chores, public.chore_assignments,
  public.chore_completions, public.chore_settings, public.pending_changes to anon, authenticated;

-- ── Default data ────────────────────────────────────────────────────────────
-- Used for the initial seed and for an approved "Reset Default Data" change.
-- created_at is staggered so the list order (and therefore rotation) is stable.

create function public.chore_reset_defaults()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  base timestamptz := now();
begin
  delete from public.chore_completions where true;
  delete from public.chore_assignments where true;
  delete from public.chores where true;
  delete from public.chore_members where true;

  insert into public.chore_members (name, color, created_at) values
    ('Alex',   '#6366f1', base + interval '1 ms'),
    ('Sam',    '#10b981', base + interval '2 ms'),
    ('Jordan', '#f59e0b', base + interval '3 ms');

  insert into public.chores (title, frequency, zone, minutes, preferred_weekday, month_day, created_at) values
    ('Dog Care: Feed, Water & Quick Walk',      'daily',   'Pet',         20, null, null, base + interval '1 ms'),
    ('Kitchen & Dishes Maintenance',            'daily',   'Kitchen',     25, null, null, base + interval '2 ms'),
    ('High-Traffic Spot Sweep & Reset',         'daily',   'Living Room', 15, null, null, base + interval '3 ms'),
    ('Trash & Recycling Drop-off',              'daily',   'General',     10, null, null, base + interval '4 ms'),
    ('Clean Bathroom 1 (Master)',               'weekly',  'Bathroom',    30, 1,    null, base + interval '5 ms'),
    ('Clean Bathroom 2 (Guest)',                'weekly',  'Bathroom',    30, 2,    null, base + interval '6 ms'),
    ('Laundry: Wash, Fold & Put Away',          'weekly',  'General',     45, 3,    null, base + interval '7 ms'),
    ('Bed Linens Change (3 Bedrooms)',          'weekly',  'Bedrooms',    30, 4,    null, base + interval '8 ms'),
    ('Vacuum Carpets & Mop Floors',             'weekly',  'General',     40, 5,    null, base + interval '9 ms'),
    ('Dust Furniture & Hard Surfaces',          'weekly',  'Living Room', 25, 6,    null, base + interval '10 ms'),
    ('Dog Care: Wash Bowls & Bedding',          'weekly',  'Pet',         20, 0,    null, base + interval '11 ms'),
    ('Deep Clean Refrigerator & Toss Expired',  'monthly', 'Kitchen',     45, null, 1,    base + interval '12 ms'),
    ('Dust 4 Ceiling Fans & Fixtures',          'monthly', 'General',     30, null, 5,    base + interval '13 ms'),
    ('Wipe Down Baseboards & Light Switches',   'monthly', 'General',     40, null, 10,   base + interval '14 ms'),
    ('Descaling Dishwasher & Washer Cycles',    'monthly', 'Kitchen',     20, null, 15,   base + interval '15 ms');

  insert into public.chore_settings (id, rotation_enabled) values (1, true)
    on conflict (id) do update set rotation_enabled = excluded.rotation_enabled;
end;
$$;

revoke all on function public.chore_reset_defaults() from public, anon, authenticated;
grant execute on function public.chore_reset_defaults() to service_role;

-- Seed once (no-op if members already exist).
do $$
begin
  if not exists (select 1 from public.chore_members) then
    perform public.chore_reset_defaults();
  end if;
end;
$$;
