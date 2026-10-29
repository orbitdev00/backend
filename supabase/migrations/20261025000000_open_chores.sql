-- ════════════════════════════════════════════════════════════════════════════
-- Matos Dashboard: open chores — see ORBIT_CHORE_MODE.md
--
-- Chores are no longer assigned. Every scheduled chore is open to everyone and
-- whoever checks it off first claims it (and its points). So:
-- • allowed_member_ids is cleared everywhere and the defaults no longer set it.
-- • The streak no longer depends on assignments: it counts consecutive days on
--   which the member claimed at least one chore. Today keeps the streak alive
--   until midnight, so a streak that last grew yesterday still shows.
-- chore_assignments, chore_settings and chore_rotation_log stay but nothing
-- reads them any more.
-- ════════════════════════════════════════════════════════════════════════════

update public.chores set allowed_member_ids = null where allowed_member_ids is not null;

create or replace view public.chore_leaderboard as
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
active_days as (
  select distinct c.completed_by as member_id, c.date
  from public.chore_completions c
  where c.completed_by is not null
),
runs as (
  -- Consecutive days share the same date minus row number.
  select a.member_id, a.date,
         a.date - (row_number() over (partition by a.member_id order by a.date))::int as grp
  from active_days a
),
streaks as (
  select r.member_id, count(*) as streak
  from runs r, bounds b
  group by r.member_id, r.grp, b.today
  having max(r.date) >= b.today - 1
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
-- Same as 20261021000000_matos_shop_chat.sql, except no chore is limited to
-- certain members any more.

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
      (1, 'Misael',   '#f97316'),
      (2, 'Penelope', '#ec4899'),
      (3, 'Alex',     '#3b82f6'),
      (4, 'Nathan',   '#22c55e')
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

  -- Members with completions, purchases or chat history are deactivated, not deleted.
  delete from public.chore_members cm
   where cm.id <> all(keep_members)
     and not exists (select 1 from public.chore_completions c where c.completed_by = cm.id)
     and not exists (select 1 from public.chore_purchases p where p.member_id = cm.id)
     and not exists (select 1 from public.chat_messages x where x.member_id = cm.id);
  update public.chore_members set active = false where id <> all(keep_members);

  for d in
    select * from (values
      ( 1, 'Feed, Water, and Walk Phoebe (Afternoon)', 'daily',   'Pet',         20, 'easy',    null::smallint, null::smallint, '15:00'::time,
        'Fill food and water bowls and take Phoebe for a walk.', null::text[], null::integer),
      ( 2, 'Feed, Water, and Walk Phoebe (Night)',     'daily',   'Pet',         20, 'easy',    null, null, '20:00'::time,
        'Fill food and water bowls and take Phoebe for a walk.', null, null),
      ( 3, 'Kitchen and Dishes (Noon)',                'daily',   'Kitchen',     25, 'medium',  null, null, '12:00'::time,
        'Wash the dishes, clean the counters, wash the stove, wash the sink.', null, null),
      ( 4, 'Kitchen and Dishes (Evening)',             'daily',   'Kitchen',     30, 'extreme', null, null, '19:00'::time,
        'Wash the dishes, clean the counters, wash the stove, wash the sink, bring the trash to the front.', null, 75),
      ( 5, 'High-Traffic Spot Sweep and Reset',        'daily',   'Living Room', 15, 'easy',    null, null, null, null, null, null),
      ( 6, 'Clean Master Bathroom',                    'weekly',  'Bathroom',    30, 'hard',    1,    null, null, null, null, null),
      ( 7, 'Clean Guest Bathroom',                     'weekly',  'Bathroom',    30, 'hard',    2,    null, null, null, null, null),
      ( 8, 'Wash All Bed Covers',                      'weekly',  'Bedrooms',    30, 'medium',  4,    null, null,
        'Pillow covers, colcha, and cubrecolchón.', null, null),
      ( 9, 'Vacuum All Carpets',                       'weekly',  'General',     25, 'medium',  5,    null, null, null, null, null),
      (10, 'Mop Floors',                               'weekly',  'General',     25, 'medium',  6,    null, null, null, null, null),
      (11, 'Wash Phoebe''s Bowls and Bedding',         'weekly',  'Pet',         20, 'easy',    0,    null, null, null, null, null),
      (12, 'Deep Clean Refrigerator and Toss Expired', 'monthly', 'Kitchen',     45, 'hard',    null, 1,    null, null, null, null),
      (13, 'Dust Ceiling Fans and Fixtures',           'monthly', 'General',     30, 'medium',  null, 5,    null, null, null, null),
      (14, 'Wipe Down Baseboards and Light Switches',  'monthly', 'General',     40, 'medium',  null, 10,   null, null, null, null),
      (15, 'Descale Dishwasher and Washer',            'monthly', 'Kitchen',     20, 'easy',    null, 15,   null, null, null, null)
    ) v(ord, title, frequency, zone, minutes, difficulty, weekday, month_day, time_of_day, description, allowed_names, points_override)
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
         set zone = d.zone, minutes = d.minutes, difficulty = d.difficulty, points_override = d.points_override,
             description = d.description, time_of_day = d.time_of_day
       where id = cur.id;
      keep_chores := keep_chores || cur.id;
    elsif had and cur.starts_on > today then
      -- Not started yet: nothing in the past depends on it, so edit in place.
      update public.chores
         set frequency = d.frequency, preferred_weekday = d.weekday, month_day = d.month_day,
             allowed_member_ids = allowed, zone = d.zone, minutes = d.minutes,
             difficulty = d.difficulty, points_override = d.points_override,
             description = d.description, time_of_day = d.time_of_day
       where id = cur.id;
      keep_chores := keep_chores || cur.id;
    else
      insert into public.chores (title, frequency, zone, minutes, difficulty, points_override, preferred_weekday, month_day,
                                 time_of_day, description, allowed_member_ids, starts_on, created_at)
      values (d.title, d.frequency, d.zone, d.minutes, d.difficulty, d.points_override, d.weekday, d.month_day,
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
