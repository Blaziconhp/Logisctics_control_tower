-- SHARV Logistics Control Tower — Supabase schema
-- Run once in a new Supabase project's SQL editor, then assign the two admin slots
-- using the commented statements at the end of this file.

create extension if not exists pgcrypto;
create extension if not exists pg_trgm;
create schema if not exists private;

revoke all on schema private from public, anon, authenticated;
-- Authenticated requests need schema USAGE to execute the RLS helper below,
-- but receive no table privileges inside the private schema.
grant usage on schema private to authenticated;

create table if not exists private.upload_admin_slots (
  slot smallint primary key check (slot in (1, 2)),
  user_id uuid unique references auth.users(id) on delete restrict,
  assigned_at timestamptz,
  assigned_by uuid references auth.users(id) on delete set null
);

insert into private.upload_admin_slots(slot) values (1), (2)
on conflict (slot) do nothing;

create or replace function private.is_upload_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from private.upload_admin_slots s
    where s.user_id = auth.uid()
  );
$$;

revoke all on function private.is_upload_admin() from public, anon;
grant execute on function private.is_upload_admin() to authenticated;

create or replace function public.get_my_access()
returns table(is_upload_admin boolean, access_role text)
language sql
stable
security definer
set search_path = ''
as $$
  select
    private.is_upload_admin(),
    case when private.is_upload_admin() then 'upload_admin' else 'viewer' end;
$$;

revoke all on function public.get_my_access() from public, anon;
grant execute on function public.get_my_access() to authenticated;

create table if not exists public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.upload_batches (
  id uuid primary key default gen_random_uuid(),
  source_system text not null check (char_length(source_system) between 1 and 80),
  original_filename text not null check (char_length(original_filename) between 1 and 255),
  object_path text,
  file_size_bytes bigint not null default 0 check (file_size_bytes >= 0),
  status text not null default 'processing' check (status in ('processing', 'completed', 'failed')),
  accepted_rows integer not null default 0 check (accepted_rows >= 0),
  rejected_rows integer not null default 0 check (rejected_rows >= 0),
  duplicate_rows integer not null default 0 check (duplicate_rows >= 0),
  error_summary jsonb not null default '[]'::jsonb,
  uploaded_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create table if not exists public.shipments (
  id uuid primary key default gen_random_uuid(),
  source_system text not null,
  awb text not null,
  order_id text not null default '',
  customer_account text not null default 'Unassigned customer',
  recipient_name text not null default 'Not provided',
  courier text not null,
  city text not null default 'Unknown',
  state text not null default 'Unknown',
  pincode text not null default '',
  warehouse text not null default 'Unknown',
  payment_type text not null default 'Unknown',
  transport_mode text not null default 'Surface',
  direction text not null default 'Forward',
  status text not null,
  status_group text not null,
  order_date timestamptz,
  pickup_date timestamptz,
  delivered_date timestamptz,
  edd timestamptz,
  tat_days numeric(10,2) check (tat_days is null or tat_days >= 0),
  sla_target_days numeric(10,2) check (sla_target_days is null or sla_target_days > 0),
  ageing_days numeric(10,2) check (ageing_days is null or ageing_days >= 0),
  attempts integer not null default 0 check (attempts >= 0),
  freight_inr numeric(14,2) check (freight_inr is null or freight_inr >= 0),
  ndr_status text not null default '',
  remark text not null default '',
  on_time boolean,
  upload_batch_id uuid references public.upload_batches(id) on delete set null,
  raw_payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_system, awb)
);

create table if not exists public.sla_rules (
  id uuid primary key default gen_random_uuid(),
  courier text,
  customer_account text,
  state text,
  city text,
  service_level text not null default 'standard',
  target_days numeric(10,2) not null check (target_days > 0),
  effective_from date not null default current_date,
  effective_to date,
  active boolean not null default true,
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (effective_to is null or effective_to >= effective_from),
  check (courier is not null or customer_account is not null or state is not null or city is not null)
);

create table if not exists public.saved_views (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  definition jsonb not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (jsonb_typeof(definition) = 'object')
);

create table if not exists public.audit_events (
  id bigint generated always as identity primary key,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists shipments_order_date_idx on public.shipments(order_date desc, id);
create index if not exists shipments_courier_state_city_idx on public.shipments(courier, state, city, order_date desc);
create index if not exists shipments_status_idx on public.shipments(status_group, order_date desc);
create index if not exists shipments_order_id_lower_idx on public.shipments(lower(order_id));
create index if not exists shipments_awb_lower_idx on public.shipments(lower(awb));
create index if not exists shipments_customer_trgm_idx on public.shipments using gin (customer_account gin_trgm_ops);
create index if not exists shipments_recipient_trgm_idx on public.shipments using gin (recipient_name gin_trgm_ops);
create index if not exists saved_views_owner_idx on public.saved_views(owner_id, updated_at desc);
create unique index if not exists one_default_view_per_user_idx on public.saved_views(owner_id) where is_default;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at before update on public.profiles for each row execute function public.touch_updated_at();
drop trigger if exists shipments_touch_updated_at on public.shipments;
create trigger shipments_touch_updated_at before update on public.shipments for each row execute function public.touch_updated_at();
drop trigger if exists sla_rules_touch_updated_at on public.sla_rules;
create trigger sla_rules_touch_updated_at before update on public.sla_rules for each row execute function public.touch_updated_at();
drop trigger if exists saved_views_touch_updated_at on public.saved_views;
create trigger saved_views_touch_updated_at before update on public.saved_views for each row execute function public.touch_updated_at();

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles(user_id, display_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1)))
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_user();

