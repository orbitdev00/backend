-- ════════════════════════════════════════════════════════════════════════════
-- Pickleball: 16 players, and Chido_Gamer takes Kyomo's spot — see ORBIT_CHORE_MODE.md
--
-- • Slots go from 1–12 to 1–16. Nobody moves: slots 1–12 keep their round-1
--   games and slots 1–4, which had byes, now play the new slots 13–16.
-- • pickleball_join() caps at 16 and draws from 1–16. Everything else is as in
--   20261024000000_pickleball_professional.sql (professional stays reserved).
-- • Kyomo's entry is renamed to Chido_Gamer: same slot (6), color, Professional
--   role and edit token. Stops if Kyomo isn't signed up or the name is taken.
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare r record;
begin
  for r in
    select conname from pg_constraint
     where conrelid = 'public.pickleball_entries'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%slot%'
  loop
    execute format('alter table public.pickleball_entries drop constraint %I', r.conname);
  end loop;
end;
$$;

alter table public.pickleball_entries
  add constraint pickleball_entries_slot_check check (slot between 1 and 16);

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

  if (select count(*) from public.pickleball_entries) >= 16 then
    raise exception 'tournament full';
  end if;
  if exists (select 1 from public.pickleball_entries e where lower(e.player_name) = lower(p_player)) then
    raise exception 'name taken';
  end if;

  select s into v_slot
    from generate_series(1, 16) s
   where not exists (select 1 from public.pickleball_entries e where e.slot = s)
   order by random()
   limit 1;

  insert into public.pickleball_entries (player_name, skill_level, color, slot, edit_token_hash)
  values (p_player, p_skill, p_color, v_slot, p_token_hash)
  returning id into v_id;

  return json_build_object('id', v_id, 'slot', v_slot);
end;
$$;

revoke all on function public.pickleball_join(text, text, text, text) from public, anon, authenticated;
grant execute on function public.pickleball_join(text, text, text, text) to service_role;

-- ── Kyomo → Chido_Gamer ─────────────────────────────────────────────────────

do $$
declare
  v_id uuid;
begin
  lock table public.pickleball_entries in share row exclusive mode;

  select id into v_id from public.pickleball_entries where lower(player_name) = 'kyomo';
  if v_id is null then
    raise exception 'expected Kyomo to be signed up';
  end if;
  if exists (select 1 from public.pickleball_entries where lower(player_name) = 'chido_gamer') then
    raise exception 'Chido_Gamer is already signed up';
  end if;

  update public.pickleball_entries set player_name = 'Chido_Gamer' where id = v_id;
end;
$$;
