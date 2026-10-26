process.on("uncaughtException", (err) => {
  console.error(
    "DATABASE TEST FAILED:",
    err.message,
    "position:",
    err.position,
    "detail:",
    err.detail,
  );
  process.exit(1);
});
// Isolated PostgreSQL engine. Supabase auth/storage schemas below are test stubs.
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
const { PGlite } = await import(
  process.env.PGLITE_MODULE || "@electric-sql/pglite"
);
const db = new PGlite();
await db.exec(`create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create schema storage;
create table auth.users(id uuid primary key,email text);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
grant usage on schema auth to authenticated;grant execute on function auth.uid() to authenticated;
create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text);
alter table storage.objects enable row level security;
create function storage.foldername(text) returns text[] language sql as $$ select string_to_array($1,'/') $$;`);
await db.exec(
  await readFile(
    new URL("../supabase/schema.sql", import.meta.url),
    "utf8",
  ),
);
console.log("PASS migration executes in PostgreSQL");
const primary = "11111111-1111-4111-8111-111111111111",
  viewer = "22222222-2222-4222-8222-222222222222",
  other = "33333333-3333-4333-8333-333333333333";
await db.query(
  `insert into auth.users values($1,'primary@example.test'),($2,'viewer@example.test'),($3,'other@example.test')`,
  [primary, viewer, other],
);
await db.query("update private.primary_users set user_id=$1 where slot=1", [
  primary,
]);
const setUser = async (id, role = "authenticated") => {
  await db.exec("reset role");
  await db.query(`select set_config('request.jwt.claim.sub',$1,false)`, [id]);
  await db.exec(`set role ${role}`);
};
const fails = async (fn) => {
  let failed = false;
  try {
    await fn();
  } catch {
    failed = true;
  }
  assert(failed, "Expected permission/validation failure");
};
await setUser("", "anon");
await fails(() => db.query("select * from public.next_shipments"));
await fails(() => db.query(`select public.next_summary('{}','courier')`));
await setUser(viewer);
assert.equal(
  (await db.query("select public.next_is_primary() primary")).rows[0].primary,
  false,
);
await fails(() => db.query(`select public.next_stage(gen_random_uuid(),'[]')`));
await fails(() =>
  db.query(
    `insert into public.next_shipments(shipment_key,awb) values('awb:X','X')`,
  ),
);
await db.query(
  `insert into public.next_views(name,definition) values('Mine','{}')`,
);
await setUser(other);
assert.equal(
  (await db.query("select count(*)::int n from public.next_views")).rows[0].n,
  0,
);
await fails(() =>
  db.query(
    `insert into public.next_views(owner_id,name,definition) values($1,'Stolen','{}')`,
    [viewer],
  ),
);
console.log(
  "PASS anonymous denied; viewer cannot mutate shipments/import; views owner-isolated",
);
await setUser(primary);
assert.equal(
  (await db.query("select public.next_is_primary() primary")).rows[0].primary,
  true,
);
const hash = "a".repeat(64),
  path = primary + "/" + hash + ".gz";
const batch = (
  await db.query(
    `insert into public.next_imports(filename,object_path,sha256,original_bytes,compressed_bytes,source_rows,expected_shipments) values('test.csv',$1,$2,100,50,2,2) returning id`,
    [path, hash],
  )
).rows[0].id;
const staged = [
  {
    shipment_key: "awb:0001",
    awb: "0001",
    order_id: "ORD1",
    status: "In Transit",
    courier: "Carrier",
    state: "Maharashtra",
    order_date: "2026-10-25T18:30:00Z",
    source_refs: [{ sheet: "Orders", row: 2 }],
  },
  {
    shipment_key: "awb:0002",
    awb: "0002",
    status: "Delivered",
    courier: "Carrier",
    order_date: "2026-10-26T18:29:00Z",
    edd: "2026-10-27T12:00:00Z",
    delivered_date: "2026-10-27T11:00:00Z",
  },
];
await db.query(`select public.next_stage($1,$2)`, [
  batch,
  JSON.stringify(staged.slice(0, 1)),
]);
await fails(() => db.query("select public.next_finalize($1)", [batch]));
assert.equal(
  (await db.query("select count(*)::int n from public.next_shipments")).rows[0]
    .n,
  0,
);
await db.query(`select public.next_stage($1,$2)`, [
  batch,
  JSON.stringify(staged),
]);
await db.exec("reset role");
await db.query(
  `insert into storage.objects(bucket_id,name) values('shiprocket-sources',$1)`,
  [path],
);
await setUser(primary);
await db.query("select public.next_finalize($1)", [batch]);
await db.query("select public.next_finalize($1)", [batch]);
assert.equal(
  (await db.query("select count(*)::int n from public.next_shipments")).rows[0]
    .n,
  2,
);
console.log(
  "PASS atomic count validation, idempotent staging/finalization, source archive guard",
);
let result = (
  await db.query(`select public.next_summary($1,'courier') s`, [
    JSON.stringify({ from: "2026-10-26", to: "2026-10-26" }),
  ])
).rows[0].s;
assert.equal(result.kpi.total, 2);
assert.equal(result.kpi.sla_known, 1);
assert.equal(result.kpi.on_time, 1);
assert.equal(result.groups[0].total, 2);
let pg = (await db.query(`select public.next_page('{}',0,1) p`)).rows[0].p;
assert.equal(pg.length, 1);
assert.equal(pg[0].awb, "0001");
let next = (await db.query(`select public.next_page('{}',$1,1) p`, [pg[0].id]))
  .rows[0].p;
assert.equal(next[0].awb, "0002");
console.log(
  "PASS exact India-day boundaries, KPI evidence denominators, keyset pagination",
);
await setUser(viewer);
await fails(() =>
  db.query(
    `select public.next_apply_event('bad','0001','Delivered',now(),'{}',null)`,
  ),
);
await db.exec("reset role");
async function event(key, awb, status, at) {
  return (
    await db.query(
      `select public.next_apply_event($1,$2,$3,$4,'{}',null) result`,
      [key, awb, status, at],
    )
  ).rows[0].result;
}
assert.equal(
  await event("e1", "0001", "Out For Delivery", "2026-10-26T12:00:00Z"),
  "updated",
);
assert.equal(
  await event("e1", "0001", "Out For Delivery", "2026-10-26T12:00:00Z"),
  "duplicate",
);
assert.equal(
  await event("e2", "0001", "In Transit", "2026-10-25T12:00:00Z"),
  "older_ignored",
);
for (const [i, status] of [
  "Delivered",
  "RTO Delivered",
  "Lost",
  "Damaged",
].entries()) {
  const awb = "terminal" + i;
  await event("new" + i, awb, status, "2026-10-26T12:00:00Z");
  assert.equal(
    await event("terminal" + i, awb, "In Transit", "2026-10-27T12:00:00Z"),
    "terminal_ignored",
  );
}
assert.equal(
  await event("cancel", "cancel", "Cancelled", "2026-10-26T12:00:00Z"),
  "inserted",
);
assert.equal(
  await event("cancel2", "cancel", "In Transit", "2026-10-27T12:00:00Z"),
  "updated",
);
console.log(
  "PASS event RPC restricted; deduplication, timestamp ordering, four terminal guards, Cancelled update",
);
await db.close();
