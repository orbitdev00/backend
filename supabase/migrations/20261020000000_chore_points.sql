-- ════════════════════════════════════════════════════════════════════════════
-- Matos Dashboard: points, streaks and leaderboard — see ORBIT_CHORE_MODE.md
--
-- • Edits apply immediately through the backend (POST /chores/submit, service
--   role key). pending_changes stays in place but is no longer used.
-- • Points, streaks and the leaderboard are never stored as editable values.
--   points_awarded is stamped on each chore_completions row when it is inserted
--   (minutes × difficulty multiplier), rows can't be updated, and everything
--   else is derived from those rows by the chore_leaderboard view.
-- • Chores are never hard-deleted (soft delete + retired_on), so past
--   completions and the points earned from them are kept.
-- • A chore's schedule is valid for [starts_on, retired_on). Schedule edits
--   retire the old row and start a new one, so past days (and streaks) never
--   change retroactively. All day boundaries use America/New_York.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Columns ─────────────────────────────────────────────────────────────────

alter table public.chores
  add column difficulty         text not null default 'easy' check (difficulty in ('easy', 'medium', 'hard')),
  add column description        text check (description is null or char_length(description) <= 500),
  add column time_of_day        time,
  add column allowed_member_ids uuid[],   -- null = everyone
  add column starts_on          date,
  add column retired_on         date;     -- first day the chore no longer applies

update public.chores
   set starts_on  = (created_at at time zone 'America/New_York')::date,
       retired_on = case when active then null else (created_at at time zone 'America/New_York')::date end;

alter table public.chores
  alter column starts_on set not null,
  alter column starts_on set default ((now() at time zone 'America/New_York')::date),
  add constraint chores_window_check check (retired_on is null or retired_on >= starts_on);

alter table public.chore_completions
  add column completed_by   uuid references public.chore_members(id),
  add column points_awarded integer not null default 0 check (points_awarded >= 0);

-- Never cascade a chore delete into completions (that would erase earned points).
alter table public.chore_completions drop constraint chore_completions_chore_id_fkey;
alter table public.chore_completions
  add constraint chore_completions_chore_id_fkey
  foreign key (chore_id) references public.chores(id) on delete restrict;

create index chore_completions_completed_by_idx on public.chore_completions (completed_by, date);

-- Rotation on/off history, so toggling it never reshuffles past days.
-- The state on a day is the latest row with effective_on <= that day (default on).
create table public.chore_rotation_log (
  effective_on  date primary key,
  enabled       boolean not null
);

alter table public.chore_rotation_log enable row level security;
create policy "chore_rotation_log public read" on public.chore_rotation_log for select to anon, authenticated using (true);
revoke all on public.chore_rotation_log from anon, authenticated;
grant select on public.chore_rotation_log to anon, authenticated;

-- ── Completion integrity ────────────────────────────────────────────────────
-- points_awarded always comes from the chore's current minutes and difficulty at
-- insert time, whatever the inserter sent. Completions are immutable: unchecking
-- deletes the row (and its points); there is nothing to edit.

create function public.chore_completion_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  c record;
begin
  select minutes, difficulty into c from public.chores where id = new.chore_id;
  if not found then
    raise exception 'unknown chore %', new.chore_id;
  end if;
  new.points_awarded := round(c.minutes * case c.difficulty when 'hard' then 2.0 when 'medium' then 1.5 else 1.0 end)::integer;
  new.completed_at := now();
  return new;
end;
$$;

create function public.chore_completion_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  raise exception 'chore_completions rows cannot be edited';
end;
$$;

revoke all on function public.chore_completion_stamp() from public, anon, authenticated;
revoke all on function public.chore_completion_immutable() from public, anon, authenticated;

create trigger chore_completions_stamp before insert on public.chore_completions
  for each row execute function public.chore_completion_stamp();
create trigger chore_completions_immutable before update on public.chore_completions
  for each row execute function public.chore_completion_immutable();

