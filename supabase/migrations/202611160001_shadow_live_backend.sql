-- Shadow Live fresh Supabase backend foundation.
-- Applied to project pkqcxcfuelubonlkjgoq; additive and idempotent.
create extension if not exists pgcrypto;

alter table public.profiles
  add column if not exists public_id text,
  add column if not exists role text not null default 'user',
  add column if not exists account_status text not null default 'active',
  add column if not exists setup_step text not null default 'profile',
  add column if not exists setup_complete boolean not null default false,
  add column if not exists country text,
  add column if not exists location text,
  add column if not exists interests jsonb not null default '[]'::jsonb,
  add column if not exists metadata jsonb not null default '{}'::jsonb;
create unique index if not exists profiles_public_id_uidx on public.profiles(public_id) where public_id is not null;

create table if not exists public.user_settings (
 user_id uuid primary key references auth.users(id) on delete cascade,
 settings jsonb not null default '{}'::jsonb, updated_at timestamptz not null default now()
);
create table if not exists public.user_devices (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 platform text not null, push_token text, app_version text, last_seen_at timestamptz not null default now(),
 unique(user_id,platform,push_token)
);
create table if not exists public.public_ids (
 public_id text primary key, user_id uuid not null references auth.users(id) on delete cascade,
 created_at timestamptz not null default now()
);
create table if not exists public.room_seats (
 id uuid primary key default gen_random_uuid(), room_id uuid not null references public.rooms(id) on delete cascade,
 seat_number integer not null check(seat_number>=0), user_id uuid references auth.users(id) on delete set null,
 seat_status text not null default 'available', updated_at timestamptz not null default now(), unique(room_id,seat_number)
);
create table if not exists public.room_moderators (
 room_id uuid not null references public.rooms(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
 granted_by uuid references auth.users(id) on delete set null, permissions jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(), primary key(room_id,user_id)
);
create table if not exists public.room_bans (
 room_id uuid not null references public.rooms(id) on delete cascade, user_id uuid not null references auth.users(id) on delete cascade,
 banned_by uuid references auth.users(id) on delete set null, reason text, expires_at timestamptz,
 created_at timestamptz not null default now(), primary key(room_id,user_id)
);
create table if not exists public.private_conversations (
 id uuid primary key default gen_random_uuid(), created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
create table if not exists public.private_conversation_members (
 conversation_id uuid not null references public.private_conversations(id) on delete cascade,
 user_id uuid not null references auth.users(id) on delete cascade, last_read_at timestamptz, muted boolean not null default false,
 primary key(conversation_id,user_id)
);
create table if not exists public.private_messages (
 id uuid primary key default gen_random_uuid(), conversation_id uuid not null references public.private_conversations(id) on delete cascade,
 sender_id uuid not null references auth.users(id) on delete cascade, body text, media_url text,
 message_type text not null default 'text', created_at timestamptz not null default now(), deleted_at timestamptz
);
create table if not exists public.user_inventory (
 id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
 item_type text not null, item_id text not null, quantity integer not null default 1 check(quantity>=0),
 expires_at timestamptz, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
 unique(user_id,item_type,item_id)
);
create table if not exists public.user_reports (
 id uuid primary key default gen_random_uuid(), reporter_id uuid not null references auth.users(id) on delete cascade,
 reported_user_id uuid references auth.users(id) on delete set null, room_id uuid references public.rooms(id) on delete set null,
 category text not null, details text, status text not null default 'open', created_at timestamptz not null default now()
);
create table if not exists public.audit_events (
 id bigint generated always as identity primary key, actor_id uuid references auth.users(id) on delete set null,
 action text not null, target_type text, target_id text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);

alter table public.user_settings enable row level security;
alter table public.user_devices enable row level security;
alter table public.public_ids enable row level security;
alter table public.room_seats enable row level security;
alter table public.room_moderators enable row level security;
alter table public.room_bans enable row level security;
alter table public.private_conversations enable row level security;
alter table public.private_conversation_members enable row level security;
alter table public.private_messages enable row level security;
alter table public.user_inventory enable row level security;
alter table public.user_reports enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists user_settings_self on public.user_settings;
create policy user_settings_self on public.user_settings for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists user_devices_self on public.user_devices;
create policy user_devices_self on public.user_devices for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists public_ids_read on public.public_ids;
create policy public_ids_read on public.public_ids for select to anon,authenticated using(true);
drop policy if exists public_ids_insert_self on public.public_ids;
create policy public_ids_insert_self on public.public_ids for insert to authenticated with check(user_id=auth.uid());
drop policy if exists room_seats_read on public.room_seats;
create policy room_seats_read on public.room_seats for select to anon,authenticated using(true);
drop policy if exists room_seats_manage on public.room_seats;
create policy room_seats_manage on public.room_seats for all to authenticated
 using(exists(select 1 from public.rooms r where r.id=room_id and r.owner_id=auth.uid()) or user_id=auth.uid())
 with check(exists(select 1 from public.rooms r where r.id=room_id and r.owner_id=auth.uid()) or user_id=auth.uid());
drop policy if exists room_moderators_read on public.room_moderators;
create policy room_moderators_read on public.room_moderators for select to authenticated using(true);
drop policy if exists room_moderators_owner_manage on public.room_moderators;
create policy room_moderators_owner_manage on public.room_moderators for all to authenticated
 using(exists(select 1 from public.rooms r where r.id=room_id and r.owner_id=auth.uid()))
 with check(exists(select 1 from public.rooms r where r.id=room_id and r.owner_id=auth.uid()));
drop policy if exists room_bans_read on public.room_bans;
create policy room_bans_read on public.room_bans for select to authenticated using(true);
drop policy if exists room_bans_owner_manage on public.room_bans;
create policy room_bans_owner_manage on public.room_bans for all to authenticated
 using(exists(select 1 from public.rooms r where r.id=room_id and r.owner_id=auth.uid()))
 with check(exists(select 1 from public.rooms r where r.id=room_id and r.owner_id=auth.uid()));
drop policy if exists private_conversation_members_self on public.private_conversation_members;
create policy private_conversation_members_self on public.private_conversation_members for all to authenticated using(user_id=auth.uid()) with check(user_id=auth.uid());
drop policy if exists private_conversations_member_read on public.private_conversations;
create policy private_conversations_member_read on public.private_conversations for select to authenticated
 using(exists(select 1 from public.private_conversation_members m where m.conversation_id=id and m.user_id=auth.uid()));
drop policy if exists private_conversations_member_insert on public.private_conversations;
create policy private_conversations_member_insert on public.private_conversations for insert to authenticated with check(true);
drop policy if exists private_messages_member_read on public.private_messages;
create policy private_messages_member_read on public.private_messages for select to authenticated
 using(exists(select 1 from public.private_conversation_members m where m.conversation_id=conversation_id and m.user_id=auth.uid()));
drop policy if exists private_messages_sender_insert on public.private_messages;
create policy private_messages_sender_insert on public.private_messages for insert to authenticated
 with check(sender_id=auth.uid() and exists(select 1 from public.private_conversation_members m where m.conversation_id=conversation_id and m.user_id=auth.uid()));
drop policy if exists user_inventory_self_read on public.user_inventory;
create policy user_inventory_self_read on public.user_inventory for select to authenticated using(user_id=auth.uid());
drop policy if exists user_reports_self_insert on public.user_reports;
create policy user_reports_self_insert on public.user_reports for insert to authenticated with check(reporter_id=auth.uid());
drop policy if exists user_reports_self_read on public.user_reports;
create policy user_reports_self_read on public.user_reports for select to authenticated using(reporter_id=auth.uid());
drop policy if exists audit_events_owner_read on public.audit_events;
create policy audit_events_owner_read on public.audit_events for select to authenticated using(actor_id=auth.uid());

drop policy if exists profiles_self_select on public.profiles;
create policy profiles_self_select on public.profiles for select to authenticated using(id=auth.uid());
drop policy if exists profiles_self_insert on public.profiles;
create policy profiles_self_insert on public.profiles for insert to authenticated with check(id=auth.uid());
drop policy if exists profiles_self_update on public.profiles;
create policy profiles_self_update on public.profiles for update to authenticated using(id=auth.uid()) with check(id=auth.uid());

do $$ begin
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='room_seats') then alter publication supabase_realtime add table public.room_seats; end if;
 if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='private_messages') then alter publication supabase_realtime add table public.private_messages; end if;
