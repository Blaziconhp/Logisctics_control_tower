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

## Data integrity and scale

- An exact SHA-256 fingerprint and gzip archive retain original bytes: every sheet, header, blank cell, row, raw column, and even unmapped rows. XLSX files are already compressed, so further gzip savings may be small; CSV usually compresses substantially. Nothing is silently trimmed to meet storage limits.
- Private storage holds the original once. PostgreSQL stores queryable normalized fields and sheet/row references, rather than repeating all raw source columns in each shipment JSON. Original files are immutable and remain accessible in import history; filtering/exporting source rows reconstructs the current matching shipment lines from those archives.
- The worker consolidates product lines by exact AWB, otherwise merchant order ID. All source-line references survive. Quantity sums across those lines; the current product/SKU label is the first line's label, so product-group comparisons are shipment-label comparisons, **not a complete SKU sales cube**. Original line details are available through raw export. Do not use this product comparison for complete product-unit reporting.
- Identifiers are treated as strings. If an original workbook already stored a long identifier as an imprecise Excel numeric value, the app cannot restore digits that Excel lost. Review the first five mapped records before import.
- Missing dates, states, SLA promises and customer identities remain missing. No dates default to upload time. No state is guessed from city. SLA uses delivered records with both EDD and delivered date; missing evidence is excluded and coverage is visible.
- Imports never replace the whole dataset or delete records absent in a report. SHA-256 detects exact duplicate files. Interrupted imports resume by selecting the same file; staging is idempotent and finalization checks the expected count and original archive before committing. A failed request never exposes a partially staged dataset.
- Reports without a status-event timestamp cannot overwrite a shipment with a known event timestamp. Terminal statuses are protected. Order-only report records are promoted to an AWB only when the incoming report maps the merchant order unambiguously to one AWB; do not conflate Shiprocket's internal order ID with a channel order ID.
- Startup downloads summaries rather than the whole dataset. Tables use 50-row keyset pages and exports read 1,000-record pages. Charts render at most ten months; comparisons at most 100 groups. The UI always labels these limits. Imports use a web worker and two concurrent 300-row staging chunks. Analytics stay in PostgreSQL and use one shared scope predicate.
- Browser workbook parsing and raw export still need memory proportional to the selected file/scope. There is a 100 MB input cap, not a claim of unlimited throughput. At multi-million-row scale, use a durable server ingestion/export job and benchmark query plans with representative data before claiming a production capacity. Source retention uses ongoing storage; agree a retention policy before adding deletion.
- Query pagination is live, not a frozen historical snapshot. Concurrent imports/events can change matching records during a long export. For audit-grade frozen exports, deploy a snapshot export job.

## Preserved and changed capabilities

Preserved: password auth/recovery/sign-out, two primary users, viewer downloads, courier/state/status/customer/date filtering, exact ID/search lookups, ledger details, action queue, carrier/destination/account comparisons, monthly volume, normalized and raw exports, source-file downloads, per-user saved definitions, grounded rule-based SHARV answers.

Changed: old courier feed choices removed; only Shiprocket reports enter this implementation. Carriers (Delhivery, Blue Dart, etc.) are still useful shipment dimensions. SHARV is a deterministic query assistant; no AI secret is required. Unsupported questions receive a clear limitation.

Legacy optional features are not wired to the new schema: scheduled Slack delivery, custom pivot/chart builder, customer repeat-identity inference, SLA rule administration, PNG chart export, and WebMCP. The legacy app is available in Git history. Slack needs a new adapter for the new schema plus a Slack bot token, cron secret, Vault/cron deployment, and acceptance tests; do not run the legacy Slack worker against `next_*` data. No automatic Slack messages are enabled.

## Verification boundaries

Local checks cover pure mapping/date/status/export logic, syntax, build assets, worker parsing and browser interactions. The migration and role/transaction/event rules also execute in an isolated PostgreSQL engine with stub Auth/Storage schemas (`npm run check:db`). Actual Supabase RLS integration, storage API permissions, and the deployed Edge Function must still be tested on the new project after its URL/key and primary users are configured. No live database or real Shiprocket samples are bundled.

Webhook field/URL behavior was checked against [Shiprocket API documentation](https://apidocs.shiprocket.in/). The new app vendors SheetJS 0.20.3 from its [official distribution](https://docs.sheetjs.com/docs/getting-started/installation/standalone/) and loads it only when workbook operations need it.

## Configured connection

The browser configuration points to `https://rswhbhtcdjescofzjimk.supabase.co` using the owner-provided publishable key. This does not apply SQL, invite users, assign primary slots, or deploy the webhook. Complete the steps above in that project before using live shipment data.
