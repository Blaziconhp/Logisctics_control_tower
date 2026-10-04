-- SHARV recurring Slack table delivery.
-- Apply after schema.sql. Deploy the share-scheduled-table Edge Function and
-- add Supabase/Slack secrets before enabling the cron job below.

create table if not exists public.slack_share_schedules (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  table_key text not null check (char_length(table_key) between 1 and 80),
  channel_id text not null check (char_length(channel_id) between 1 and 120),
  frequency text not null check (frequency in ('daily', 'monthly', 'yearly')),
  schedule_time time not null,
  timezone text not null check (char_length(timezone) between 1 and 80),
  schedule_day smallint not null check (schedule_day between 1 and 31),
  schedule_month smallint not null check (schedule_month between 1 and 12),
  next_run_at timestamptz not null,
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  search_query text not null default '' check (char_length(search_query) <= 200),
  enabled boolean not null default true,
  last_sent_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists slack_share_schedules_due_idx
  on public.slack_share_schedules(next_run_at) where enabled;
create index if not exists slack_share_schedules_owner_idx
  on public.slack_share_schedules(owner_id, created_at desc);

alter table public.slack_share_schedules enable row level security;
revoke all on public.slack_share_schedules from public, anon;
grant select, insert, update, delete on public.slack_share_schedules to authenticated;

drop policy if exists slack_share_schedules_owner_all on public.slack_share_schedules;
create policy slack_share_schedules_owner_all on public.slack_share_schedules
  for all to authenticated
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());

-- Store these two values in Supabase Vault before scheduling the job. Do not
-- put service-role or Slack tokens in this SQL file or browser config.js.
-- select vault.create_secret('https://YOUR_PROJECT_REF.supabase.co', 'sharv_project_url');
-- select vault.create_secret('A_LONG_RANDOM_CRON_SECRET', 'sharv_cron_secret');
-- Set Edge Function secrets with the Supabase CLI:
-- supabase secrets set SLACK_BOT_TOKEN=xoxb-... SHARV_CRON_SECRET=... SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=...
-- Deploy:
-- supabase functions deploy share-scheduled-table

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

select cron.unschedule(jobid)
from cron.job
where jobname = 'sharv-slack-table-scheduler';

select cron.schedule(
  'sharv-slack-table-scheduler',
  '* * * * *',
  $$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'sharv_project_url') || '/functions/v1/share-scheduled-table',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-sharv-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'sharv_cron_secret')
      ),
      body := '{}'::jsonb
    );
  $$
);
