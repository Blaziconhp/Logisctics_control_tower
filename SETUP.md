# SHARV Shiprocket workspace — setup and review

The redesigned dashboard is now the main application at the repository root. The previous implementation can be recovered from Git history. The new app uses a new Supabase schema in a **new project**, not the legacy database. Do not run its migration against the old project.

## Preview before configuration

From the repository root run `python3 -m http.server 4173`, then open `http://localhost:4173/?preview=1`.

This explicit localhost-only preview uses 192 synthetic September 2026 records and makes no cloud requests. It cannot upload actual data. `/` without the preview parameter shows a configuration/sign-in screen. There is no automatic public demo or private-data cache. No external fonts, analytics or AI services load.

## Minimal information needed after review

Browser configuration needs exactly:

1. The **new Supabase project URL** (`https://…supabase.co`).
2. The **new publishable key** (`sb_publishable_…`; a legacy anon key also works).

User setup also needs the two approved primary users' email addresses and the final frontend URL. Those are setup choices, not secrets. Never send or paste a service-role/secret key into the app or this chat.

## Configure the new project

1. Create a new Supabase project. Keep its database password private.
2. Run `supabase/schema.sql` once in its SQL Editor. This creates private archives, staged imports, events, views, RLS, analytics RPCs, and exactly two primary-user slots. The legacy SQL files are **not prerequisites**.
3. In Authentication → Providers → Email, disable public signup. In Authentication → Users, invite your two primary users and any approved viewers. Everyone with an account can view/download shipment and customer data. Do not create unapproved accounts.
4. After both primary accounts exist, replace the two addresses and run:

   ```sql
   do $$
   declare first_id uuid; second_id uuid;
   begin
     select id into first_id from auth.users where lower(email)=lower('PRIMARY_ONE_EMAIL');
     select id into second_id from auth.users where lower(email)=lower('PRIMARY_TWO_EMAIL');
     if first_id is null or second_id is null or first_id=second_id then
       raise exception 'Create two distinct approved accounts first';
     end if;
     update private.primary_users set user_id=first_id where slot=1;
     update private.primary_users set user_id=second_id where slot=2;
   end $$;
   ```

5. Set Authentication → URL Configuration → Site URL to `https://blaziconhp.github.io/Logisctics_control_tower/`. Add the recovery URL (`https://blaziconhp.github.io/Logisctics_control_tower/?recovery=1`, adjusted to the real host/path) to allowed Redirect URLs. For local testing add `http://localhost:4173/?recovery=1`. Configure production SMTP and test delivery before relying on recovery/invitations.
6. Set `config.js`:

   ```js
   window.SHARV_CONFIG = {
     supabaseUrl: "https://YOUR_NEW_PROJECT.supabase.co",
     supabasePublishableKey: "sb_publishable_YOUR_KEY"
   };
   ```

   These two browser values are public identifiers. RLS and restricted RPC privileges enforce authorization.
7. Run `npm run check` and `npm run build`. The built app is at `dist/`. Publish only after explicit approval. Serve over HTTPS; gzip compression, workers, secure random hashing, and authentication need modern browser support.
8. Verify with all three roles: signed-out requests cannot read any `next_*` table or source archive; viewers can read/download and manage only their own views; each of the two primary users can stage/finalize imports. A viewer invoking `next_stage`/`next_finalize` directly must fail. No browser role can directly change shipment status or event records.

## Tracking webhook (separate deployment)

The endpoint function is named `parcel-events` to avoid the provider's documented URL keyword restrictions. It is for JSON tracking updates only. Scheduled-report attachments/URLs are **not** accepted as tracking events.

1. Obtain a real tracking JSON payload and one scheduled-report webhook payload, with PII removed. Confirm AWB, status code/text, event timestamp/timezone, courier name, and how the report arrives. Test the mapping with these before enabling live deliveries.
2. Link the Supabase CLI to the **new** project. Set a randomly generated token of at least 32 characters as the Edge Function secret `PARCEL_WEBHOOK_TOKEN`. Keep it out of Git and frontend config.
3. Deploy with `supabase functions deploy parcel-events --no-verify-jwt`. JWT checking is intentionally disabled because Shiprocket uses `x-api-key`; the handler independently checks that header on every request. Supabase supplies its own URL and service-role key inside the function runtime.
4. In Shiprocket, configure POST to `https://PROJECT_REF.supabase.co/functions/v1/parcel-events` with `x-api-key` set to the same token. Ensure the complete endpoint follows the provider's restrictions. Never use the browser publishable key as the webhook token.
5. Accepted aliases: `awb` / `awb_code`; `shipment_status` / `current_status` / `shipment_status_id` (numeric shipment-status codes only; `current_status_id` belongs to a different namespace and is not interpreted as a shipment-status code); `current_timestamp` / `status_updated_at` / `timestamp`; `courier_name`. Timestamp supports ISO with timezone, ISO without timezone interpreted as India time, and `DD/MM/YYYY HH:mm[:ss]` or the documented `DD MM YYYY HH:mm:ss`. Unsupported/missing timestamps are rejected for correction rather than assigned arrival time.
6. Numeric terminal statuses 7, 10, 12, 25 map to Delivered, RTO Delivered, Lost, Damaged. Cancelled and Destroyed remain nonterminal. Duplicate semantic events return 200. Older/equal events and updates to terminal shipments are logged without changing the shipment. New AWBs create tracking-only records with missing fields left null. Report imports enrich them later. The receiver does not guess a merchant order from a provider order ID.
7. Test invalid token (401), malformed payload (400/422), repeated event (duplicate), newer update, out-of-order update, and all four terminal guards. Check events in shipment details. Failed persistence returns 500 to permit retries. Monitor function errors and provider retry behavior before production.

