-- =====================================================================
--  BAHETI Material Sorting Tracker  -  Supabase database setup
--  Run this ONCE in:  Supabase Dashboard > SQL Editor > New query > Run
--  It is safe to run again (it will not duplicate data).
-- =====================================================================

-- 1) Main table: one row per sorting / heat entry --------------------
create table if not exists public.sorting_logs (
  id               uuid primary key default gen_random_uuid(),
  heat_no          text        not null,
  entry_datetime   timestamptz not null,
  material_type    text        not null,
  vendor_name      text        not null,
  contractor_name  text        not null,
  workers          integer     not null check (workers > 0),
  work_hours       numeric     not null check (work_hours > 0),
  sorted_qty       numeric     not null check (sorted_qty > 0),
  issued_on        text        not null,
  created_by       uuid        default auth.uid() references auth.users (id) on delete set null,
  created_at       timestamptz not null default now()
);

create index if not exists sorting_logs_entry_datetime_idx
  on public.sorting_logs (entry_datetime desc);
create index if not exists sorting_logs_contractor_idx
  on public.sorting_logs (contractor_name);

-- 2) Dropdown master list (materials, vendors, contractors, locations)
create table if not exists public.master_options (
  id          uuid primary key default gen_random_uuid(),
  category    text not null check (category in ('materialType','vendorName','contractorName','issuedOn')),
  value       text not null,
  sort_order  integer not null default 0,
  created_at  timestamptz not null default now(),
  unique (category, value)
);

-- 3) Default dropdown values (same as your original app) --------------
insert into public.master_options (category, value, sort_order) values
  ('materialType','Cut and Shredded',1),
  ('materialType','Shredded',2),
  ('materialType','Hamelled',3),
  ('materialType','Casting/Tense',4),
  ('materialType','Zorba',5),
  ('materialType','HRB',6),
  ('materialType','Choora',7),
  ('vendorName','Indica',1),
  ('vendorName','Shakti',2),
  ('contractorName','Surrendra',1),
  ('contractorName','Uday Gupta',2),
  ('contractorName','Damodar',3),
  ('contractorName','Bhanu',4),
  ('issuedOn','TRF 1',1),
  ('issuedOn','TRF 2',2),
  ('issuedOn','ELF-01',3),
  ('issuedOn','ELF-02',4),
  ('issuedOn','ELF-03',5),
  ('issuedOn','ELF-04',6),
  ('issuedOn','ELF-05',7),
  ('issuedOn','F-01',8),
  ('issuedOn','F-02',9),
  ('issuedOn','F-03',10),
  ('issuedOn','F-04',11),
  ('issuedOn','F-05',12),
  ('issuedOn','F-06',13),
  ('issuedOn','F-07',14)
on conflict (category, value) do nothing;

-- 4) Security (Row Level Security) -----------------------------------
--    Only people who are LOGGED IN can read or change data.
--    Anonymous visitors (anyone with just the website link) get nothing.
alter table public.sorting_logs   enable row level security;
alter table public.master_options enable row level security;

drop policy if exists "logs_select"    on public.sorting_logs;
drop policy if exists "logs_insert"    on public.sorting_logs;
drop policy if exists "logs_update"    on public.sorting_logs;
drop policy if exists "logs_delete"    on public.sorting_logs;
drop policy if exists "options_select" on public.master_options;
drop policy if exists "options_insert" on public.master_options;

create policy "logs_select" on public.sorting_logs
  for select to authenticated using (true);
create policy "logs_insert" on public.sorting_logs
  for insert to authenticated with check (true);
create policy "logs_update" on public.sorting_logs
  for update to authenticated using (true) with check (true);
create policy "logs_delete" on public.sorting_logs
  for delete to authenticated using (true);

create policy "options_select" on public.master_options
  for select to authenticated using (true);
create policy "options_insert" on public.master_options
  for insert to authenticated with check (true);

-- 5) Live updates: other logged-in users see new entries instantly ---
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'sorting_logs'
  ) then
    alter publication supabase_realtime add table public.sorting_logs;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'master_options'
  ) then
    alter publication supabase_realtime add table public.master_options;
  end if;
end $$;
