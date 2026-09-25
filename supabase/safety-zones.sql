-- Safety zones. Run once in the Supabase SQL editor, after schema.sql. Safe to run again.
--
-- A zone is a circle on the map with a level:
--   red    = avoid this area
--   aware  = be aware / take care here
-- Zones belong to a family circle and are visible only to its members. A zone with no circle (circle_id is
-- null) is shared with every signed-in user; the app never writes those, so they are for curated data added
-- by you in the SQL editor.

create table if not exists public.safety_zones (
  id uuid primary key default gen_random_uuid(),
  circle_id uuid references public.circles (id) on delete cascade,
  name text not null check (char_length(trim(name)) between 1 and 80),
  level text not null check (level in ('red', 'aware')),
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  radius_m integer not null check (radius_m between 50 and 5000),
  note text check (note is null or char_length(note) <= 300),
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists safety_zones_circle_idx on public.safety_zones (circle_id);

alter table public.safety_zones enable row level security;

drop policy if exists "read my circle's zones and shared zones" on public.safety_zones;
create policy "read my circle's zones and shared zones" on public.safety_zones
  for select to authenticated
  using (circle_id is null or public.is_circle_member(circle_id));

drop policy if exists "members add zones to their circle" on public.safety_zones;
create policy "members add zones to their circle" on public.safety_zones
  for insert to authenticated
  with check (
    circle_id is not null
    and public.is_circle_member(circle_id)
    and created_by = auth.uid()
  );

drop policy if exists "creator or admin edits a zone" on public.safety_zones;
create policy "creator or admin edits a zone" on public.safety_zones
  for update to authenticated
  using (circle_id is not null and (created_by = auth.uid() or public.is_circle_admin(circle_id)))
  with check (circle_id is not null and (created_by = auth.uid() or public.is_circle_admin(circle_id)));

drop policy if exists "creator or admin removes a zone" on public.safety_zones;
create policy "creator or admin removes a zone" on public.safety_zones
  for delete to authenticated
  using (circle_id is not null and (created_by = auth.uid() or public.is_circle_admin(circle_id)));

grant select, insert, update, delete on public.safety_zones to authenticated;

-- Live updates: everyone in the circle sees a new zone straight away.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'safety_zones'
  ) then
    alter publication supabase_realtime add table public.safety_zones;
  end if;
end $$;