-- ── Schedule (internal) ─────────────────────────────────────────────────────
-- Who was assigned each chore on each of the last 400 days, and whether it was
-- done. Mirrors makeAssigner() in frontend/src/chores/schedule.js:
--   slot     = position of the chore among all chores ever created (created_at)
--   pool     = active allowed members (or all active members), by created_at
--   shift    = days since epoch (daily) / Sunday-weeks since epoch (weekly) /
--              0 (monthly, or rotation off that day)
--   assignee = manual override if its member is active, else pool[(slot + shift) % len]
-- Only the backend (service role) and the leaderboard view read it.

create view public.chore_schedule as
with bounds as (
  select (now() at time zone 'America/New_York')::date as today
),
days as (
  select d::date as date
  from bounds, generate_series(bounds.today - 400, bounds.today, interval '1 day') d
),
slots as (
  select c.*, (row_number() over (order by c.created_at, c.id) - 1)::int as slot
  from public.chores c
),
pools as (
  select s.id as chore_id,
         coalesce(
           nullif(array(select m.id from public.chore_members m
                         where m.active and (s.allowed_member_ids is null or m.id = any(s.allowed_member_ids))
                         order by m.created_at, m.id), '{}'::uuid[]),
           array(select m.id from public.chore_members m where m.active order by m.created_at, m.id)
         ) as pool
  from slots s
),
occ as (
  select s.id as chore_id, d.date, s.slot, s.frequency,
         coalesce((select l.enabled from public.chore_rotation_log l
                    where l.effective_on <= d.date
                    order by l.effective_on desc limit 1), true) as rotating
  from slots s
  join days d on d.date >= s.starts_on and (s.retired_on is null or d.date < s.retired_on)
  where case s.frequency
          when 'daily'   then true
          when 'weekly'  then extract(dow from d.date)::int = s.preferred_weekday
          when 'monthly' then extract(day from d.date)::int = least(
                                coalesce(s.month_day, 1),
                                extract(day from date_trunc('month', d.date) + interval '1 month - 1 day')::int)
          else false
        end
)
select o.chore_id,
       o.date,
       coalesce(
         ov.member_id,
         case when cardinality(p.pool) > 0 then
           p.pool[1 + (o.slot + case
                                  when not o.rotating then 0
                                  when o.frequency = 'daily'  then o.date - date '1970-01-01'
                                  when o.frequency = 'weekly' then (o.date - date '1970-01-01' + 4) / 7
                                  else 0
                                end) % cardinality(p.pool)]
         end
       ) as member_id,
       (cp.chore_id is not null) as done,
       cp.completed_by,
       cp.points_awarded
from occ o
join pools p on p.chore_id = o.chore_id
left join public.chore_assignments ov
  on ov.chore_id = o.chore_id and ov.date = o.date
 and exists (select 1 from public.chore_members m where m.id = ov.member_id and m.active)
left join public.chore_completions cp on cp.chore_id = o.chore_id and cp.date = o.date;

revoke all on public.chore_schedule from anon, authenticated;
grant select on public.chore_schedule to service_role;

-- ── Leaderboard (public, read only) ─────────────────────────────────────────
-- Points are sums of chore_completions.points_awarded by completed_by.
-- This Week starts on Sunday. A streak counts consecutive days on which the
-- member finished every task assigned to them. Days with nothing assigned
-- (or before the member joined) are skipped, and today only counts once it is
-- complete — it can't break the streak until midnight passes.
--
-- Runs with the view owner's rights so anon can read it without being granted
-- the internal chore_schedule view. Anon gets SELECT on this view and nothing else.

