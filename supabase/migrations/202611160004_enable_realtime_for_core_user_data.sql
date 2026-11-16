-- Enable Realtime streams used by profile, wallet, notifications and social UI.
do $$
declare t text;
begin
 foreach t in array array['profiles','wallets','notifications','follows','gift_transactions','user_vips'] loop
  if not exists(select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename=t) then
   execute format('alter publication supabase_realtime add table public.%I',t);
  end if;
 end loop;
end $$;
