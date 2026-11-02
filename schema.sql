-- Trotuar Liber – schema Supabase (rulează o singură dată în SQL Editor)
-- Fiecare utilizator vede și modifică DOAR propriile sesizări și poze (RLS pe auth.uid()).

-- 1. Registrul de sesizări
create table if not exists public.tl_sesizari (
  id          text primary key,
  owner       uuid not null default auth.uid() references auth.users(id) on delete cascade,
  data        jsonb not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint tl_data_size check (pg_column_size(data) < 262144)
);
alter table public.tl_sesizari enable row level security;

drop policy if exists tl_select_own on public.tl_sesizari;
drop policy if exists tl_insert_own on public.tl_sesizari;
drop policy if exists tl_update_own on public.tl_sesizari;
drop policy if exists tl_delete_own on public.tl_sesizari;
create policy tl_select_own on public.tl_sesizari for select to authenticated using (owner = auth.uid());
create policy tl_insert_own on public.tl_sesizari for insert to authenticated with check (owner = auth.uid());
create policy tl_update_own on public.tl_sesizari for update to authenticated using (owner = auth.uid()) with check (owner = auth.uid());
create policy tl_delete_own on public.tl_sesizari for delete to authenticated using (owner = auth.uid());

revoke all on public.tl_sesizari from anon;
grant select, insert, update, delete on public.tl_sesizari to authenticated;

-- 2. Contor zilnic de analize (doar funcția de pe server îl poate folosi)
create table if not exists public.tl_usage (
  owner uuid not null references auth.users(id) on delete cascade,
  day   date not null default current_date,
  n     int  not null default 0,
  primary key (owner, day)
);
alter table public.tl_usage enable row level security;   -- fără politici: nimeni din browser nu are acces
revoke all on public.tl_usage from anon, authenticated;

create or replace function public.tl_bump_usage(p_owner uuid)
returns int language plpgsql security definer set search_path = public as $$
declare v int;
begin
  insert into public.tl_usage(owner, day, n) values (p_owner, current_date, 1)
  on conflict (owner, day) do update set n = public.tl_usage.n + 1
  returning n into v;
  return v;
end $$;
revoke execute on function public.tl_bump_usage(uuid) from public, anon, authenticated;
grant execute on function public.tl_bump_usage(uuid) to service_role;

-- 3. Pozele: bucket PRIVAT, max 5 MB, doar JPEG; fiecare utilizator în folderul lui (<id>/...)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('tl-foto', 'tl-foto', false, 5242880, array['image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg'];

drop policy if exists tl_foto_select on storage.objects;
drop policy if exists tl_foto_insert on storage.objects;
drop policy if exists tl_foto_delete on storage.objects;
create policy tl_foto_select on storage.objects for select to authenticated
  using (bucket_id = 'tl-foto' and (storage.foldername(name))[1] = auth.uid()::text);
create policy tl_foto_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'tl-foto' and (storage.foldername(name))[1] = auth.uid()::text);
create policy tl_foto_delete on storage.objects for delete to authenticated
  using (bucket_id = 'tl-foto' and (storage.foldername(name))[1] = auth.uid()::text);
