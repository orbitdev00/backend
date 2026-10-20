-- ════════════════════════════════════════════════════════════════════════════
-- Matos Dashboard: extreme tier, chat, coins and the shop — see ORBIT_CHORE_MODE.md
--
-- • chores.points_override: when set it replaces minutes × multiplier. The new
--   "extreme" difficulty always carries points_override = 75. Completions keep
--   the points_awarded they were stamped with; only future ones use new values.
-- • chat_messages: anon can read; inserts go through POST /chores/chat.
-- • Coins: every 10 points earned = 1 coin. The balance is derived (chore_wallet
--   view), never stored. Purchases go through chore_buy() (service role only),
--   which locks the member, checks the balance and records the price paid.
-- ════════════════════════════════════════════════════════════════════════════

-- ── Extreme tier + points_override ──────────────────────────────────────────

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.chores'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%difficulty%'
  loop
    execute format('alter table public.chores drop constraint %I', r.conname);
  end loop;
end;
$$;

alter table public.chores
  add constraint chores_difficulty_check check (difficulty in ('easy', 'medium', 'hard', 'extreme')),
  add column points_override integer check (points_override is null or points_override between 1 and 1000);

create or replace function public.chore_completion_stamp()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  c record;
begin
  select minutes, difficulty, points_override into c from public.chores where id = new.chore_id;
  if not found then
    raise exception 'unknown chore %', new.chore_id;
  end if;
  new.points_awarded := coalesce(
    c.points_override,
    round(c.minutes * case c.difficulty when 'extreme' then 2.5 when 'hard' then 2.0 when 'medium' then 1.5 else 1.0 end)::integer);
  new.completed_at := now();
  return new;
end;
$$;

revoke all on function public.chore_completion_stamp() from public, anon, authenticated;

-- ── Member colors and chore list changes (targeted, no full reset) ──────────

update public.chore_members m
   set color = v.color
  from (values ('Misael', '#f97316'), ('Alex', '#3b82f6'), ('Nathan', '#22c55e'), ('Penelope', '#ec4899')) v(name, color)
 where m.name = v.name;

update public.chores set title = 'Wash All Bed Covers'
 where active and title = 'Wash Bed Covers';

update public.chores set difficulty = 'medium', points_override = null
 where active and title = 'Kitchen and Dishes (Noon)';

update public.chores set difficulty = 'extreme', points_override = 75
 where active and title = 'Kitchen and Dishes (Evening)';

do $$
declare
  today date := (now() at time zone 'America/New_York')::date;
  base  timestamptz := clock_timestamp();
  d     record;
begin
  update public.chores
     set active = false, retired_on = greatest(today, starts_on)
   where active and title = 'Feed, Water, and Walk Phoebe';

  for d in
    select * from (values
      (1, 'Feed, Water, and Walk Phoebe (Afternoon)', '15:00'::time),
      (2, 'Feed, Water, and Walk Phoebe (Night)',     '20:00'::time)
    ) v(ord, title, time_of_day)
  loop
    if not exists (select 1 from public.chores where active and title = d.title) then
      insert into public.chores (title, frequency, zone, minutes, difficulty, time_of_day, description, starts_on, created_at)
      values (d.title, 'daily', 'Pet', 20, 'easy', d.time_of_day,
              'Fill food and water bowls and take Phoebe for a walk.', today, base + d.ord * interval '1 ms');
    end if;
  end loop;
end;
$$;

-- ── Default data ────────────────────────────────────────────────────────────
-- Same behavior as 20261020000000_chore_points.sql; new colors, the split Phoebe
-- task, the extreme evening kitchen and the renamed bed covers task.

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
      ( 6, 'Clean Master Bathroom',                    'weekly',  'Bathroom',    30, 'hard',    1,    null, null, null, array['Misael', 'Penelope'], null),
      ( 7, 'Clean Guest Bathroom',                     'weekly',  'Bathroom',    30, 'hard',    2,    null, null, null, array['Alex', 'Nathan'], null),
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

-- ── Chat ────────────────────────────────────────────────────────────────────

create table public.chat_messages (
  id          uuid primary key default gen_random_uuid(),
  member_id   uuid not null references public.chore_members(id),
  body        text not null check (char_length(body) between 1 and 500),
  created_at  timestamptz not null default now()
);

create index chat_messages_created_at_idx on public.chat_messages (created_at desc);

alter table public.chat_messages enable row level security;
create policy "chat_messages public read" on public.chat_messages for select to anon, authenticated using (true);
revoke all on public.chat_messages from anon, authenticated;
grant select on public.chat_messages to anon, authenticated;

-- ── Coins and shop ──────────────────────────────────────────────────────────
-- Item ids and prices live in backend/chore_routes.py (SHOP_ITEMS); the price
-- paid is recorded on the purchase so later price changes don't rewrite history.

create table public.chore_purchases (
  member_id   uuid not null references public.chore_members(id),
  item_id     text not null check (char_length(item_id) between 1 and 40),
  price       integer not null check (price >= 0),
  created_at  timestamptz not null default now(),
  primary key (member_id, item_id)
);

-- Equipped cosmetics per member (item ids; null = default look).
create table public.chore_member_cosmetics (
  member_id   uuid primary key references public.chore_members(id),
  theme       text,
  avatar      text,
  color       text,
  name_font   text,
  name_color  text,
  banner      text,
  updated_at  timestamptz not null default now()
);

alter table public.chore_purchases enable row level security;
alter table public.chore_member_cosmetics enable row level security;
create policy "chore_purchases public read" on public.chore_purchases for select to anon, authenticated using (true);
create policy "chore_member_cosmetics public read" on public.chore_member_cosmetics for select to anon, authenticated using (true);
revoke all on public.chore_purchases, public.chore_member_cosmetics from anon, authenticated;
grant select on public.chore_purchases, public.chore_member_cosmetics to anon, authenticated;

-- 1 coin per 10 points earned (all time), minus what has been spent.
create view public.chore_wallet as
select m.id                                   as member_id,
       (coalesce(p.points, 0) / 10)::int      as coins_earned,
       coalesce(s.spent, 0)::int              as coins_spent,
       (coalesce(p.points, 0) / 10 - coalesce(s.spent, 0))::int as coins
from public.chore_members m
left join (select completed_by, sum(points_awarded) as points
             from public.chore_completions where completed_by is not null
            group by completed_by) p on p.completed_by = m.id
left join (select member_id, sum(price) as spent
             from public.chore_purchases group by member_id) s on s.member_id = m.id
where m.active;

revoke all on public.chore_wallet from anon, authenticated;
grant select on public.chore_wallet to anon, authenticated, service_role;

create function public.chore_buy(p_member uuid, p_item text, p_price integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  balance integer;
begin
  -- Serializes purchases per member so two quick taps can't overspend.
  perform 1 from public.chore_members where id = p_member and active for update;
  if not found then
    raise exception 'unknown member';
  end if;
  if exists (select 1 from public.chore_purchases where member_id = p_member and item_id = p_item) then
    raise exception 'already owned';
  end if;
  select coins into balance from public.chore_wallet where member_id = p_member;
  if coalesce(balance, 0) < p_price then
    raise exception 'not enough coins';
  end if;
  insert into public.chore_purchases (member_id, item_id, price) values (p_member, p_item, p_price);
  return coalesce(balance, 0) - p_price;
end;
$$;

revoke all on function public.chore_buy(uuid, text, integer) from public, anon, authenticated;
grant execute on function public.chore_buy(uuid, text, integer) to service_role;