create view public.chore_leaderboard as
with bounds as (
  select t.today, t.today - extract(dow from t.today)::int as week_start
  from (select (now() at time zone 'America/New_York')::date as today) t
),
pts as (
  select c.completed_by as member_id,
         sum(c.points_awarded) filter (where c.date = b.today)        as points_today,
         sum(c.points_awarded) filter (where c.date >= b.week_start)  as points_week,
         sum(c.points_awarded)                                        as points_all
  from public.chore_completions c, bounds b
  where c.completed_by is not null
  group by c.completed_by
),
per_day as (
  select s.member_id, s.date, bool_and(s.done) as all_done
  from public.chore_schedule s
  join public.chore_members m on m.id = s.member_id
  where s.date >= (m.created_at at time zone 'America/New_York')::date
  group by s.member_id, s.date
),
last_miss as (
  select p.member_id, max(p.date) as date
  from per_day p, bounds b
  where not p.all_done and p.date < b.today
  group by p.member_id
),
streaks as (
  select p.member_id, count(*) as streak
  from per_day p
  left join last_miss lm on lm.member_id = p.member_id
  where p.all_done and (lm.date is null or p.date > lm.date)
  group by p.member_id
)
select m.id                               as member_id,
       m.name,
       m.color,
       coalesce(pts.points_today, 0)::int as points_today,
       coalesce(pts.points_week, 0)::int  as points_week,
       coalesce(pts.points_all, 0)::int   as points_all,
       coalesce(st.streak, 0)::int        as streak
from public.chore_members m
left join pts on pts.member_id = m.id
left join streaks st on st.member_id = m.id
where m.active;

revoke all on public.chore_leaderboard from anon, authenticated;
grant select on public.chore_leaderboard to anon, authenticated, service_role;

-- ── Default data ────────────────────────────────────────────────────────────
-- Replaces the earlier definition. Resets chores and members only — it never
-- touches chore_completions, so nobody loses earned points.
--   Members: exactly Misael, Penelope, Alex, Nathan (existing rows are reused so
--            their ids and points carry over). Anyone else is deleted, or
--            deactivated if they have completions.
--   Chores:  a default whose title matches an active chore is updated in place
--            (or versioned from tomorrow if its schedule differs); other active
--            chores are retired as of today; missing defaults start today.

create or replace function public.chore_reset_defaults()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  base         timestamptz := clock_timestamp();
  today        date := (now() at time zone 'America/New_York')::date;
  m            record;
  d            record;
  cur          record;
  mid          uuid;
  had          boolean;
  keep_members uuid[] := '{}';
  keep_chores  uuid[] := '{}';
  allowed      uuid[];
  new_id       uuid;
