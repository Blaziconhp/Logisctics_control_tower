-- First-delivery capture only. No shipment or existing import data is changed.
begin;
create schema if not exists private;
create table if not exists private.report_deliveries (
 id uuid primary key default gen_random_uuid(),
 received_at timestamptz not null default now(),
 fingerprint text not null unique,
 content_type text not null,
 body_base64 text not null,
 byte_length integer not null check(byte_length between 1 and 1048576),
 state text not null default 'awaiting_mapping'
);
revoke all on private.report_deliveries from public,anon,authenticated;
create or replace function public.capture_report_delivery(p_fingerprint text,p_content_type text,p_body_base64 text,p_byte_length integer)
returns uuid language plpgsql security definer set search_path='' as $$
declare result uuid;
begin
 if length(p_fingerprint)<>64 or p_byte_length<1 or p_byte_length>1048576 then raise exception 'Invalid delivery'; end if;
 insert into private.report_deliveries(fingerprint,content_type,body_base64,byte_length)
 values(p_fingerprint,left(p_content_type,200),p_body_base64,p_byte_length)
 on conflict(fingerprint) do nothing returning id into result;
 if result is null then select id into result from private.report_deliveries where fingerprint=p_fingerprint; end if;
 return result;
end $$;
revoke all on function public.capture_report_delivery(text,text,text,integer) from public,anon,authenticated;
grant execute on function public.capture_report_delivery(text,text,text,integer) to service_role;
notify pgrst,'reload schema';
commit;

begin;
alter table private.report_deliveries add column if not exists import_id uuid references public.next_imports(id);
alter table private.report_deliveries add column if not exists last_error text;
create or replace function public.report_pending(p_id uuid default null) returns jsonb
language sql security definer set search_path='' as $$
 select to_jsonb(d) from private.report_deliveries d where (p_id is null or d.id=p_id) and d.state<>'completed' order by d.received_at asc limit 1
$$;
create or replace function public.report_failed(p_id uuid) returns void
language sql security definer set search_path='' as $$
 update private.report_deliveries set state='failed',last_error='Processing failed. Check receiver response and retry.' where id=p_id and state<>'completed'
$$;
-- Only service_role may delegate to the established importer. Identity is chosen
-- from the configured primary slots, never from a webhook-supplied user ID.
create or replace function public.report_import(p_delivery uuid,p_hash text,p_bytes bigint,p_compressed bigint,p_source_rows integer,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner uuid; batch public.next_imports; old_sub text; old_claims text; result jsonb;
begin
 perform pg_advisory_xact_lock(918320);
 if not exists(select 1 from private.report_deliveries where id=p_delivery) then raise exception 'Unknown delivery'; end if;
 if p_hash !~ '^[a-f0-9]{64}$' or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows) not between 1 and 20000 then raise exception 'Invalid report'; end if;
 select * into batch from public.next_imports where sha256=p_hash;
 if batch.id is not null and batch.status='completed' then
  update private.report_deliveries set state='completed',import_id=batch.id,last_error=null where id=p_delivery;
  return jsonb_build_object('already_completed',true,'import_id',batch.id);
 end if;
 if batch.id is not null then raise exception 'This file has an unfinished manual import; finish that upload first'; end if;
 select user_id into owner from private.primary_users where user_id is not null order by slot limit 1;
 if owner is null then raise exception 'Configure a primary uploader first'; end if;
 insert into public.next_imports(owner_id,filename,object_path,sha256,original_bytes,compressed_bytes,source_rows,rejected_rows,expected_shipments,report)
 values(owner,'Shiprocket scheduled report.csv','reports/'||p_hash||'.gz',p_hash,p_bytes,p_compressed,p_source_rows,0,jsonb_array_length(p_rows),jsonb_build_object('origin','shiprocket-report','delivery_id',p_delivery)) returning * into batch;
 insert into private.next_staging select batch.id,x->>'shipment_key',x from jsonb_array_elements(p_rows) x;
 old_sub:=current_setting('request.jwt.claim.sub',true); old_claims:=current_setting('request.jwt.claims',true);
 perform set_config('request.jwt.claim.sub',owner::text,true);
 perform set_config('request.jwt.claims',jsonb_build_object('sub',owner)::text,true);
 result:=public.next_finalize(batch.id);
 perform set_config('request.jwt.claim.sub',coalesce(old_sub,''),true);
 perform set_config('request.jwt.claims',coalesce(old_claims,''),true);
 update private.report_deliveries set state='completed',import_id=batch.id,last_error=null where id=p_delivery;
 return result||jsonb_build_object('import_id',batch.id);
end $$;
revoke all on function public.report_pending(uuid),public.report_failed(uuid),public.report_import(uuid,text,bigint,bigint,integer,jsonb) from public,anon,authenticated;
grant execute on function public.report_pending(uuid),public.report_failed(uuid),public.report_import(uuid,text,bigint,bigint,integer,jsonb) to service_role;
notify pgrst,'reload schema';
commit;
