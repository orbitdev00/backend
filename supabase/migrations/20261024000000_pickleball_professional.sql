-- ════════════════════════════════════════════════════════════════════════════
-- Pickleball: reserved "Professional" skill level, and keeping Marlito and
-- Kyomo apart — see ORBIT_CHORE_MODE.md
--
-- • skill_level can be 'professional', but nobody can pick it: pickleball_join()
--   refuses it, and pickleball_update() never sets it on anyone who doesn't
--   already have it (and never takes it away from someone who does). It's
--   given here to Marlito and Kyomo only.
-- • One-time slot move (the only one; the guard trigger stays on otherwise):
--   Kyomo (slot 6) and Marlito (slot 11) were in the same half and would have
--   met in round 1. Marlito moves to a random open slot of 8 and 9, the top-half
--   spots where they can't meet before the winners' final (and no earlier than
--   losers' round 2). Stops if the slots aren't what they were when this was
--   written.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.pickleball_entries'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%skill_level%'
  loop
    execute format('alter table public.pickleball_entries drop constraint %I', r.conname);
  end loop;
end;
$$;

alter table public.pickleball_entries
  add constraint pickleball_entries_skill_level_check
  check (skill_level in ('beginner', 'intermediate', 'advanced', 'professional'));

create or replace function public.pickleball_join(p_player text, p_skill text, p_color text, p_token_hash text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot integer;
  v_id   uuid;
begin
  if p_skill = 'professional' then
    raise exception 'professional is reserved';
  end if;

  lock table public.pickleball_entries in share row exclusive mode;

  if (select count(*) from public.pickleball_entries) >= 12 then
    raise exception 'tournament full';
  end if;
  if exists (select 1 from public.pickleball_entries e where lower(e.player_name) = lower(p_player)) then
    raise exception 'name taken';
  end if;

  select s into v_slot
    from generate_series(1, 12) s
   where not exists (select 1 from public.pickleball_entries e where e.slot = s)
   order by random()
   limit 1;

  insert into public.pickleball_entries (player_name, skill_level, color, slot, edit_token_hash)
  values (p_player, p_skill, p_color, v_slot, p_token_hash)
  returning id into v_id;

  return json_build_object('id', v_id, 'slot', v_slot);
end;
$$;

-- Edits name, skill and color. There is no way to pass a slot. A professional
-- stays professional; nobody else can become one.
create or replace function public.pickleball_update(p_id uuid, p_player text, p_skill text, p_color text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_skill text;
begin
  lock table public.pickleball_entries in share row exclusive mode;

  select skill_level into v_skill from public.pickleball_entries where id = p_id;
  if not found then
    raise exception 'not found';
  end if;
  if p_skill = 'professional' and v_skill <> 'professional' then
    raise exception 'professional is reserved';
  end if;
  if exists (select 1 from public.pickleball_entries e where e.id <> p_id and lower(e.player_name) = lower(p_player)) then
    raise exception 'name taken';
  end if;

  update public.pickleball_entries
     set player_name = p_player,
         skill_level = case when v_skill = 'professional' then 'professional' else p_skill end,
         color = p_color
   where id = p_id;
end;
$$;

revoke all on function public.pickleball_join(text, text, text, text) from public, anon, authenticated;
revoke all on function public.pickleball_update(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.pickleball_join(text, text, text, text) to service_role;
grant execute on function public.pickleball_update(uuid, text, text, text) to service_role;

-- ── Marlito and Kyomo ───────────────────────────────────────────────────────

do $$
declare
  v_marlito record;
  v_kyomo   record;
  v_target  integer;
begin
  lock table public.pickleball_entries in share row exclusive mode;

  select id, slot into v_marlito from public.pickleball_entries where lower(player_name) = 'marlito';
  select id, slot into v_kyomo from public.pickleball_entries where lower(player_name) = 'kyomo';
  if v_marlito.id is null or v_kyomo.id is null then
    raise exception 'expected Marlito and Kyomo to be signed up';
  end if;
  if v_marlito.slot <> 11 or v_kyomo.slot <> 6 then
    raise exception 'slots changed (Marlito %, Kyomo %); re-check the placement', v_marlito.slot, v_kyomo.slot;
  end if;

  select s into v_target
    from unnest(array[8, 9]) s
   where not exists (select 1 from public.pickleball_entries e where e.slot = s)
   order by random()
   limit 1;
  if v_target is null then
    raise exception 'slots 8 and 9 are both taken; re-check the placement';
  end if;

  alter table public.pickleball_entries disable trigger pickleball_entry_guard;
  update public.pickleball_entries set slot = v_target where id = v_marlito.id;
  alter table public.pickleball_entries enable trigger pickleball_entry_guard;

  update public.pickleball_entries set skill_level = 'professional'
   where id in (v_marlito.id, v_kyomo.id);
end;
$$;
