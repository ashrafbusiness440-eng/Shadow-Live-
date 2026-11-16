-- Deduplicate profile policies and split room management writes from reads.
drop policy if exists "profiles readable" on public.profiles;
drop policy if exists profiles_self_select on public.profiles;
drop policy if exists profiles_self_insert on public.profiles;
drop policy if exists profiles_self_update on public.profiles;
drop policy if exists profiles_update_self on public.profiles;
drop policy if exists room_moderators_owner_manage on public.room_moderators;
create policy room_moderators_owner_insert on public.room_moderators for insert to authenticated with check(exists(select 1 from public.rooms r where r.id=room_moderators.room_id and r.owner_id=(select auth.uid())));
create policy room_moderators_owner_update on public.room_moderators for update to authenticated using(exists(select 1 from public.rooms r where r.id=room_moderators.room_id and r.owner_id=(select auth.uid()))) with check(exists(select 1 from public.rooms r where r.id=room_moderators.room_id and r.owner_id=(select auth.uid())));
create policy room_moderators_owner_delete on public.room_moderators for delete to authenticated using(exists(select 1 from public.rooms r where r.id=room_moderators.room_id and r.owner_id=(select auth.uid())));
drop policy if exists room_bans_owner_manage on public.room_bans;
create policy room_bans_owner_insert on public.room_bans for insert to authenticated with check(exists(select 1 from public.rooms r where r.id=room_bans.room_id and r.owner_id=(select auth.uid())));
create policy room_bans_owner_update on public.room_bans for update to authenticated using(exists(select 1 from public.rooms r where r.id=room_bans.room_id and r.owner_id=(select auth.uid()))) with check(exists(select 1 from public.rooms r where r.id=room_bans.room_id and r.owner_id=(select auth.uid())));
create policy room_bans_owner_delete on public.room_bans for delete to authenticated using(exists(select 1 from public.rooms r where r.id=room_bans.room_id and r.owner_id=(select auth.uid())));
drop policy if exists room_seats_manage on public.room_seats;
create policy room_seats_owner_insert on public.room_seats for insert to authenticated with check(exists(select 1 from public.rooms r where r.id=room_seats.room_id and r.owner_id=(select auth.uid())) or user_id=(select auth.uid()));
create policy room_seats_owner_update on public.room_seats for update to authenticated using(exists(select 1 from public.rooms r where r.id=room_seats.room_id and r.owner_id=(select auth.uid())) or user_id=(select auth.uid())) with check(exists(select 1 from public.rooms r where r.id=room_seats.room_id and r.owner_id=(select auth.uid())) or user_id=(select auth.uid()));
create policy room_seats_owner_delete on public.room_seats for delete to authenticated using(exists(select 1 from public.rooms r where r.id=room_seats.room_id and r.owner_id=(select auth.uid())) or user_id=(select auth.uid()));
