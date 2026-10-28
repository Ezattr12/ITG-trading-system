-- ITG TraderOS — Migration 0016: Storage buckets + policies
-- Phase 11, spec §5. Forward-only; never edit after merge.
--
-- The app uploads avatars to the `avatars` bucket and trade
-- screenshots to `trade-screenshots` (displayed via 1-hour signed
-- URLs), but no bucket or Storage policy existed in any migration —
-- uploads failed until an admin created the buckets by hand.
-- This migration creates both buckets with least-privilege
-- policies. Paths are per-user (<user_id>/...), and every write
-- policy checks the first path segment equals auth.uid().
--
-- - avatars: PUBLIC read (a profile photo is meant to be shown;
--   the app uses getPublicUrl), owner-only write.
-- - trade-screenshots: PRIVATE; owner-only read/write/delete.
--
-- If this migration is applied to a project without the Storage
-- schema, it fails loudly — create the buckets in the Supabase
-- dashboard instead (see docs/runbooks, Phase 13).

insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true),
       ('trade-screenshots', 'trade-screenshots', false)
on conflict (id) do nothing;

alter table storage.objects enable row level security;

-- avatars: anyone may read a profile photo; only the owner writes.
drop policy if exists "avatars_select_public" on storage.objects;
create policy "avatars_select_public" on storage.objects
  for select using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own" on storage.objects
  for update using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own" on storage.objects
  for delete using (
    bucket_id = 'avatars'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- trade-screenshots: private; only the owner reads/writes/deletes.
drop policy if exists "screenshots_select_own" on storage.objects;
create policy "screenshots_select_own" on storage.objects
  for select using (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "screenshots_insert_own" on storage.objects;
create policy "screenshots_insert_own" on storage.objects
  for insert with check (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "screenshots_update_own" on storage.objects;
create policy "screenshots_update_own" on storage.objects
  for update using (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

drop policy if exists "screenshots_delete_own" on storage.objects;
create policy "screenshots_delete_own" on storage.objects
  for delete using (
    bucket_id = 'trade-screenshots'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
