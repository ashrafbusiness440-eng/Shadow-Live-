-- Harden private-message membership checks and add FK indexes.
drop policy if exists private_messages_member_read on public.private_messages;
create policy private_messages_member_read on public.private_messages for select to authenticated
using (exists(select 1 from public.private_conversation_members m where m.conversation_id=private_messages.conversation_id and m.user_id=(select auth.uid())));
drop policy if exists private_messages_sender_insert on public.private_messages;
create policy private_messages_sender_insert on public.private_messages for insert to authenticated
with check(sender_id=(select auth.uid()) and exists(select 1 from public.private_conversation_members m where m.conversation_id=private_messages.conversation_id and m.user_id=(select auth.uid())));
drop policy if exists user_settings_self on public.user_settings;
create policy user_settings_self on public.user_settings for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists user_devices_self on public.user_devices;
create policy user_devices_self on public.user_devices for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists public_ids_insert_self on public.public_ids;
create policy public_ids_insert_self on public.public_ids for insert to authenticated with check(user_id=(select auth.uid()));
drop policy if exists room_seats_manage on public.room_seats;
create policy room_seats_manage on public.room_seats for all to authenticated
using(exists(select 1 from public.rooms r where r.id=room_seats.room_id and r.owner_id=(select auth.uid())) or user_id=(select auth.uid()))
with check(exists(select 1 from public.rooms r where r.id=room_seats.room_id and r.owner_id=(select auth.uid())) or user_id=(select auth.uid()));
drop policy if exists room_moderators_read on public.room_moderators;
create policy room_moderators_read on public.room_moderators for select to authenticated
using(exists(select 1 from public.rooms r where r.id=room_moderators.room_id and r.owner_id=(select auth.uid())) or exists(select 1 from public.room_members rm where rm.room_id=room_moderators.room_id and rm.user_id=(select auth.uid())));
drop policy if exists room_moderators_owner_manage on public.room_moderators;
create policy room_moderators_owner_manage on public.room_moderators for all to authenticated
using(exists(select 1 from public.rooms r where r.id=room_moderators.room_id and r.owner_id=(select auth.uid())))
with check(exists(select 1 from public.rooms r where r.id=room_moderators.room_id and r.owner_id=(select auth.uid())));
drop policy if exists room_bans_read on public.room_bans;
create policy room_bans_read on public.room_bans for select to authenticated
using(exists(select 1 from public.rooms r where r.id=room_bans.room_id and r.owner_id=(select auth.uid())) or exists(select 1 from public.room_members rm where rm.room_id=room_bans.room_id and rm.user_id=(select auth.uid())));
drop policy if exists room_bans_owner_manage on public.room_bans;
create policy room_bans_owner_manage on public.room_bans for all to authenticated
using(exists(select 1 from public.rooms r where r.id=room_bans.room_id and r.owner_id=(select auth.uid())))
with check(exists(select 1 from public.rooms r where r.id=room_bans.room_id and r.owner_id=(select auth.uid())));
drop policy if exists private_conversation_members_self on public.private_conversation_members;
create policy private_conversation_members_self on public.private_conversation_members for all to authenticated using(user_id=(select auth.uid())) with check(user_id=(select auth.uid()));
drop policy if exists private_conversations_member_read on public.private_conversations;
create policy private_conversations_member_read on public.private_conversations for select to authenticated
using(exists(select 1 from public.private_conversation_members m where m.conversation_id=private_conversations.id and m.user_id=(select auth.uid())));
drop policy if exists user_inventory_self_read on public.user_inventory;
create policy user_inventory_self_read on public.user_inventory for select to authenticated using(user_id=(select auth.uid()));
drop policy if exists user_reports_self_insert on public.user_reports;
create policy user_reports_self_insert on public.user_reports for insert to authenticated with check(reporter_id=(select auth.uid()));
drop policy if exists user_reports_self_read on public.user_reports;
create policy user_reports_self_read on public.user_reports for select to authenticated using(reporter_id=(select auth.uid()));
drop policy if exists audit_events_owner_read on public.audit_events;
create policy audit_events_owner_read on public.audit_events for select to authenticated using(actor_id=(select auth.uid()));
create index if not exists audit_events_actor_id_idx on public.audit_events(actor_id);
create index if not exists private_conversation_members_user_id_idx on public.private_conversation_members(user_id);
create index if not exists private_messages_conversation_id_idx on public.private_messages(conversation_id);
create index if not exists private_messages_sender_id_idx on public.private_messages(sender_id);
create index if not exists public_ids_user_id_idx on public.public_ids(user_id);
create index if not exists room_bans_user_id_idx on public.room_bans(user_id);
create index if not exists room_bans_banned_by_idx on public.room_bans(banned_by);
create index if not exists room_moderators_user_id_idx on public.room_moderators(user_id);
create index if not exists room_moderators_granted_by_idx on public.room_moderators(granted_by);
create index if not exists room_seats_user_id_idx on public.room_seats(user_id);
create index if not exists user_reports_reporter_id_idx on public.user_reports(reporter_id);
create index if not exists user_reports_reported_user_id_idx on public.user_reports(reported_user_id);
create index if not exists user_reports_room_id_idx on public.user_reports(room_id);
create index if not exists voice_rooms_owner_id_idx on public.voice_rooms(owner_id);
