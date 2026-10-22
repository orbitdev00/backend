-- ════════════════════════════════════════════════════════════════════════════
-- Pickleball tournament (/pickleball) — see ORBIT_CHORE_MODE.md
--
-- • pickleball_entries: one row per doubles team, slot 1–12 from a random draw.
--   Only the backend (service role) touches it. edit_token_hash is the SHA-256
--   of the team's edit token; the raw token is never stored.
-- • pickleball_bracket: everything in pickleball_entries except edit_token_hash.
-- • Anon can only SELECT pickleball_bracket, pickleball_settings and
--   pickleball_messages. Every write goes through POST/PATCH/DELETE /pickleball/*.
-- • Slots never change after the draw (trigger), and joins/edits take a table
--   lock so two requests can't draw the same slot or claim the same name.
-- ════════════════════════════════════════════════════════════════════════════

create table public.pickleball_entries (
  id              uuid primary key default gen_random_uuid(),
  player_name     text not null check (char_length(player_name) between 2 and 30 and player_name = btrim(player_name)),
  partner_name    text not null check (char_length(partner_name) between 2 and 30 and partner_name = btrim(partner_name)),
  skill_level     text not null check (skill_level in ('beginner', 'intermediate', 'advanced')),
  -- The 8 allowed colors live in PICKLEBALL_COLORS (backend/pickleball_routes.py).
  color           text not null check (color ~ '^#[0-9a-f]{6}$'),
  slot            integer not null unique check (slot between 1 and 12),
  edit_token_hash text not null check (edit_token_hash ~ '^[0-9a-f]{64}$'),
  created_at      timestamptz not null default now(),
  check (lower(player_name) <> lower(partner_name))
);

create function public.pickleball_entry_guard()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.slot is distinct from old.slot then
    raise exception 'slot is fixed';
  end if;
  if new.edit_token_hash is distinct from old.edit_token_hash then
    raise exception 'edit token is fixed';
  end if;
  return new;
end;
$$;

create trigger pickleball_entry_guard
before update on public.pickleball_entries
for each row execute function public.pickleball_entry_guard();

revoke all on function public.pickleball_entry_guard() from public, anon, authenticated;

create table public.pickleball_settings (
  id          integer primary key default 1 check (id = 1),
  event_name  text not null check (char_length(event_name) between 1 and 60),
  event_date  date
);

insert into public.pickleball_settings (id, event_name, event_date)
values (1, 'Pickleball Tournament', null)
on conflict (id) do nothing;

create table public.pickleball_messages (
  id          uuid primary key default gen_random_uuid(),
  entry_id    uuid not null references public.pickleball_entries(id) on delete cascade,
  body        text not null check (char_length(body) between 1 and 200 and body = btrim(body)),
  created_at  timestamptz not null default now()
);

create index pickleball_messages_created_at_idx on public.pickleball_messages (created_at desc);
create index pickleball_messages_entry_id_idx on public.pickleball_messages (entry_id);

-- ── Access ──────────────────────────────────────────────────────────────────

alter table public.pickleball_entries enable row level security;
alter table public.pickleball_settings enable row level security;
alter table public.pickleball_messages enable row level security;

-- No policies on pickleball_entries: anon and authenticated get nothing.
create policy "pickleball_settings public read" on public.pickleball_settings for select to anon, authenticated using (true);
create policy "pickleball_messages public read" on public.pickleball_messages for select to anon, authenticated using (true);

revoke all on public.pickleball_entries, public.pickleball_settings, public.pickleball_messages from anon, authenticated;
grant select on public.pickleball_settings, public.pickleball_messages to anon, authenticated;

create view public.pickleball_bracket as
select id, player_name, partner_name, skill_level, color, slot, created_at
from public.pickleball_entries;

revoke all on public.pickleball_bracket from anon, authenticated;
grant select on public.pickleball_bracket to anon, authenticated, service_role;

-- ── Join and edit (service role only) ───────────────────────────────────────

-- Draws a random open slot. The table lock serializes joins (and edits), so
-- simultaneous joins can't get the same slot, overfill or reuse a name.
create function public.pickleball_join(p_player text, p_partner text, p_skill text, p_color text, p_token_hash text)
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
  if lower(p_player) = lower(p_partner) or exists (
    select 1 from public.pickleball_entries e
     where lower(e.player_name) in (lower(p_player), lower(p_partner))
        or lower(e.partner_name) in (lower(p_player), lower(p_partner))
  ) then
    raise exception 'name taken';
  end if;

  select s into v_slot
    from generate_series(1, 12) s
   where not exists (select 1 from public.pickleball_entries e where e.slot = s)
   order by random()
   limit 1;

  insert into public.pickleball_entries (player_name, partner_name, skill_level, color, slot, edit_token_hash)
  values (p_player, p_partner, p_skill, p_color, v_slot, p_token_hash)
  returning id into v_id;

  return json_build_object('id', v_id, 'slot', v_slot);
end;
$$;

-- Edits names, skill and color. There is no way to pass a slot.
create function public.pickleball_update(p_id uuid, p_player text, p_partner text, p_skill text, p_color text)
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
  if lower(p_player) = lower(p_partner) or exists (
    select 1 from public.pickleball_entries e
     where e.id <> p_id
       and (lower(e.player_name) in (lower(p_player), lower(p_partner))
         or lower(e.partner_name) in (lower(p_player), lower(p_partner)))
  ) then
    raise exception 'name taken';
  end if;

  update public.pickleball_entries
     set player_name = p_player, partner_name = p_partner, skill_level = p_skill, color = p_color
   where id = p_id;
end;
$$;

revoke all on function public.pickleball_join(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.pickleball_update(uuid, text, text, text, text) from public, anon, authenticated;
grant execute on function public.pickleball_join(text, text, text, text, text) to service_role;
grant execute on function public.pickleball_update(uuid, text, text, text, text) to service_role;
