# SHARV Logistics Control Tower

SHARV is a professional logistics analytics workspace for shipment monitoring, courier and SLA performance, exception management, reusable custom views, and conversational shipment investigation.

## What is included

- Professional, responsive control-tower UI with a compact operations sidebar
- Overview, Performance, Exceptions, Shipments, Insights & Suggestions, Custom Studio, and SHARV workspaces
- Multi-value shipment questions using AWBs and order IDs, including pasted comma/newline lists
- Customer/recipient searches and courier + city/state/customer SLA questions
- Current-scope filters that remain active across dashboards, SHARV, and downloads
- Three-dot export menus on every chart and table
- Per-table search filters; table menus export the exact computed view or its underlying raw rows
- Recurring Slack table delivery (daily, monthly, or yearly) through a secured Supabase Edge Function
- Complete raw, filtered raw, exact computed-table, summarized-chart-data, and PNG-chart downloads
- XLSX/XLS/CSV upload mapping for common ITL, Blitz, and normalized shipment headers
- User-owned saved view definitions that recalculate after new uploads
- Supabase password authentication, cloud shipment data, original-file storage, and row-level security
- Exactly two server-authoritative upload-admin slots; every other authenticated user is a viewer with download access

## Run the polished demo

The repository ships with blank cloud configuration and opens in a clearly labelled demo mode with realistic sample logistics data.

```bash
python3 -m http.server 4173
```

Open `http://localhost:4173`.

Useful SHARV demo queries:

- `Status of 12378495599, GS12374995`
- `What is Delhivery SLA in Pune for Aarav Retail?`
- `Show performance for Blue Mango`
- `Which state has the most SLA breaches?`
- `Compare all couriers by on-time delivery and RTO`

## Connect Supabase

1. Create a Supabase project.
2. In Supabase SQL Editor, run [`supabase/schema.sql`](supabase/schema.sql).
3. Then run [`supabase/base_raw_upload.sql`](supabase/base_raw_upload.sql). This adds restricted upload staging and an administrator-only transactional finalizer. Base Raw Data replacement is not enabled until this migration has been applied.
4. In Authentication settings, disable public sign-up. Invite the approved users manually.
5. At the bottom of `supabase/schema.sql`, replace the two example emails and run the two slot-assignment statements. Those two UUID-backed slots are the only identities that can upload or mutate shipment/SLA data.
6. Copy `config.example.js` to `config.js` and set the project URL and browser-safe publishable/anon key:

   ```js
   window.SHARV_CONFIG = {
     supabaseUrl: "https://YOUR_PROJECT.supabase.co",
     supabaseAnonKey: "YOUR_BROWSER_SAFE_PUBLISHABLE_OR_ANON_KEY"
   };
   ```

Never put a Supabase service-role key in browser code. The supplied row-level-security policies are the authorization boundary; hiding an upload button is not security.

### Enable scheduled Slack sharing

1. Create a Slack app/bot with `chat:write` and `files:write`, install it in your workspace, and invite it to each destination channel. Use channel IDs in SHARV.
2. Set `SLACK_BOT_TOKEN` and a long random `SHARV_CRON_SECRET` as Supabase Edge Function secrets. Keep both out of `config.js` and Git:

   ```sh
   supabase secrets set SLACK_BOT_TOKEN=xoxb-... SHARV_CRON_SECRET=... SUPABASE_URL=https://YOUR_PROJECT.supabase.co SUPABASE_SERVICE_ROLE_KEY=...
   supabase functions deploy share-scheduled-table
   ```

3. In Supabase Vault, store the project URL as `sharv_project_url` and the same cron secret as `sharv_cron_secret`. Then apply [`supabase/slack_share.sql`](supabase/slack_share.sql) in the SQL Editor. It adds owner-only schedule records and invokes the function once per minute to process due deliveries.
4. In a supported table’s three-dot menu, choose **Schedule Slack share**, enter the channel ID, frequency, start date, and time. The chosen timezone and current global/table filters are saved. The Edge Function rebuilds the computed table from the latest cloud dataset and shares it as a Slack table message or CSV attachment.

The Slack token stays server-side. The bot must be able to post to the selected channel. A first schedule will not send until its selected local date and time.

### Roles

- `upload_admin`: one of the two rows in `private.upload_admin_slots`; can upload/upsert shipment data and maintain SLA rules.
- `viewer`: any other authenticated user; can view, filter, ask SHARV, create private saved views, and download raw or computed data.

### Saved views

Custom Studio stores only a declarative view definition in `saved_views` (dimension, measure, display, filters, sort, and limit). It never stores a frozen result. Opening the view after a later upload recomputes it from the new authorized data.

## Accepted upload fields

SHARV recognizes common aliases for:

- AWB/tracking/waybill and order ID
- courier, customer account/merchant/brand, recipient/customer name and address
- product name, SKU, and quantity
- order, pickup, EDD, and delivered dates
- city, state, pincode, and warehouse
- status, NDR, RTO reason, attempts, ageing, freight, SLA target, payment, and transport mode
- courier status fields such as `Courier Status (Raw)` and normalized status fields such as `Status Group`; D2D/TAT fields such as `D2D (Days)`

Rows must contain an AWB or order ID. Long IDs and leading zeroes are preserved as text in exports.

Each workbook row is retained as a source line. Rows with the same normalized Order ID + mapped AWB are consolidated into one shipment before dashboard metrics and customer new/repeat classification are calculated. Raw exports flatten the retained source line items; computed tables export their exact summarized result. Choose **Base Raw Data** to stage a replacement and atomically swap the active dataset only after all staged rows validate. Other courier exports merge by source/AWB.

SLA compliance is not inferred from typical transit time. The source must provide an EDD or the workspace must have a matching active SLA rule. When neither exists, SHARV displays SLA as unavailable while still calculating delivery, RTO, attempts, and transit-time metrics.

## Files

- `index.html` — application shell and metadata
- `styles.css` — responsive visual system
- `app.js` — analytics, SHARV, uploads, exports, custom views, and Supabase client integration
- `config.js` — browser-safe environment configuration
- `supabase/schema.sql` — database, storage bucket, exactly-two-admin model, and RLS policies
- `supabase/base_raw_upload.sql` — locked staging + atomic Base Raw Data replacement RPCs
- `supabase/slack_share.sql` and `supabase/functions/share-scheduled-table/` — owner-scoped recurring Slack schedules and server-side table delivery
- `dist/` — static deployment output generated from the same files

## Security notes

- The raw-upload bucket is private. All authenticated users may download files; only the two upload admins may create objects.
- Shipment PII is intentionally downloadable by every authenticated viewer because that is the product requirement. Restrict the user list accordingly.
- Spreadsheet output neutralizes values beginning with `=`, `+`, `-`, or `@` to reduce formula-injection risk.
- For very large production datasets, move workbook validation and bulk normalization to a server-side ingestion job and stream exports rather than loading every row into a browser.
