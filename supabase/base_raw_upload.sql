-- SHARV Base Raw Data atomic replacement + staging.
-- Run this once in Supabase SQL Editor after schema.sql.

create table if not exists public.shipment_upload_staging (
  batch_id uuid not null references public.upload_batches(id) on delete cascade,
  row_number integer not null check (row_number > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  created_at timestamptz not null default now(),
  primary key (batch_id, row_number)
);

revoke all on public.shipment_upload_staging from public, anon, authenticated;

drop policy if exists raw_uploads_delete_admin on storage.objects;
create policy raw_uploads_delete_admin on storage.objects for delete to authenticated using (
  bucket_id = 'raw-uploads' and (select private.is_upload_admin())
);

create or replace function public.stage_shipment_upload(p_batch_id uuid, p_rows jsonb)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
  v_next integer;
begin
  if not private.is_upload_admin() then
    raise exception 'Upload administrator access required' using errcode = '42501';
  end if;
  if jsonb_typeof(p_rows) <> 'array' or jsonb_array_length(p_rows) = 0 or jsonb_array_length(p_rows) > 300 then
    raise exception 'Each stage call must include between 1 and 300 rows';
  end if;
  if not exists (
    select 1 from public.upload_batches b
    where b.id = p_batch_id and b.uploaded_by = auth.uid()
      and b.source_system = 'Base Raw Data' and b.status = 'processing'
  ) then
    raise exception 'Active Base Raw Data upload batch not found';
  end if;
  select coalesce(max(s.row_number), 0) + 1 into v_next
  from public.shipment_upload_staging s where s.batch_id = p_batch_id;
  insert into public.shipment_upload_staging(batch_id, row_number, payload)
  select p_batch_id, v_next + (entry.ordinality - 1)::integer, entry.value
  from jsonb_array_elements(p_rows) with ordinality as entry(value, ordinality);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create or replace function public.finalize_base_raw_upload(
  p_batch_id uuid,
  p_accepted integer,
  p_rejected integer,
  p_duplicates integer,
  p_object_path text
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  -- Large normalized workbooks can require more than Supabase's short
  -- default statement window while the staged JSON is converted into rows.
  -- Keep the replacement atomic, but allow the single transaction enough
  -- time to finish instead of timing out halfway through the insert.
  set local statement_timeout = '120s';
  set local lock_timeout = '15s';
  if not private.is_upload_admin() then
    raise exception 'Upload administrator access required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.upload_batches b
    where b.id = p_batch_id and b.uploaded_by = auth.uid()
      and b.source_system = 'Base Raw Data' and b.status = 'processing'
  ) then
    raise exception 'Active Base Raw Data upload batch not found';
  end if;
  select count(*) into v_count from public.shipment_upload_staging where batch_id = p_batch_id;
  if v_count = 0 or v_count <> p_accepted then
    raise exception 'Staged row count does not match accepted row count';
  end if;

  -- Prevent two primary users from interleaving separate base replacements.
  perform pg_advisory_xact_lock(hashtext('sharv-base-raw-replacement'));

  -- Both changes occur in this transaction: any constraint failure preserves
  -- the previous live dataset and leaves this upload uncommitted.
  truncate table public.shipments;
  insert into public.shipments (
    source_system, awb, order_id, customer_account, recipient_name, courier,
    city, state, pincode, warehouse, payment_type, transport_mode, direction,
    status, status_group, order_date, pickup_date, delivered_date, edd, tat_days,
    sla_target_days, ageing_days, attempts, freight_inr, ndr_status, remark,
    on_time, upload_batch_id, raw_payload
  )
  select p.source_system, p.awb, p.order_id, p.customer_account, p.recipient_name, p.courier,
    p.city, p.state, p.pincode, p.warehouse, p.payment_type, p.transport_mode, p.direction,
    p.status, p.status_group, p.order_date, p.pickup_date, p.delivered_date, p.edd, p.tat_days,
    p.sla_target_days, p.ageing_days, p.attempts, p.freight_inr, p.ndr_status, p.remark,
    p.on_time, p.upload_batch_id, p.raw_payload
  from public.shipment_upload_staging s
  cross join lateral jsonb_populate_record(null::public.shipments, s.payload) as p
  where s.batch_id = p_batch_id
  order by s.row_number;

  update public.upload_batches
  set status = 'completed', object_path = p_object_path,
      accepted_rows = p_accepted, rejected_rows = p_rejected,
      duplicate_rows = p_duplicates, completed_at = now()
  where id = p_batch_id;
  delete from public.shipment_upload_staging where batch_id = p_batch_id;
  -- A Base Raw Data replacement also retires prior batch metadata. The client
  -- removes the corresponding private source files after this transaction.
  delete from public.upload_batches
  where source_system = 'Base Raw Data' and id <> p_batch_id;
  insert into public.audit_events(actor_id, action, entity_type, entity_id, details)
  values (auth.uid(), 'base_dataset_replaced', 'upload_batch', p_batch_id::text,
          jsonb_build_object('accepted_rows', p_accepted, 'rejected_rows', p_rejected, 'duplicate_rows', p_duplicates));
  return v_count;
end;
$$;

revoke all on function public.stage_shipment_upload(uuid, jsonb) from public, anon;
revoke all on function public.finalize_base_raw_upload(uuid, integer, integer, integer, text) from public, anon;
grant execute on function public.stage_shipment_upload(uuid, jsonb) to authenticated;
grant execute on function public.finalize_base_raw_upload(uuid, integer, integer, integer, text) to authenticated;
