-- Pin set_updated_at()'s search_path. The Supabase security advisor flags
-- any function without an explicit search_path as a hardening gap (a
-- mutable search_path can be hijacked by creating same-named objects
-- earlier in the resolution order). This function only ever needs
-- objects in `public`, so pin it there plus `pg_temp` for temp-table safety.
create or replace function set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql
set search_path = public, pg_temp;
