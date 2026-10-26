# SHARV- Logistics Control tower

A private Shiprocket operations workspace with a navy-and-blue dashboard, server-side analytics, shipment drilldowns, an action queue, saved views, exports, and a floating SHARV assistant.

The redesigned application replaces the previous root application. Its entry point is `index.html`; `npm run build` produces the equivalent deployable `dist/` directory. The previous version is recoverable from Git history.

## Preview

Run `python3 -m http.server 4173` from this directory. Open `http://localhost:4173/?preview=1` for a working, explicitly labelled demo containing **192 shipments from September 2026 only**. Filters, daily volume, SLA metrics, carrier comparisons, shipment drilldowns, exports and SHARV all use this same dataset. Demo access is restricted to localhost and never substitutes for live authenticated data.

SHARV opens from the floating lower-right button, sidebar, top bar, or Ctrl/Cmd+K. It stays alongside the dashboard and preserves the conversation as views change. Answers are deterministic calculations from the selected authorized data scope.

## New Supabase project

`config.js` contains the supplied new project URL and browser-safe publishable key. This alone does not initialize the database or accounts.

Follow **[SETUP.md](SETUP.md)**:

1. Run **[supabase/schema.sql](supabase/schema.sql)** once in the new project's SQL Editor.
2. Disable public signup, invite approved users, and assign exactly two primary users with the documented UUID slot statements.
3. Configure the site/recovery URLs and test password recovery.
4. Separately deploy the token-protected `parcel-events` Edge Function to enable Shiprocket tracking updates.

The browser never uses a service-role key. Authenticated viewers can read/download data; only the two primary users can import. Saved views are private to their owner. Original report archives are private and byte-preserving.

## Data and performance

- Shiprocket all-orders CSV/XLS/XLSX import; worker parsing and compressed original storage.
- Retry-safe chunked staging with atomic merge; a report does not delete absent shipments.
- Server aggregates and 50-row keyset tables, with paged exports.
- Shared filters for analytics, drilldowns, downloads and assistant answers.
- Delivered, RTO Delivered, Lost and Damaged are terminal. Tracking events are deduplicated and checked for timestamp ordering.
- SLA evidence is explicit; missing dates/targets are never invented.

## Checks

```sh
npm ci
npm run check
npm run check:db
npm run build
```

Browser libraries are vendored; npm installs only the isolated PostgreSQL test dependency. Database tests use stub Auth/Storage schemas and do not replace live Supabase acceptance testing.

See [SETUP.md](SETUP.md) for webhook mapping, secret/deployment requirements, scale limits and the legacy optional features that are not integrated with the new schema. Scheduled report-webhook ingestion still needs a real sample payload and a separate adapter; manual all-orders imports are supported.
