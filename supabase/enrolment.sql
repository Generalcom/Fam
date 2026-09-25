-- Family Circle enrolment: icons, and the identity check (ID document + selfie) kept for FICA.
-- Run once in the Supabase SQL editor, after schema.sql. Safe to run again.
--
-- What is stored, and who can read it:
--   * profiles.avatar        the icon options (a few hundred bytes). Circle-mates can read it, like the name.
--   * kyc_submissions        one row per person: name and document number as typed, status, consent record,
--                            and the automatic check's scores (auto_check). Only that person can read their own row.
--                            Reviewers and the check server (server/kyc-worker) use the dashboard / service role.
--   * storage bucket "kyc"   PRIVATE. The ID photos and selfies. The app can upload into the person's own folder
--                            (<user id>/...) and can NOT read, replace or delete anything afterwards.
--
-- Automatic check: server/kyc-worker picks up each 'pending' submission within a minute or so, reads the ID (OCR),
-- compares the selfie with the ID photo and checks the head turns and for a printed photo or screen, then sets the
-- status to 'verified' or 'rejected' (with a reason the person sees), and records its scores in auto_check. Started
-- with REVIEW_FAILURES=true it leaves failures 'pending' for a person instead. See server/kyc-worker/README.md.
--
-- Review a submission by hand (dashboard > SQL editor, runs as an admin):
--   update public.kyc_submissions set status = 'verified', reviewed_at = now(), reviewed_by = 'your name'
--    where user_id = '<user id>';
--   update public.kyc_submissions set status = 'rejected', reject_reason = 'Photo of ID is unreadable',
--          reviewed_at = now(), reviewed_by = 'your name' where user_id = '<user id>';
-- A rejected person is asked to submit again, and their new submission goes back to 'pending'.
--
-- Retention: FICA generally requires these records to be kept for five years after the relationship ends.
-- Deleting an account in the app deletes the kyc_submissions row (cascade) but NOT the files in the bucket.
-- Decide your retention rule with your compliance officer before going live.

-- ---------- Icons ----------

alter table public.profiles add column if not exists avatar jsonb;
alter table public.profiles drop constraint if exists profiles_avatar_small;
alter table public.profiles add constraint profiles_avatar_small
  check (avatar is null or (jsonb_typeof(avatar) = 'object' and octet_length(avatar::text) <= 1000));

-- ---------- Identity check ----------

create table if not exists public.kyc_submissions (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  document_type text not null check (document_type in ('sa_id_card', 'sa_id_book', 'passport')),
  full_name text not null check (char_length(full_name) between 2 and 120),
  id_number text not null,
  date_of_birth date,
  doc_front_path text not null,
  doc_back_path text,
  selfie_center_path text not null,
  selfie_left_path text not null,
  selfie_right_path text not null,
  -- What the phone reported about the head-turn check. A phone can be lied to: treat it as a hint, not proof.
  liveness jsonb not null default '{}'::jsonb check (octet_length(liveness::text) <= 4000),
  consent_version text not null,
  consented_at timestamptz not null,
  submitted_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  reject_reason text check (reject_reason is null or char_length(reject_reason) <= 300),
  constraint kyc_number_format check (
    (document_type = 'passport' and id_number ~ '^[A-Za-z0-9]{6,12}$')
    or (document_type <> 'passport' and id_number ~ '^[0-9]{13}$')
  ),
  constraint kyc_back_only_for_cards check (document_type = 'sa_id_card' or doc_back_path is null),
  constraint kyc_card_has_back check (document_type <> 'sa_id_card' or doc_back_path is not null),
  -- a submission can only point at files in the person's own folder
  constraint kyc_own_folder check (
    doc_front_path like user_id::text || '/%'
    and (doc_back_path is null or doc_back_path like user_id::text || '/%')
    and selfie_center_path like user_id::text || '/%'
    and selfie_left_path like user_id::text || '/%'
    and selfie_right_path like user_id::text || '/%'
  )
);

-- What the phone measured while taking the ID photos (how they were taken, sharpness, glare) and what the text reader
-- found on the document, next to whether it matches what the person typed. For the reviewer; never trusted on its own.
alter table public.kyc_submissions add column if not exists scan jsonb;
alter table public.kyc_submissions drop constraint if exists kyc_scan_small;
alter table public.kyc_submissions add constraint kyc_scan_small
  check (scan is null or octet_length(scan::text) <= 4000);

-- What the automatic check found (scores and yes/no answers only; none of the text read off the ID), and when.
alter table public.kyc_submissions add column if not exists auto_check jsonb;
alter table public.kyc_submissions add column if not exists checked_at timestamptz;
alter table public.kyc_submissions drop constraint if exists kyc_auto_check_small;
alter table public.kyc_submissions add constraint kyc_auto_check_small
  check (auto_check is null or octet_length(auto_check::text) <= 4000);

create index if not exists kyc_waiting_for_check on public.kyc_submissions (submitted_at)
  where status = 'pending' and checked_at is null;

-- A new submission (or a resubmission after a rejection) is stamped with the time it was sent, and starts with no
-- automatic result, whatever the app sent. Updates to a submission that is already pending (the check server writing
-- its result) keep the original time.
create or replace function public.kyc_stamp() returns trigger
language plpgsql as $$
begin
  if tg_op = 'INSERT' or (new.status = 'pending' and old.status is distinct from 'pending') then
    new.submitted_at := now();
    new.checked_at := null;
    new.auto_check := null;
  end if;
  return new;
end;
$$;

drop trigger if exists kyc_stamp_submission on public.kyc_submissions;
create trigger kyc_stamp_submission before insert or update on public.kyc_submissions
  for each row execute function public.kyc_stamp();

alter table public.kyc_submissions enable row level security;

drop policy if exists "read own identity check" on public.kyc_submissions;
create policy "read own identity check" on public.kyc_submissions
  for select to authenticated
  using (user_id = auth.uid());

-- A person can only ever submit as 'pending': they cannot verify themselves.
drop policy if exists "submit own identity check" on public.kyc_submissions;
create policy "submit own identity check" on public.kyc_submissions
  for insert to authenticated
  with check (
    user_id = auth.uid() and status = 'pending'
    and reviewed_at is null and reviewed_by is null and reject_reason is null
  );

-- ...and can only change it after a reviewer has rejected it (to submit again).
drop policy if exists "resubmit after rejection" on public.kyc_submissions;
create policy "resubmit after rejection" on public.kyc_submissions
  for update to authenticated
  using (user_id = auth.uid() and status = 'rejected')
  with check (
    user_id = auth.uid() and status = 'pending'
    and reviewed_at is null and reviewed_by is null and reject_reason is null
  );

grant select, insert, update on public.kyc_submissions to authenticated;

-- Live updates: the app moves on the moment a reviewer verifies or rejects.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'kyc_submissions'
  ) then
    alter publication supabase_realtime add table public.kyc_submissions;
  end if;
end $$;

-- ---------- Private storage for the photos ----------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('kyc', 'kyc', false, 5242880, array['image/jpeg'])
on conflict (id) do update
  set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

-- Upload only, only into your own folder. No select / update / delete policy exists, so the app cannot read
-- the photos back (or overwrite them); reviewers open them from the dashboard.
drop policy if exists "upload own identity photos" on storage.objects;
create policy "upload own identity photos" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'kyc' and (storage.foldername(name))[1] = auth.uid()::text);
