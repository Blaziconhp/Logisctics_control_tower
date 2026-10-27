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
  await readFile(new URL("../supabase/schema.sql", import.meta.url), "utf8"),
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
// Upgrade an existing installation, including repeat execution, without changing users or source archives.
await db.exec(
  "reset role; alter table public.next_shipments drop column details",
);
const upgrade = await readFile(
  new URL("../supabase/migrations/20261026_report_v2.sql", import.meta.url),
  "utf8",
);
await db.exec(upgrade);
await db.exec(upgrade);
await setUser(viewer);
await fails(() => db.query("select public.next_reprocess($1,2,'{}')", [batch]));
await setUser(other);
await fails(() => db.query("select public.next_reprocess($1,2,'{}')", [batch]));
await setUser(primary);
await db.query("select public.next_reprocess($1,2,'{\"mapping_version\":2}')", [
  batch,
]);
const repaired = staged.map((r) => ({
  ...r,
  city: "Pune",
  details: {
    mapping_version: 2,
    master_courier: "Master",
    lines: [
      { product: "One", quantity: 2 },
      { product: "Two", quantity: 2 },
    ],
  },
  quantity: 4,
}));
// A stale report must enrich metadata while leaving the existing terminal status protected.
repaired[1].status = "In Transit";
await db.query("select public.next_stage($1,$2)", [
  batch,
  JSON.stringify(repaired),
]);
await db.query("select public.next_finalize($1)", [batch]);
const fixed = (
  await db.query("select * from public.next_shipments where awb='0002'")
).rows[0];
assert.equal(fixed.status, "Delivered");
assert.equal(fixed.city, "Pune");
assert.equal(fixed.details.lines.length, 2);
assert.equal(Number(fixed.quantity), 4);
assert.equal(
  (await db.query("select public.next_is_primary() p")).rows[0].p,
  true,
);
await db.exec("reset role");
assert(
  (await db.query("select count(*)::int n from private.next_import_snapshots"))
    .rows[0].n >= 2,
);
console.log(
  "PASS existing-database upgrade, safe rerun, owner-only reprocessing, terminal metadata repair, snapshots",
);
if (process.env.SHARV_REPORT) {
  const { runImport } = await import("./import-helper.mjs");
  const { readFileSync } = await import("node:fs");
  const report = await runImport(readFileSync(process.env.SHARV_REPORT));
  assert(!report.error, report.error);
  const p = primary + "/" + report.hash + ".gz";
  await db.query(
    "insert into storage.objects(bucket_id,name) values('shiprocket-sources',$1)",
    [p],
  );
  await setUser(primary);
  const id = (
    await db.query(
      "insert into public.next_imports(filename,object_path,sha256,original_bytes,compressed_bytes,source_rows,expected_shipments) values('private-local-test.csv',$1,$2,1,1,$3,$4) returning id",
      [p, report.hash, report.sourceRows, report.rows.length],
    )
  ).rows[0].id;
  await db.exec("reset role");
  const rounded = new Map(
    report.rows
      .filter((r) => r.details.awb_issue)
      .map((r) => [r.details.source_awb, r]),
  );
  for (const [awb, r] of rounded)
    await db.query(
      "insert into public.next_shipments(shipment_key,awb,order_id,import_id,status) values($1,$2,$3,$4,$5)",
      ["awb:" + awb, awb, r.order_id, batch, r.status],
    );
  await setUser(primary);
  for (let i = 0; i < report.rows.length; i += 300)
    await db.query("select public.next_stage($1,$2)", [
      id,
      JSON.stringify(report.rows.slice(i, i + 300)),
    ]);
  await db.query("select public.next_finalize($1)", [id]);
  const actual = (
    await db.query(
      "select count(*)::int total,count(distinct order_id)::int orders,sum(quantity)::int units,sum(jsonb_array_length(details->'lines'))::int lines from public.next_shipments where import_id=$1",
      [id],
    )
  ).rows[0];
  assert.deepEqual(actual, {
    total: 691,
    orders: 691,
    units: 1819,
    lines: 911,
  });
  assert.equal(
    (
      await db.query(
        "select count(*)::int n from public.next_shipments where awb ~* 'e[+]11'",
      )
    ).rows[0].n,
    0,
  );
  console.log(
    "PASS actual private report through PostgreSQL staging/finalize: 691 orders, 911 lines, 1819 units",
  );
}


await db.exec('reset role');
await db.exec(await readFile(new URL('../supabase/migrations/20261027_report_inbox.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../supabase/migrations/20261027_report_inbox.sql',import.meta.url),'utf8'));
await setUser(viewer);
await fails(()=>db.query('select public.report_pending(null)'));
await fails(()=>db.query('select public.report_import(null,null,1,1,1,\'[]\')'));
await setUser('', 'service_role');
const delivery=(await db.query("select public.capture_report_delivery($1,'application/json','e30=',2) id",['f'.repeat(64)])).rows[0].id;
const reportRow={shipment_key:'order:scheduled-test',order_id:'scheduled-test',status:'Delivered',quantity:4,details:{lines:[{product:'A',quantity:2},{product:'B',quantity:2}]}};
await fails(()=>db.query('select public.report_import($1,$2,100,50,2,$3)',[delivery,'e'.repeat(64),JSON.stringify([reportRow])]));
await db.exec('reset role');
await db.query("insert into storage.objects(bucket_id,name) values('shiprocket-sources',$1)",['reports/'+'e'.repeat(64)+'.gz']);
await setUser('', 'service_role');
await db.query('select public.report_import($1,$2,100,50,2,$3)',[delivery,'e'.repeat(64),JSON.stringify([reportRow])]);
const duplicate=(await db.query('select public.report_import($1,$2,100,50,2,$3) result',[delivery,'e'.repeat(64),JSON.stringify([reportRow])])).rows[0].result;
assert.equal(duplicate.already_completed,true);
assert.equal((await db.query('select public.report_pending($1) pending',[delivery])).rows[0].pending,null);
assert.equal(Number((await db.query("select quantity from public.next_shipments where order_id='scheduled-test'")).rows[0].quantity),4);
assert.equal((await db.query("select current_setting('request.jwt.claim.sub',true) id")).rows[0].id,'');
console.log('PASS scheduled report permissions, archive guard, finalization, duplicate handling and restored identity');

await db.close();
