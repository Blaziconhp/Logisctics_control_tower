-- Existing installations: run once in Supabase SQL Editor. Safe to rerun. No reset.
begin;
alter table public.next_shipments add column if not exists details jsonb not null default '{}';

create table if not exists private.next_import_snapshots(
 id bigint generated always as identity primary key, import_id uuid not null, shipment_id bigint not null,
 captured_at timestamptz not null default now(), payload jsonb not null);
revoke all on private.next_import_snapshots from public,anon,authenticated;
create or replace function public.next_reprocess(p_import uuid,p_expected integer,p_report jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
 if not public.next_is_primary() then raise exception 'Primary access required'; end if;
 if p_expected<1 or p_expected>1000000 then raise exception 'Invalid expected count'; end if;
 perform pg_advisory_xact_lock(918320);
 perform 1 from public.next_imports where id=p_import and owner_id=auth.uid() for update;
 if not found then raise exception 'Only the original upload owner can reprocess this file'; end if;
 delete from private.next_staging where import_id=p_import;
 update public.next_imports set status='staging',expected_shipments=p_expected,report=p_report,completed_at=null where id=p_import;
end $$;
revoke all on function public.next_reprocess(uuid,integer,jsonb) from public,anon;
grant execute on function public.next_reprocess(uuid,integer,jsonb) to authenticated;

create or replace function public.next_finalize(p_import uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare b public.next_imports; n integer; changed integer;
begin
 if not public.next_is_primary() then raise exception 'Primary access required'; end if;
 -- Serialize imports and tracking events to avoid stale report/event races.
 perform pg_advisory_xact_lock(918320);
 select * into b from public.next_imports where id=p_import and owner_id=auth.uid() for update;
 if b.id is null then raise exception 'Import not found'; end if;
 if b.status='completed' then return jsonb_build_object('already_completed',true); end if;
 select count(*) into n from private.next_staging where import_id=p_import;
 if n<>b.expected_shipments or n=0 then raise exception 'Staged count does not match expected shipment count'; end if;
 if not exists(select 1 from storage.objects where bucket_id='shiprocket-sources' and name=b.object_path) then raise exception 'Original archive is missing'; end if;
 insert into private.next_import_snapshots(import_id,shipment_id,payload)
 select p_import,id,to_jsonb(s) from public.next_shipments s where s.import_id=p_import or (s.awb ~* '^[+-]?[0-9]+([.][0-9]+)?e[+-]?[0-9]+$' and exists(select 1 from private.next_staging t where t.import_id=p_import and t.payload->>'order_id'=s.order_id));
 update public.next_shipments s set shipment_key=x.shipment_key,awb=x.awb
 from (select payload->>'order_id' order_id,min(payload->>'shipment_key') shipment_key,min(payload->>'awb') awb
 from private.next_staging where import_id=p_import group by payload->>'order_id' having count(*)=1) x
 where (s.import_id=p_import or s.awb ~* '^[+-]?[0-9]+([.][0-9]+)?e[+-]?[0-9]+$') and s.order_id=x.order_id and s.shipment_key<>x.shipment_key
 and not exists(select 1 from public.next_shipments other where other.shipment_key=x.shipment_key);
 -- Promote an order-only row only when this report maps that merchant order to exactly one AWB.
 update public.next_shipments s set shipment_key=x.shipment_key,awb=x.awb
 from (select payload->>'order_id' order_id,min(payload->>'shipment_key') shipment_key,min(payload->>'awb') awb
       from private.next_staging where import_id=p_import and payload->>'awb' is not null
       group by payload->>'order_id' having count(distinct payload->>'awb')=1) x
 where s.awb is null and s.order_id=x.order_id and s.status not in('Delivered','RTO Delivered','Lost','Damaged')
 and not exists(select 1 from public.next_shipments other where other.shipment_key=x.shipment_key);
 insert into public.next_shipments as current(shipment_key,awb,order_id,provider_order_id,provider_shipment_id,courier,customer,recipient,city,state,pincode,payment,warehouse,status,order_date,pickup_date,delivered_date,edd,status_at,freight,attempts,product,sku,quantity,remark,details,source_refs,import_id)
 select r.shipment_key,r.awb,r.order_id,r.provider_order_id,r.provider_shipment_id,r.courier,r.customer,r.recipient,r.city,r.state,r.pincode,r.payment,r.warehouse,coalesce(r.status,'Unknown'),r.order_date,r.pickup_date,r.delivered_date,r.edd,r.status_at,r.freight,r.attempts,r.product,r.sku,r.quantity,r.remark,coalesce(r.details,'{}'),coalesce(r.source_refs,'[]'),p_import
 from private.next_staging s cross join lateral jsonb_populate_record(null::public.next_shipments,s.payload) r where s.import_id=p_import
 on conflict(shipment_key) do update set
 order_id=coalesce(excluded.order_id,current.order_id),provider_order_id=coalesce(excluded.provider_order_id,current.provider_order_id),provider_shipment_id=coalesce(excluded.provider_shipment_id,current.provider_shipment_id),
 courier=coalesce(excluded.courier,current.courier),customer=coalesce(excluded.customer,current.customer),recipient=coalesce(excluded.recipient,current.recipient),city=coalesce(excluded.city,current.city),state=coalesce(excluded.state,current.state),pincode=coalesce(excluded.pincode,current.pincode),payment=coalesce(excluded.payment,current.payment),warehouse=coalesce(excluded.warehouse,current.warehouse),
 status=case when current.status in('Delivered','RTO Delivered','Lost','Damaged') or (current.status_at is not null and (excluded.status_at is null or excluded.status_at<=current.status_at)) then current.status else excluded.status end,
 status_at=case when current.status in('Delivered','RTO Delivered','Lost','Damaged') then current.status_at else greatest(current.status_at,excluded.status_at) end,
 order_date=coalesce(excluded.order_date,current.order_date),pickup_date=coalesce(excluded.pickup_date,current.pickup_date),delivered_date=coalesce(current.delivered_date,excluded.delivered_date),edd=coalesce(excluded.edd,current.edd),
 freight=coalesce(excluded.freight,current.freight),attempts=greatest(excluded.attempts,current.attempts),product=coalesce(excluded.product,current.product),sku=coalesce(excluded.sku,current.sku),quantity=coalesce(excluded.quantity,current.quantity),remark=coalesce(excluded.remark,current.remark),details=current.details||excluded.details,source_refs=excluded.source_refs,import_id=p_import,updated_at=now();
 get diagnostics changed=row_count;
 -- Only obsolete records derived from this exact archive are replaced. Preserve unrelated imports and all event history.
 delete from public.next_shipments s where s.import_id=p_import and not exists(
 select 1 from private.next_staging t where t.import_id=p_import and t.shipment_key=s.shipment_key);

 update public.next_imports set status='completed',completed_at=now() where id=p_import;
 delete from private.next_staging where import_id=p_import;
 return jsonb_build_object('processed',changed,'source_rows',b.source_rows,'rejected_rows',b.rejected_rows);
end $$;


notify pgrst, 'reload schema';
commit;