begin
  for m in
    select * from (values
      (1, 'Misael',   '#6366f1'),
      (2, 'Penelope', '#ec4899'),
      (3, 'Alex',     '#10b981'),
      (4, 'Nathan',   '#f59e0b')
    ) v(ord, name, color) order by ord
  loop
    select id into mid from public.chore_members
     where name = m.name order by active desc, created_at limit 1;
    if mid is null then
      insert into public.chore_members (name, color, created_at)
      values (m.name, m.color, base + m.ord * interval '1 ms')
      returning id into mid;
    else
      update public.chore_members set active = true, color = m.color where id = mid;
    end if;
    keep_members := keep_members || mid;
  end loop;

  delete from public.chore_members cm
   where cm.id <> all(keep_members)
     and not exists (select 1 from public.chore_completions c where c.completed_by = cm.id);
  update public.chore_members set active = false where id <> all(keep_members);

  for d in
    select * from (values
      ( 1, 'Feed, Water, and Walk Phoebe',             'daily',   'Pet',         20, 'easy',   null::smallint, null::smallint, null::time,
        'Fill food and water bowls and take Phoebe for a walk.', null::text[]),
      ( 2, 'Kitchen and Dishes (Noon)',                'daily',   'Kitchen',     25, 'medium', null, null, '12:00'::time,
        'Wash the dishes, clean the counters, wash the stove, wash the sink.', null),
      ( 3, 'Kitchen and Dishes (Evening)',             'daily',   'Kitchen',     30, 'medium', null, null, '19:00'::time,
        'Wash the dishes, clean the counters, wash the stove, wash the sink, bring the trash to the front.', null),
      ( 4, 'High-Traffic Spot Sweep and Reset',        'daily',   'Living Room', 15, 'easy',   null, null, null, null, null),
      ( 5, 'Clean Master Bathroom',                    'weekly',  'Bathroom',    30, 'hard',   1,    null, null, null, array['Misael', 'Penelope']),
      ( 6, 'Clean Guest Bathroom',                     'weekly',  'Bathroom',    30, 'hard',   2,    null, null, null, array['Alex', 'Nathan']),
      ( 7, 'Wash Bed Covers',                          'weekly',  'Bedrooms',    30, 'medium', 4,    null, null,
        'Pillow covers, colcha, and cubrecolchón.', null),
      ( 8, 'Vacuum All Carpets',                       'weekly',  'General',     25, 'medium', 5,    null, null, null, null),
      ( 9, 'Mop Floors',                               'weekly',  'General',     25, 'medium', 6,    null, null, null, null),
      (10, 'Wash Phoebe''s Bowls and Bedding',         'weekly',  'Pet',         20, 'easy',   0,    null, null, null, null),
      (11, 'Deep Clean Refrigerator and Toss Expired', 'monthly', 'Kitchen',     45, 'hard',   null, 1,    null, null, null),
      (12, 'Dust Ceiling Fans and Fixtures',           'monthly', 'General',     30, 'medium', null, 5,    null, null, null),
      (13, 'Wipe Down Baseboards and Light Switches',  'monthly', 'General',     40, 'medium', null, 10,   null, null, null),
      (14, 'Descale Dishwasher and Washer',            'monthly', 'Kitchen',     20, 'easy',   null, 15,   null, null, null)
    ) v(ord, title, frequency, zone, minutes, difficulty, weekday, month_day, time_of_day, description, allowed_names)
    order by ord
  loop
    allowed := case when d.allowed_names is null then null else
      array(select cm.id from public.chore_members cm
             where cm.id = any(keep_members) and cm.name = any(d.allowed_names)
             order by cm.created_at, cm.id) end;

    select * into cur from public.chores
     where active and title = d.title order by created_at limit 1;
    had := found;

    if had and (cur.frequency, cur.preferred_weekday, cur.month_day, cur.allowed_member_ids)
                 is not distinct from (d.frequency, d.weekday, d.month_day, allowed) then
      update public.chores
         set zone = d.zone, minutes = d.minutes, difficulty = d.difficulty,
             description = d.description, time_of_day = d.time_of_day
       where id = cur.id;
      keep_chores := keep_chores || cur.id;
    elsif had and cur.starts_on > today then
      -- Not started yet: nothing in the past depends on it, so edit in place.
      update public.chores
         set frequency = d.frequency, preferred_weekday = d.weekday, month_day = d.month_day,
             allowed_member_ids = allowed, zone = d.zone, minutes = d.minutes,
             difficulty = d.difficulty, description = d.description, time_of_day = d.time_of_day
       where id = cur.id;
      keep_chores := keep_chores || cur.id;
    else
      insert into public.chores (title, frequency, zone, minutes, difficulty, preferred_weekday, month_day,
                                 time_of_day, description, allowed_member_ids, starts_on, created_at)
      values (d.title, d.frequency, d.zone, d.minutes, d.difficulty, d.weekday, d.month_day,
              d.time_of_day, d.description, allowed,
              case when had then today + 1 else today end,
              base + d.ord * interval '1 ms')
      returning id into new_id;
      if had then
        -- Schedule changed: the old version keeps today, the new one starts tomorrow.
        update public.chores set active = false, retired_on = today + 1 where id = cur.id;
      end if;
      keep_chores := keep_chores || new_id;
    end if;
  end loop;

  update public.chores
     set active = false, retired_on = greatest(today, starts_on)
   where active and id <> all(keep_chores);

  -- Future manual reassignments go; past ones stay so history doesn't change.
  delete from public.chore_assignments where date > today;

  insert into public.chore_settings (id, rotation_enabled) values (1, true)
    on conflict (id) do update set rotation_enabled = excluded.rotation_enabled;
  insert into public.chore_rotation_log (effective_on, enabled) values (today + 1, true)
    on conflict (effective_on) do update set enabled = excluded.enabled;
end;
$$;

revoke all on function public.chore_reset_defaults() from public, anon, authenticated;
grant execute on function public.chore_reset_defaults() to service_role;

select public.chore_reset_defaults();
