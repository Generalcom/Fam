-- Family Circle schema. Run once in the Supabase SQL editor (Dashboard > SQL Editor).
-- Privacy model: a location is only readable by the owner and people who share a circle with them.

-- ---------- Tables ----------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  display_name text not null,
  color text not null default '#1D4ED8',
  sharing_enabled boolean not null default true,
  created_at timestamptz not null default now()
);

create function public.new_invite_code() returns text
language sql volatile as $$
  select upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
$$;

create table public.circles (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 60),
  invite_code text not null unique default public.new_invite_code(),
  created_by uuid not null references auth.users (id) on delete cascade,
  created_at timestamptz not null default now()
);

create table public.circle_members (
  circle_id uuid not null references public.circles (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  role text not null default 'member' check (role in ('admin', 'member')),
  joined_at timestamptz not null default now(),
  primary key (circle_id, user_id)
);

-- Latest known position only; no history is stored.
create table public.locations (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  latitude double precision not null check (latitude between -90 and 90),
  longitude double precision not null check (longitude between -180 and 180),
  accuracy real,
  speed real,
  updated_at timestamptz not null default now()
);

-- ---------- Helper functions (security definer so policies don't recurse) ----------

create function public.is_circle_member(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.circle_members
    where circle_id = c and user_id = auth.uid()
  );
$$;

create function public.is_circle_admin(c uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.circle_members
    where circle_id = c and user_id = auth.uid() and role = 'admin'
  );
$$;

create function public.shares_circle_with(u uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.circle_members a
    join public.circle_members b on a.circle_id = b.circle_id
    where a.user_id = auth.uid() and b.user_id = u
  );
$$;

-- ---------- Row level security ----------

alter table public.profiles enable row level security;
alter table public.circles enable row level security;
alter table public.circle_members enable row level security;
alter table public.locations enable row level security;

create policy "read own or circle-mate profiles" on public.profiles
  for select to authenticated
  using (id = auth.uid() or public.shares_circle_with(id));

create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

create policy "read my circles" on public.circles
  for select to authenticated
  using (public.is_circle_member(id));

create policy "read members of my circles" on public.circle_members
  for select to authenticated
  using (public.is_circle_member(circle_id));

create policy "leave a circle, or admins remove members" on public.circle_members
  for delete to authenticated
  using (user_id = auth.uid() or public.is_circle_admin(circle_id));

create policy "read own or circle-mate location" on public.locations
  for select to authenticated
  using (user_id = auth.uid() or public.shares_circle_with(user_id));

create policy "insert own location" on public.locations
  for insert to authenticated
  with check (user_id = auth.uid());

create policy "update own location" on public.locations
  for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "delete own location" on public.locations
  for delete to authenticated
  using (user_id = auth.uid());

-- ---------- Sign-up: create the profile row ----------

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, display_name, color)
  values (
    new.id,
    coalesce(nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''), split_part(new.email, '@', 1)),
    coalesce(nullif(new.raw_user_meta_data ->> 'color', ''), '#1D4ED8')
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------- RPCs called by the app ----------

create function public.create_circle(circle_name text) returns public.circles
language plpgsql security definer set search_path = '' as $$
declare c public.circles;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  insert into public.circles (name, created_by) values (trim(circle_name), auth.uid())
    returning * into c;
  insert into public.circle_members (circle_id, user_id, role) values (c.id, auth.uid(), 'admin');
  return c;
end;
$$;

create function public.join_circle(code text) returns public.circles
language plpgsql security definer set search_path = '' as $$
declare c public.circles;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  select * into c from public.circles where invite_code = upper(trim(code));
  if not found then raise exception 'That invite code is not valid'; end if;
  insert into public.circle_members (circle_id, user_id) values (c.id, auth.uid())
    on conflict do nothing;
  return c;
end;
$$;

create function public.rotate_invite_code(circle uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare new_code text;
begin
  if not public.is_circle_admin(circle) then raise exception 'Only admins can do that'; end if;
  update public.circles set invite_code = public.new_invite_code()
    where id = circle returning invite_code into new_code;
  return new_code;
end;
$$;

-- Required for app stores: lets a user delete their own account and all their data.
create function public.delete_my_account() returns void
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  delete from auth.users where id = auth.uid();
end;
$$;

revoke all on function public.create_circle(text), public.join_circle(text),
  public.rotate_invite_code(uuid), public.delete_my_account() from public, anon;
grant execute on function public.create_circle(text), public.join_circle(text),
  public.rotate_invite_code(uuid), public.delete_my_account() to authenticated;

-- ---------- Housekeeping when someone leaves ----------

create function public.after_member_removed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.circle_members where circle_id = old.circle_id) then
    delete from public.circles where id = old.circle_id;
  elsif not exists (
    select 1 from public.circle_members where circle_id = old.circle_id and role = 'admin'
  ) then
    update public.circle_members set role = 'admin'
    where circle_id = old.circle_id
      and user_id = (
        select user_id from public.circle_members
        where circle_id = old.circle_id order by joined_at limit 1
      );
  end if;
  return old;
end;
$$;

create trigger on_member_removed
  after delete on public.circle_members
  for each row execute function public.after_member_removed();

-- ---------- Realtime ----------

alter publication supabase_realtime add table public.locations, public.circle_members, public.profiles;
