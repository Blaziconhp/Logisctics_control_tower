-- NEW Supabase project only. Independent of the legacy tables. Run as postgres.
begin;
create schema if not exists private;
create table private.primary_users(slot smallint primary key check(slot in(1,2)), user_id uuid unique references auth.users(id) on delete set null);
insert into private.primary_users(slot) values(1),(2);
revoke all on private.primary_users from public,anon,authenticated;
create function public.next_is_primary() returns boolean language sql stable security definer set search_path='' as $$ select exists(select 1 from private.primary_users where user_id=auth.uid()) $$;
revoke all on function public.next_is_primary() from public,anon;
grant execute on function public.next_is_primary() to authenticated;

create table public.next_imports(
 id uuid primary key default gen_random_uuid(), owner_id uuid not null default auth.uid() references auth.users(id),
 filename text not null, object_path text not null unique, sha256 text not null check(length(sha256)=64),
 original_bytes bigint not null, compressed_bytes bigint not null, source_rows integer not null, rejected_rows integer not null default 0,
 expected_shipments integer not null, status text not null default 'staging' check(status in('staging','completed','failed')),
 created_at timestamptz not null default now(), completed_at timestamptz, report jsonb not null default '{}'::jsonb,
 unique(sha256)
);
create table public.next_shipments(
 id bigint generated always as identity primary key,
 shipment_key text not null unique, awb text, order_id text, provider_order_id text, provider_shipment_id text,
 courier text, customer text, recipient text, city text, state text, pincode text, payment text, warehouse text,
 status text not null default 'Unknown', order_date timestamptz, pickup_date timestamptz, delivered_date timestamptz, edd timestamptz,
 status_at timestamptz, freight numeric check(freight>=0), attempts integer check(attempts>=0), product text, sku text, quantity numeric,
 details jsonb not null default '{}', remark text, source_refs jsonb not null default '[]', import_id uuid references public.next_imports(id), updated_at timestamptz not null default now(),
 check(awb is not null or order_id is not null)
);
create index on public.next_shipments(order_date desc,id);
create index on public.next_shipments(courier,state,status);
create index on public.next_shipments(order_id);
create index on public.next_shipments(awb);
create table private.next_staging(import_id uuid references public.next_imports(id) on delete cascade, shipment_key text, payload jsonb not null, primary key(import_id,shipment_key));
create table public.next_views(id uuid primary key default gen_random_uuid(),owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,name text not null check(length(name) between 1 and 80),definition jsonb not null,created_at timestamptz default now());
create table public.next_events(id bigint generated always as identity primary key,event_key text not null unique,awb text not null,event_at timestamptz not null,status text not null,payload jsonb not null,outcome text not null,created_at timestamptz default now());
create index on public.next_events(awb,event_at desc);

alter table public.next_imports enable row level security;
alter table public.next_shipments enable row level security;
alter table public.next_views enable row level security;
alter table public.next_events enable row level security;
create policy read_imports on public.next_imports for select to authenticated using(true);
create policy insert_imports on public.next_imports for insert to authenticated with check(public.next_is_primary() and owner_id=auth.uid() and status='staging' and object_path=auth.uid()::text||'/'||sha256||'.gz');
create policy update_imports on public.next_imports for update to authenticated using(public.next_is_primary() and owner_id=auth.uid()) with check(public.next_is_primary() and owner_id=auth.uid());
create policy read_shipments on public.next_shipments for select to authenticated using(true);
create policy read_events on public.next_events for select to authenticated using(true);
create policy own_views on public.next_views for all to authenticated using(owner_id=auth.uid()) with check(owner_id=auth.uid());
revoke all on public.next_imports,public.next_shipments,public.next_views,public.next_events from public,anon,authenticated;
grant select,insert on public.next_imports to authenticated;
-- Finalization/state updates occur only through protected transactional functions.
grant select on public.next_shipments,public.next_events to authenticated;
grant select,insert,update,delete on public.next_views to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values('shiprocket-sources','shiprocket-sources',false,104857600,array['application/gzip']) on conflict(id) do update set public=false;
create policy next_sources_read on storage.objects for select to authenticated using(bucket_id='shiprocket-sources');
create policy next_sources_insert on storage.objects for insert to authenticated with check(bucket_id='shiprocket-sources' and public.next_is_primary() and (storage.foldername(name))[1]=auth.uid()::text);
-- No browser delete: source archives are an immutable audit trail, including rows that failed mapping.