end $$;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('shadow-live-media','shadow-live-media',false,52428800,array['image/jpeg','image/png','image/webp','image/gif','audio/mpeg','audio/mp4','audio/ogg','video/mp4'])
on conflict(id) do nothing;
drop policy if exists shadow_media_read_own on storage.objects;
create policy shadow_media_read_own on storage.objects for select to authenticated using(bucket_id='shadow-live-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists shadow_media_insert_own on storage.objects;
create policy shadow_media_insert_own on storage.objects for insert to authenticated with check(bucket_id='shadow-live-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists shadow_media_update_own on storage.objects;
create policy shadow_media_update_own on storage.objects for update to authenticated using(bucket_id='shadow-live-media' and (storage.foldername(name))[1]=auth.uid()::text) with check(bucket_id='shadow-live-media' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists shadow_media_delete_own on storage.objects;
create policy shadow_media_delete_own on storage.objects for delete to authenticated using(bucket_id='shadow-live-media' and (storage.foldername(name))[1]=auth.uid()::text);

create or replace function public.handle_new_shadow_user()
returns trigger language plpgsql security definer set search_path=''
as $$
begin
 insert into public.profiles(id,username,display_name,created_at,updated_at)
 values(new.id,coalesce(nullif(new.raw_user_meta_data->>'username',''),'user_'||substr(new.id::text,1,8)),
 coalesce(nullif(new.raw_user_meta_data->>'display_name',''),nullif(new.raw_user_meta_data->>'full_name',''),'مستخدم جديد'),now(),now())
 on conflict(id) do nothing;
 insert into public.wallets(user_id,coins,diamonds,updated_at) values(new.id,0,0,now()) on conflict(user_id) do nothing;
 return new;
end; $$;
drop trigger if exists on_shadow_auth_user_created on auth.users;
create trigger on_shadow_auth_user_created after insert on auth.users for each row execute function public.handle_new_shadow_user();
