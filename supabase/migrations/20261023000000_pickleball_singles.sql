-- ════════════════════════════════════════════════════════════════════════════
-- Pickleball: switch from doubles to singles — see ORBIT_CHORE_MODE.md
--
-- • Clears every signup (and, through the foreign key, every chat message) so
--   the tournament restarts empty.
-- • 12 players, one per slot: partner_name is dropped. Player names are unique
--   regardless of case (enforced by an index as well as by the functions).
-- • pickleball_join()/pickleball_update() lose their partner argument. Same
--   table lock, same random slot draw, slots still never change.
-- ════════════════════════════════════════════════════════════════════════════

delete from public.pickleball_messages;
delete from public.pickleball_entries;

drop view public.pickleball_bracket;
drop function public.pickleball_join(text, text, text, text, text);
drop function public.pickleball_update(uuid, text, text, text, text);

-- Also drops the player/partner check that referenced it.
alter table public.pickleball_entries drop column partner_name;

create unique index pickleball_entries_player_name_key on public.pickleball_entries (lower(player_name));

create view public.pickleball_bracket as
select id, player_name, skill_level, color, slot, created_at
from public.pickleball_entries;

revoke all on public.pickleball_bracket from anon, authenticated;
grant select on public.pickleball_bracket to anon, authenticated, service_role;

create function public.pickleball_join(p_player text, p_skill text, p_color text, p_token_hash text)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  v_slot integer;
  v_id   uuid;
begin
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

-- Edits name, skill and color. There is no way to pass a slot.
create function public.pickleball_update(p_id uuid, p_player text, p_skill text, p_color text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  lock table public.pickleball_entries in share row exclusive mode;

  if not exists (select 1 from public.pickleball_entries where id = p_id) then
    raise exception 'not found';
  end if;
  if exists (select 1 from public.pickleball_entries e where e.id <> p_id and lower(e.player_name) = lower(p_player)) then
    raise exception 'name taken';
  end if;

  update public.pickleball_entries
     set player_name = p_player, skill_level = p_skill, color = p_color
   where id = p_id;
end;
$$;

revoke all on function public.pickleball_join(text, text, text, text) from public, anon, authenticated;
revoke all on function public.pickleball_update(uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.pickleball_join(text, text, text, text) to service_role;
grant execute on function public.pickleball_update(uuid, text, text, text) to service_role;