alter table public.profiles enable row level security;
alter table public.upload_batches enable row level security;
alter table public.shipments enable row level security;
alter table public.sla_rules enable row level security;
alter table public.saved_views enable row level security;
alter table public.audit_events enable row level security;

drop policy if exists profiles_read_own on public.profiles;
create policy profiles_read_own on public.profiles for select to authenticated using (user_id = auth.uid());
drop policy if exists profiles_update_own on public.profiles;
create policy profiles_update_own on public.profiles for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists batches_read_authenticated on public.upload_batches;
create policy batches_read_authenticated on public.upload_batches for select to authenticated using (true);
drop policy if exists batches_insert_admin on public.upload_batches;
create policy batches_insert_admin on public.upload_batches for insert to authenticated with check ((select private.is_upload_admin()) and uploaded_by = auth.uid());
drop policy if exists batches_update_admin on public.upload_batches;
create policy batches_update_admin on public.upload_batches for update to authenticated using ((select private.is_upload_admin()) and uploaded_by = auth.uid()) with check ((select private.is_upload_admin()) and uploaded_by = auth.uid());

drop policy if exists shipments_read_authenticated on public.shipments;
create policy shipments_read_authenticated on public.shipments for select to authenticated using (true);
drop policy if exists shipments_insert_admin on public.shipments;
create policy shipments_insert_admin on public.shipments for insert to authenticated with check ((select private.is_upload_admin()));
drop policy if exists shipments_update_admin on public.shipments;
create policy shipments_update_admin on public.shipments for update to authenticated using ((select private.is_upload_admin())) with check ((select private.is_upload_admin()));
drop policy if exists shipments_delete_admin on public.shipments;
create policy shipments_delete_admin on public.shipments for delete to authenticated using ((select private.is_upload_admin()));

drop policy if exists sla_rules_read_authenticated on public.sla_rules;
create policy sla_rules_read_authenticated on public.sla_rules for select to authenticated using (true);
drop policy if exists sla_rules_write_admin on public.sla_rules;
create policy sla_rules_write_admin on public.sla_rules for all to authenticated using ((select private.is_upload_admin())) with check ((select private.is_upload_admin()));

drop policy if exists saved_views_read_own on public.saved_views;
create policy saved_views_read_own on public.saved_views for select to authenticated using (owner_id = auth.uid());
drop policy if exists saved_views_insert_own on public.saved_views;
create policy saved_views_insert_own on public.saved_views for insert to authenticated with check (owner_id = auth.uid());
drop policy if exists saved_views_update_own on public.saved_views;
create policy saved_views_update_own on public.saved_views for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
drop policy if exists saved_views_delete_own on public.saved_views;
create policy saved_views_delete_own on public.saved_views for delete to authenticated using (owner_id = auth.uid());

drop policy if exists audit_read_authenticated on public.audit_events;
create policy audit_read_authenticated on public.audit_events for select to authenticated using (true);
drop policy if exists audit_insert_admin on public.audit_events;
create policy audit_insert_admin on public.audit_events for insert to authenticated with check ((select private.is_upload_admin()) and actor_id = auth.uid());

revoke all on public.profiles, public.upload_batches, public.shipments, public.sla_rules, public.saved_views, public.audit_events from anon;
revoke all on public.profiles, public.upload_batches, public.shipments, public.sla_rules, public.saved_views, public.audit_events from authenticated;
grant select on public.profiles to authenticated;
grant update(display_name) on public.profiles to authenticated;
grant select, insert, update on public.upload_batches to authenticated;
grant select, insert, update, delete on public.shipments to authenticated;
grant select, insert, update, delete on public.sla_rules to authenticated;
grant select, insert, update, delete on public.saved_views to authenticated;
grant select, insert on public.audit_events to authenticated;
grant usage, select on sequence public.audit_events_id_seq to authenticated;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values (
  'raw-uploads',
  'raw-uploads',
  false,
  26214400,
  array[
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/octet-stream'
  ]
)
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists raw_uploads_read_authenticated on storage.objects;
create policy raw_uploads_read_authenticated on storage.objects for select to authenticated using (bucket_id = 'raw-uploads');
drop policy if exists raw_uploads_insert_admin on storage.objects;
create policy raw_uploads_insert_admin on storage.objects for insert to authenticated with check (
  bucket_id = 'raw-uploads'
  and (select private.is_upload_admin())
  and (storage.foldername(name))[1] = auth.uid()::text
);

-- Assign exactly two upload admins after inviting them through Authentication > Users.
-- Replace the example emails, then run these two statements in the SQL editor:
-- update private.upload_admin_slots
-- set user_id = (select id from auth.users where lower(email) = lower('primary1@company.com')),
--     assigned_at = now()
-- where slot = 1;
--
-- update private.upload_admin_slots
-- set user_id = (select id from auth.users where lower(email) = lower('primary2@company.com')),
--     assigned_at = now()
-- where slot = 2;