create function public.next_stage(p_import uuid,p_rows jsonb) returns void language plpgsql security definer set search_path='' as $$
begin
 if not public.next_is_primary() then raise exception 'Primary access required'; end if;
 perform 1 from public.next_imports where id=p_import and owner_id=auth.uid() and status='staging' for update;
 if not found then raise exception 'Import is not owned or is already finalized'; end if;
 if jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>300 then raise exception 'Expected at most 300 rows'; end if;
 insert into private.next_staging select p_import,x->>'shipment_key',x from jsonb_array_elements(p_rows) x
 on conflict(import_id,shipment_key) do update set payload=excluded.payload;
end $$;


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

-- One predicate for every KPI, drilldown, table, export and assistant response.
create function private.next_matches(s public.next_shipments,f jsonb) returns boolean language sql stable set search_path='' as $$
 select
 (coalesce(f->>'from','')='' or s.order_date >= ((f->>'from')::date::timestamp at time zone 'Asia/Kolkata')) and
 (coalesce(f->>'to','')='' or s.order_date < (((f->>'to')::date+1)::timestamp at time zone 'Asia/Kolkata')) and
 (coalesce(f->>'courier','')='' or s.courier=f->>'courier') and
 (coalesce(f->>'state','')='' or s.state=f->>'state') and
 (coalesce(f->>'customer','')='' or s.customer=f->>'customer') and
 (coalesce(f->>'status','')='' or s.status=f->>'status') and
 (not coalesce((f->>'exceptions')::boolean,false) or s.status in('Lost','Damaged','Undelivered') or (s.status not in('Delivered','RTO Delivered','Lost','Damaged') and (s.edd<now() or s.attempts>=2))) and
 (not coalesce((f->>'overdue')::boolean,false) or (s.status not in('Delivered','RTO Delivered','Lost','Damaged') and s.edd<now())) and
 (coalesce(f->>'q','')='' or strpos(lower(concat_ws(' ',s.awb,s.order_id,s.recipient,s.customer,s.courier,s.city,s.state,s.status)),lower(f->>'q'))>0) and
 (not(f ? 'ids') or s.awb in(select jsonb_array_elements_text(f->'ids')) or s.order_id in(select jsonb_array_elements_text(f->'ids')))
$$;
create function public.next_page(p_filter jsonb default '{}',p_after bigint default 0,p_limit integer default 50) returns jsonb language sql stable security invoker set search_path='' as $$
 select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]') from (select * from public.next_shipments s where s.id>p_after and private.next_matches(s,p_filter) order by s.id limit least(greatest(p_limit,1),1000)) s