Scheduled reports should currently be downloaded and imported through the authenticated UI. Automatic report ingestion needs the real payload contract, a trusted attachment/download-host allowlist, and a separately deployed bounded ingestion job. It is intentionally not implemented by fetching arbitrary webhook URLs.

## Upgrade an already-configured dashboard

Do not rerun the fresh-install schema on an existing project. In the existing Supabase project's SQL Editor, run `supabase/migrations/20261026_report_v2.sql`, then refresh the dashboard and re-upload the original Shiprocket report as its original primary uploader. Confirm the preview reconciliation before importing. The same-file reprocess action repairs metadata even for terminal shipments, while terminal status remains protected. Original storage files and tracking events remain intact; replaced normalized records have private database snapshots.

## Data integrity and scale

- Original source bytes remain in immutable private gzip archives. Queryable records now include every product line, quantity and raw field, plus sheet/row references. This uses more database storage so raw custom views can work without repeatedly downloading archives.
- Exact valid AWBs group product rows; missing or scientific-notation AWBs use order ID. Rounded scientific values cannot recover original digits. They are flagged, retained in raw data, and never treated as a reliable tracking key. Use an original Shiprocket export with AWBs stored as text to repair tracking.
- Shiprocket Created At is the order date. Calendar comparisons use Asia/Kolkata. Indian day/month/year strings, including two-digit years interpreted as 20xx, and Excel serial dates are supported. Original date precision cannot be recovered if a spreadsheet resave removed seconds.
- On-time pickup means pickup date equals order date, among records with both dates. On-time delivery means delivered date is on/before EDD date, among delivered records with both dates. Missing evidence is excluded and denominators are displayed.
- Delivery SLA is elapsed delivery timestamp minus pickup timestamp in days. Negative/missing durations are excluded. P90/P95 use linear interpolation.
- In-transit metrics include picked-up forward shipments not delivered, cancelled, lost, damaged or in RTO. RTO includes RTO statuses and a recorded RTO initiation. Repeat customers have multiple distinct orders sharing an email or phone across imported history; missing identity is Unknown. These are not lifetime customer labels.
- FM pendency requires an actual pickup-first-attempt timestamp and no pickup timestamp. LM includes NDR and/or EDD breach among forward shipments only. Today equals EDD is not breached. Age is India calendar today minus EDD; buckets are 1, 2 and 3+. Risk is High for 3+ overdue days, 3+ attempts, or both NDR and breach; Mid for 2 days, 2 attempts, or NDR; Low otherwise.
- An absent RTO reason is shown as Not provided. Recorded NDR reasons are presented separately and are not relabelled as a known RTO cause.
- All current analytics, filters, exports and SHARV answers use the same calculation module. Authenticated records load in keyset pages of 1,000, then stay in session memory until Refresh/sign-out. The ledger renders 50 rows per page; large analysis tables show 500 with full-data export. This favors consistency for operational report datasets; at very large scale move the shared calculations into paged server queries and benchmark before promising capacity. There is no durable browser cache of private shipment records.
- Imports run in a worker with bounded 300-row staging calls. A 100 MB input cap is a file limit, not a guaranteed capacity. Concurrent changes during paged reads are not an audit snapshot. Refresh after imports or tracking updates.

## Current features

Multi-select Master Courier, state, city, status, warehouse, risk and reason filters; complete product ledger; computed/raw exports; FM, LM and RTO queues; destination, warehouse, customer, payment and zone performance; expandable courier services; per-user Custom view definitions for tables, bar/line/area/donut/dot charts using shipments, raw rows or queue modules.

SHARV supports exact ID/AWB lookup across all authorized records, including records outside active filters (explicitly labelled), named-entity comparisons, queue/reason queries and calculated SLA summaries. It remains a grounded local query assistant. No Gemini integration or external AI data transfer is enabled.

## Verification boundaries

Local checks cover pure mapping/date/status/export logic, syntax, build assets, worker parsing and browser interactions. The migration and role/transaction/event rules also execute in an isolated PostgreSQL engine with stub Auth/Storage schemas (`npm run check:db`). Actual Supabase RLS integration, storage API permissions, and the deployed Edge Function must still be tested on the new project after its URL/key and primary users are configured. No live database or real Shiprocket samples are bundled.

Webhook field/URL behavior was checked against [Shiprocket API documentation](https://apidocs.shiprocket.in/). The new app vendors SheetJS 0.20.3 from its [official distribution](https://docs.sheetjs.com/docs/getting-started/installation/standalone/) and loads it only when workbook operations need it.

## Configured connection

The browser configuration points to `https://rswhbhtcdjescofzjimk.supabase.co` using the owner-provided publishable key. This does not apply SQL, invite users, assign primary slots, or deploy the webhook. Complete the steps above in that project before using live shipment data.
