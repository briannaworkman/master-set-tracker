-- Plan 3 / Task 2: daily USD price cache (TCGplayer marketPrice via TCGdex).
--
-- price_sets lists the sets the refresh-prices Edge Function fetches; card_prices holds the
-- latest price per (card, variant). Only the service role writes (it bypasses RLS and is
-- granted write privileges); authenticated users may read card_prices. Rows are never deleted
-- and a missing price is never stored as 0.
--
-- Hosted project: "Automatically expose new tables" is off, so every grant is explicit and
-- all API-role privileges are revoked first. RLS is enabled here.
--
-- Daily schedule (09:00 UTC): pg_cron calls the refresh-prices Edge Function through pg_net.
-- The extensions are created below where available (hosted Supabase has both; PGlite, used by
-- the tests, has neither, so it skips them). The schedule itself is created by a guarded DO block
-- that is a no-op (raise notice) unless pg_cron, pg_net and the Vault are present AND the Vault
-- holds both secrets. No secret or URL literal lives in this file.
--
-- The function's only gate is a dedicated random secret, REFRESH_PRICES_SECRET (not the
-- service-role key): pg_cron sends it as the bearer and the function compares it in constant
-- time. Owner steps, once per project, BEFORE `npx supabase db push` (Claude never sees the value):
--   1. Generate the secret:          openssl rand -hex 32
--   2. Give it to the function:      npx supabase secrets set REFRESH_PRICES_SECRET=<value>
--   3. In the dashboard SQL editor, store the same value and the function URL in the Vault:
--        select vault.create_secret('<same value>', 'refresh_prices_secret');
--        select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/refresh-prices', 'refresh_prices_url');
--   4. npx supabase db push (this migration then creates the schedule), then
--      npx supabase functions deploy refresh-prices
--      (config.toml sets verify_jwt = false: the function's own check is the only gate).
-- If the Vault secrets were created after this migration ran, create the schedule by hand in
-- the SQL editor (cron.schedule replaces a job with the same name):
--   select cron.schedule('refresh-prices-daily', '0 9 * * *', $cmd$
--     select net.http_post(
--       url := (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_prices_url'),
--       headers := jsonb_build_object('Content-Type', 'application/json',
--         'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_prices_secret')),
--       body := '{}'::jsonb, timeout_milliseconds := 120000) $cmd$);

create table public.price_sets (
  set_id text primary key,
  tcgdex_set_id text not null,
  enabled boolean not null default true
);

create table public.card_prices (
  card_id text,
  variant text,
  set_id text not null,
  usd numeric(10,2) not null check (usd >= 0),
  source_updated_at timestamptz,
  fetched_at timestamptz not null default now(),
  primary key (card_id, variant),
  constraint card_prices_variant_valid check (variant in ('normal', 'holofoil', 'reverse-holofoil'))
);

create index card_prices_set_id_idx on public.card_prices (set_id);

insert into public.price_sets (set_id, tcgdex_set_id) values ('sv03.5', 'sv03.5'), ('sv08.5', 'sv08.5');

alter table public.price_sets enable row level security;
alter table public.card_prices enable row level security;

revoke all on table public.price_sets, public.card_prices from anon, authenticated, service_role;

grant select on table public.card_prices to authenticated;
grant select on table public.price_sets to service_role;
grant select, insert, update on table public.card_prices to service_role;

-- (select auth.uid()) style per Supabase advisor: any signed-in user may read prices; no
-- insert/update/delete policies exist, so only the service role (bypasses RLS) can write.
create policy card_prices_select_authenticated on public.card_prices
  for select to authenticated using ((select auth.uid()) is not null);

-- ---------------------------------------------------------------------------
-- Daily schedule (guarded; see header)
-- ---------------------------------------------------------------------------

-- Extensions, only where the server has them (pg_available_extensions), so PGlite skips them.
-- The schemas match what Supabase itself uses (pg_cron in pg_catalog, pg_net in extensions).
do $extensions$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron with schema pg_catalog;
  else
    raise notice 'prices: pg_cron is not available; skipping it';
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    if exists (select 1 from pg_namespace where nspname = 'extensions') then
      create extension if not exists pg_net with schema extensions;
    else
      create extension if not exists pg_net;
    end if;
  else
    raise notice 'prices: pg_net is not available; skipping it';
  end if;
end
$extensions$;

do $schedule$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'prices: pg_cron/pg_net not installed; skipping refresh-prices schedule';
    return;
  end if;
  -- Separate block: planning the Vault query needs the relation to exist, so it must not share
  -- a statement with the extension check.
  if to_regclass('vault.decrypted_secrets') is null then
    raise notice 'prices: Vault not available; skipping refresh-prices schedule';
    return;
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'refresh_prices_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'refresh_prices_secret') then
    raise notice 'prices: Vault secrets refresh_prices_url / refresh_prices_secret missing; skipping refresh-prices schedule';
    return;
  end if;
  perform cron.schedule('refresh-prices-daily', '0 9 * * *', $cmd$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_prices_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_prices_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000)
  $cmd$);
end
$schedule$;