$$;
create function public.next_summary(p_filter jsonb default '{}',p_dimension text default 'courier') returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
 if p_dimension not in('courier','state','city','customer','status','month','product','warehouse','payment') then raise exception 'Unsupported dimension'; end if;
 with scoped as materialized (select s.*,case when p_dimension='month' then coalesce(to_char(order_date at time zone 'Asia/Kolkata','YYYY-MM'),'Unknown') else coalesce(case p_dimension when 'courier' then s.courier when 'state' then s.state when 'city' then s.city when 'customer' then s.customer when 'status' then s.status when 'product' then s.product when 'warehouse' then s.warehouse when 'payment' then s.payment end,'Unknown') end as dimension from public.next_shipments s where private.next_matches(s,p_filter)),
 kpi as (select count(*) total,count(*) filter(where status='Delivered') delivered,count(*) filter(where status='RTO Delivered') rto,count(*) filter(where status not in('Delivered','RTO Delivered','Lost','Damaged')) open,
 count(*) filter(where status in('Lost','Damaged','Undelivered') or (status not in('Delivered','RTO Delivered','Lost','Damaged') and (edd<now() or attempts>=2))) exceptions,
 count(*) filter(where status='Delivered' and edd is not null and delivered_date is not null) sla_known,
 count(*) filter(where status='Delivered' and edd is not null and delivered_date is not null and (delivered_date at time zone 'Asia/Kolkata')::date<=(edd at time zone 'Asia/Kolkata')::date) on_time,
 sum(freight) freight,count(freight) freight_known,count(order_date) dates_known,
 avg(extract(epoch from(delivered_date-pickup_date))/86400) filter(where status='Delivered' and delivered_date>=pickup_date) avg_transit,
 max(updated_at) updated from scoped),
 groups as (select dimension,count(*) total,count(*) filter(where status='Delivered') delivered,count(*) filter(where status='RTO Delivered') rto,count(*) filter(where status not in('Delivered','RTO Delivered','Lost','Damaged')) open,sum(freight) freight from scoped group by dimension),
 outcomes as (select status,count(*) total from scoped group by status),
 months as (select to_char(order_date at time zone 'Asia/Kolkata','YYYY-MM') as "month",count(*) total from scoped where order_date is not null group by 1 order by 1 desc limit 10)
 select jsonb_build_object('kpi',(select to_jsonb(kpi) from kpi),'groups',(select coalesce(jsonb_agg(g),'[]') from(select * from groups order by total desc,dimension limit 100) g),
 'outcomes',(select coalesce(jsonb_agg(outcomes),'[]') from outcomes),'months',(select coalesce(jsonb_agg(months order by "month"),'[]') from months)) into result;
 return result;
end $$;
-- Queries use RLS as the caller; grant only the predicate needed by those queries.
grant usage on schema private to authenticated;
grant execute on function private.next_matches(public.next_shipments,jsonb) to authenticated;
revoke all on private.next_staging from public,anon,authenticated;
revoke all on function public.next_stage(uuid,jsonb),public.next_finalize(uuid),public.next_page(jsonb,bigint,integer),public.next_summary(jsonb,text) from public,anon;
grant execute on function public.next_stage(uuid,jsonb),public.next_finalize(uuid),public.next_page(jsonb,bigint,integer),public.next_summary(jsonb,text) to authenticated;

-- Called only by the Edge Function's service role, never by browser users.
create function public.next_apply_event(p_key text,p_awb text,p_status text,p_at timestamptz,p_payload jsonb,p_courier text default null) returns text language plpgsql security definer set search_path='' as $$
declare existing public.next_shipments; outcome text;
begin
 perform pg_advisory_xact_lock(918320);
 if exists(select 1 from public.next_events where event_key=p_key) then return 'duplicate'; end if;
 select * into existing from public.next_shipments where awb=p_awb for update;
 outcome=case when existing.id is null then 'inserted' when existing.status in('Delivered','RTO Delivered','Lost','Damaged') then 'terminal_ignored' when existing.status_at>=p_at then 'older_ignored' else 'updated' end;
 insert into public.next_events(event_key,awb,event_at,status,payload,outcome) values(p_key,p_awb,p_at,p_status,p_payload,outcome);
 if outcome='inserted' then
 insert into public.next_shipments(shipment_key,awb,status,status_at,courier) values('awb:'||p_awb,p_awb,p_status,p_at,p_courier);
 elsif outcome='updated' then
 update public.next_shipments set status=p_status,status_at=p_at,courier=coalesce(p_courier,courier),delivered_date=case when p_status='Delivered' then coalesce(delivered_date,p_at) else delivered_date end,updated_at=now() where id=existing.id;
 end if;
 return outcome;
end $$;
revoke all on function public.next_apply_event(text,text,text,timestamptz,jsonb,text) from public,anon,authenticated;
grant execute on function public.next_apply_event(text,text,text,timestamptz,jsonb,text) to service_role;
grant all on public.next_imports,public.next_shipments,public.next_events to service_role;
grant usage,select on all sequences in schema public to service_role;
commit;
