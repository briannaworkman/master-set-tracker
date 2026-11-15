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
-- Daily schedule (09:00 UTC): created below by a guarded DO block. It is a no-op (raise
-- notice) unless the pg_cron and pg_net extensions are installed AND the Vault holds both
-- secrets. No key or URL literal lives in this file. Task 9 must, once per environment:
--   1. Enable the pg_cron and pg_net extensions (Dashboard > Database > Extensions).
--   2. Create the Vault secrets (SQL editor, as postgres):
--        select vault.create_secret('https://<project-ref>.supabase.co/functions/v1/refresh-prices', 'refresh_prices_url');
--        select vault.create_secret('<service role key>', 'service_role_key');
--   3. Deploy the function:  supabase functions deploy refresh-prices   (verify_jwt stays on).
--   4. Re-run the schedule block below (or just the cron.schedule call) now that the
--      prerequisites exist. To schedule manually:
--        select cron.schedule('refresh-prices-daily', '0 9 * * *', $cmd$
--          select net.http_post(
--            url := (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_prices_url'),
--            headers := jsonb_build_object('Content-Type', 'application/json',
--              'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
--            body := '{}'::jsonb) $cmd$);

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

do $schedule$
begin
  if not exists (select 1 from pg_extension where extname = 'pg_cron')
     or not exists (select 1 from pg_extension where extname = 'pg_net') then
    raise notice 'prices: pg_cron/pg_net not installed; skipping refresh-prices schedule';
    return;
  end if;
  if to_regclass('vault.decrypted_secrets') is null
     or not exists (select 1 from vault.decrypted_secrets where name = 'refresh_prices_url')
     or not exists (select 1 from vault.decrypted_secrets where name = 'service_role_key') then
    raise notice 'prices: Vault secrets refresh_prices_url / service_role_key missing; skipping refresh-prices schedule';
    return;
  end if;
  perform cron.schedule('refresh-prices-daily', '0 9 * * *', $cmd$
    select net.http_post(
      url := (select decrypted_secret from vault.decrypted_secrets where name = 'refresh_prices_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')),
      body := '{}'::jsonb)
  $cmd$);
end
$schedule$;
