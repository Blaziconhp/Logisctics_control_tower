-- SHARV: primary-user-only removal of the current shared shipment dataset.
-- Run once in Supabase SQL Editor after schema.sql and base_raw_upload.sql.

create or replace function public.clear_active_dataset()
returns text[]
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_source_paths text[];
  v_deleted_rows bigint;
begin
  set local statement_timeout = '120s';
  set local lock_timeout = '15s';

  if not private.is_upload_admin() then
    raise exception 'Upload administrator access required' using errcode = '42501';
  end if;

  -- Share the same lock used by Base Raw Data replacement so those operations
  -- cannot replace or clear the dataset at the same time.
  perform pg_advisory_xact_lock(hashtext('sharv-base-raw-replacement'));

  select coalesce(array_agg(b.object_path) filter (where b.object_path is not null), array[]::text[])
    into v_source_paths
  from public.upload_batches b;

  delete from public.shipments where true;
  get diagnostics v_deleted_rows = row_count;

  -- Cascades remove any unfinalized staging rows associated with upload batches.
  delete from public.upload_batches where true;

  insert into public.audit_events(actor_id, action, entity_type, entity_id, details)
  values (
    auth.uid(),
    'active_dataset_cleared',
    'shipment_dataset',
    null,
    jsonb_build_object('deleted_rows', v_deleted_rows)
  );

  return v_source_paths;
end;
$$;

revoke all on function public.clear_active_dataset() from public, anon;
grant execute on function public.clear_active_dataset() to authenticated;
