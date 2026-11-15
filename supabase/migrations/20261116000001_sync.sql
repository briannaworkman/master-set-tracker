-- Plan 3 / Task 1: accounts, sync tables, RLS and push/pull RPCs.
--
-- Conflict rule: last-write-wins per row by client updated_at; on an exact tie the server row wins.
-- Pull cursor: server_seq from one global sequence, set by trigger on every insert/update.
-- Rows are never hard-deleted: count = 0 and tracked_sets.removed_at are the tombstones.
-- Timestamps are stored and exchanged at millisecond precision (enforced by CHECKs and by
-- push_changes, which accepts at most 3 fractional digits).
--
-- Cursor invariant: for any one user, server_seq order equals commit order. nextval() runs when
-- a row is written, not when it commits, so two concurrent transactions for the same user could
-- otherwise commit out of seq order (T1 takes 100, T2 takes 101 and commits first, a device pulls
-- to cursor 101, then T1 commits 100 and that device never sees it). set_server_seq() takes a
-- per-user transaction-scoped advisory lock before nextval(), held until commit/rollback, so a
-- second writer for the same user waits until the first has committed. Different users never
-- block each other (barring a hashtext collision, which only serializes, never reorders), and a
-- pull filters on one user, so per-user ordering is all the cursor needs.
--
-- The hosted project does not auto-expose new objects, so every grant is explicit here, and
-- every object first has all privileges revoked so the result is the same either way:
-- anon gets nothing; authenticated gets exactly what the app needs.

-- ---------------------------------------------------------------------------
-- Sequence + server_seq trigger
-- ---------------------------------------------------------------------------

create sequence public.sync_seq;
revoke all on sequence public.sync_seq from public, anon, authenticated, service_role;

-- security definer so callers need no privilege on the sequence; always overrides any
-- client-supplied server_seq. The advisory lock upholds the cursor invariant (see header): it
-- is held until the transaction ends, so per user, seq order equals commit order.
create function public.set_server_seq() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
begin
  perform pg_advisory_xact_lock(hashtext(new.user_id::text));
  new.server_seq := nextval('public.sync_seq');
  return new;
end;
$$;
revoke all on function public.set_server_seq() from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------

create table public.profiles (
  user_id uuid primary key references auth.users on delete cascade,
  display_name text,
  share_code text unique not null,
  created_at timestamptz default now()
);

create table public.tracked_sets (
  user_id uuid references auth.users on delete cascade,
  set_id text,
  hidden_category_ids jsonb not null default '[]',
  added_at timestamptz not null,
  removed_at timestamptz,
  updated_at timestamptz not null,
  server_seq bigint not null,
  primary key (user_id, set_id),
  constraint tracked_sets_hidden_is_array check (jsonb_typeof(hidden_category_ids) = 'array'),
  constraint tracked_sets_ms_precision check (
    added_at at time zone 'UTC' = date_trunc('milliseconds', added_at at time zone 'UTC')
    and updated_at at time zone 'UTC' = date_trunc('milliseconds', updated_at at time zone 'UTC')
    and (removed_at is null
         or removed_at at time zone 'UTC' = date_trunc('milliseconds', removed_at at time zone 'UTC')))
);

create table public.collection (
  user_id uuid references auth.users on delete cascade,
  card_id text,
  kind text,
  set_id text not null,
  count int not null check (count between 0 and 999),
  updated_at timestamptz not null,
  server_seq bigint not null,
  primary key (user_id, card_id, kind),
  constraint collection_ms_precision check (
    updated_at at time zone 'UTC' = date_trunc('milliseconds', updated_at at time zone 'UTC'))
);

create index tracked_sets_user_seq_idx on public.tracked_sets (user_id, server_seq);
create index collection_user_seq_idx on public.collection (user_id, server_seq);

create trigger tracked_sets_server_seq
  before insert or update on public.tracked_sets
  for each row execute function public.set_server_seq();

create trigger collection_server_seq
  before insert or update on public.collection
  for each row execute function public.set_server_seq();

-- ---------------------------------------------------------------------------
-- RLS + grants
-- ---------------------------------------------------------------------------

alter table public.profiles enable row level security;
alter table public.tracked_sets enable row level security;
alter table public.collection enable row level security;

revoke all on table public.profiles, public.tracked_sets, public.collection
  from anon, authenticated, service_role;

grant select on table public.profiles to authenticated;
grant select, insert, update on table public.tracked_sets, public.collection to authenticated;
grant select, insert, update, delete on table public.profiles, public.tracked_sets, public.collection
  to service_role;

-- (select auth.uid()) is evaluated once per statement instead of per row (Supabase advisor).
create policy profiles_select_own on public.profiles
  for select to authenticated using (user_id = (select auth.uid()));

create policy tracked_sets_select_own on public.tracked_sets
  for select to authenticated using (user_id = (select auth.uid()));
create policy tracked_sets_insert_own on public.tracked_sets
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy tracked_sets_update_own on public.tracked_sets
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy collection_select_own on public.collection
  for select to authenticated using (user_id = (select auth.uid()));
create policy collection_insert_own on public.collection
  for insert to authenticated with check (user_id = (select auth.uid()));
create policy collection_update_own on public.collection
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Profiles on signup
-- ---------------------------------------------------------------------------

-- 10 chars from [a-z0-9] without 0/o/1/l: 32 symbols, so (byte & 31) is unbiased.
-- Randomness comes from gen_random_uuid() (strong RNG, built in, no pgcrypto needed). UUID v4
-- bytes 6 and 8 carry version/variant bits, so only the other, fully random bytes are used.
create function public.generate_share_code() returns text
  language plpgsql
  volatile
  set search_path = ''
as $$
declare
  alphabet constant text := 'abcdefghijkmnpqrstuvwxyz23456789';
  bytes bytea := uuid_send(gen_random_uuid());
  idx int;
  code text := '';
begin
  foreach idx in array array[0, 1, 2, 3, 4, 5, 7, 9, 10, 11] loop
    code := code || substr(alphabet, (get_byte(bytes, idx) & 31) + 1, 1);
  end loop;
  return code;
end;
$$;
revoke all on function public.generate_share_code() from public, anon, authenticated, service_role;

create function public.handle_new_user() returns trigger
  language plpgsql
  security definer
  set search_path = ''
as $$
declare
  attempt int;
begin
  for attempt in 1..10 loop
    insert into public.profiles (user_id, share_code)
    values (new.id, public.generate_share_code())
    on conflict (share_code) do nothing;
    if found then
      return new;
    end if;
  end loop;
  raise exception 'could not generate a unique share code for user %', new.id;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated, service_role;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- push_changes
-- ---------------------------------------------------------------------------

-- Input is validated element by element before anything is written; the first problem raises
-- errcode 22023 (invalid_parameter_value) with a message naming the element and field, and the
-- whole call is rolled back. No helper functions: authenticated is granted execute on the two
-- RPCs only.
create function public.push_changes(p_collection jsonb, p_tracked jsonb) returns jsonb
  language plpgsql
  security invoker
  set search_path = public
as $$
declare
  uid uuid := auth.uid();
  e jsonb;
  i bigint;
  where_ text;
  f text;
  bad text;
  -- Explicit offset required, so no value depends on the session TimeZone; Postgres literals
  -- such as 'now' or 'yesterday' are rejected; at most millisecond precision (3 fractional
  -- digits), matching the table CHECKs. The cast below then checks ranges.
  iso constant text := '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}(:?\d{2})?)$';
  collection_applied int := 0;
  tracked_applied int := 0;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;

  p_collection := coalesce(p_collection, '[]'::jsonb);
  p_tracked := coalesce(p_tracked, '[]'::jsonb);
  if jsonb_typeof(p_collection) <> 'array' then
    raise exception 'p_collection must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_typeof(p_tracked) <> 'array' then
    raise exception 'p_tracked must be a JSON array' using errcode = '22023';
  end if;

  for e, i in select x.value, x.ord - 1
              from jsonb_array_elements(p_collection) with ordinality x(value, ord) loop
    where_ := format('p_collection[%s]', i);
    bad := null;
    if jsonb_typeof(e) <> 'object' then
      bad := ' must be an object';
    else
      foreach f in array array['card_id', 'kind', 'set_id'] loop
        if jsonb_typeof(e->f) is distinct from 'string' or e->>f = '' then
          bad := format('.%s must be a non-empty string', f);
          exit;
        end if;
      end loop;
      -- elsif branches run in order, so the numeric casts only see JSON numbers.
      if bad is not null then
        null;
      elsif jsonb_typeof(e->'count') is distinct from 'number' then
        bad := '.count must be an integer';
      elsif (e->>'count')::numeric <> trunc((e->>'count')::numeric) then
        bad := '.count must be an integer';
      elsif (e->>'count')::numeric not between 0 and 999 then
        bad := '.count must be between 0 and 999';
      elsif jsonb_typeof(e->'updated_at') is distinct from 'string'
            or e->>'updated_at' !~ iso then
        bad := '.updated_at must be an ISO-8601 timestamp string';
      end if;
    end if;
    if bad is null then
      begin
        perform (e->>'updated_at')::timestamptz;
      exception when others then
        bad := '.updated_at must be an ISO-8601 timestamp string';
      end;
    end if;
    if bad is not null then
      raise exception '%', where_ || bad using errcode = '22023';
    end if;
  end loop;

  for e, i in select x.value, x.ord - 1
              from jsonb_array_elements(p_tracked) with ordinality x(value, ord) loop
    where_ := format('p_tracked[%s]', i);
    bad := null;
    if jsonb_typeof(e) <> 'object' then
      bad := ' must be an object';
    elsif jsonb_typeof(e->'set_id') is distinct from 'string' or e->>'set_id' = '' then
      bad := '.set_id must be a non-empty string';
    elsif jsonb_typeof(e->'hidden_category_ids') is distinct from 'array' then
      bad := '.hidden_category_ids must be an array of strings';
    elsif exists (select 1 from jsonb_array_elements(e->'hidden_category_ids') h
                  where jsonb_typeof(h) <> 'string') then
      bad := '.hidden_category_ids must be an array of strings';
    else
      -- removed_at may be null (or absent, which means the same): the set is tracked.
      foreach f in array array['added_at', 'removed_at', 'updated_at'] loop
        continue when f = 'removed_at' and coalesce(jsonb_typeof(e->f), 'null') = 'null';
        if jsonb_typeof(e->f) = 'string' and e->>f ~ iso then
          begin
            perform (e->>f)::timestamptz;
            continue;
          exception when others then
            null; -- falls through to the error below
          end;
        end if;
        bad := format('.%s must be %san ISO-8601 timestamp string', f,
                      case when f = 'removed_at' then 'null or ' else '' end);
        exit;
      end loop;
    end if;
    if bad is not null then
      raise exception '%', where_ || bad using errcode = '22023';
    end if;
  end loop;

  -- Duplicate keys in one batch collapse to the newest element (ON CONFLICT can't touch a
  -- row twice in one statement). Strictly-newer only: an exact tie keeps the server row.
  insert into collection as c (user_id, card_id, kind, set_id, count, updated_at, server_seq)
  select distinct on (r.card_id, r.kind)
         uid, r.card_id, r.kind, r.set_id, r.count, r.updated_at, 0
  from jsonb_to_recordset(p_collection)
         as r(card_id text, kind text, set_id text, count int, updated_at timestamptz)
  order by r.card_id, r.kind, r.updated_at desc
  on conflict (user_id, card_id, kind) do update
    set set_id = excluded.set_id,
        count = excluded.count,
        updated_at = excluded.updated_at
    where excluded.updated_at > c.updated_at;
  get diagnostics collection_applied = row_count;

  insert into tracked_sets as t
    (user_id, set_id, hidden_category_ids, added_at, removed_at, updated_at, server_seq)
  select distinct on (r.set_id)
         uid, r.set_id, r.hidden_category_ids, r.added_at, r.removed_at, r.updated_at, 0
  from jsonb_to_recordset(p_tracked)
         as r(set_id text, hidden_category_ids jsonb, added_at timestamptz,
              removed_at timestamptz, updated_at timestamptz)
  order by r.set_id, r.updated_at desc
  on conflict (user_id, set_id) do update
    set hidden_category_ids = excluded.hidden_category_ids,
        added_at = excluded.added_at,
        removed_at = excluded.removed_at,
        updated_at = excluded.updated_at
    where excluded.updated_at > t.updated_at;
  get diagnostics tracked_applied = row_count;

  return jsonb_build_object('collection_applied', collection_applied,
                            'tracked_applied', tracked_applied);
end;
$$;

-- ---------------------------------------------------------------------------
-- pull_changes
-- ---------------------------------------------------------------------------

-- Timestamps are returned as ISO-8601 UTC with millisecond precision ("...T10:00:00.001Z"),
-- independent of the session TimeZone.
create function public.pull_changes(p_cursor bigint, p_limit int default 1000) returns jsonb
  language plpgsql
  stable
  security invoker
  set search_path = public
as $$
declare
  uid uuid := auth.uid();
  result jsonb;
begin
  if uid is null then
    raise exception 'not authenticated' using errcode = '28000';
  end if;
  if p_cursor is null or p_cursor < 0 then
    raise exception 'p_cursor must be >= 0' using errcode = '22023';
  end if;
  if p_limit is null or p_limit not between 1 and 1000 then
    raise exception 'p_limit must be between 1 and 1000' using errcode = '22023';
  end if;

  with candidates as (
    -- Each side is limited first so the (user_id, server_seq) indexes do the work; one extra
    -- row tells us whether there is more.
    (select 'c' as src, c.server_seq,
            jsonb_build_object('card_id', c.card_id, 'kind', c.kind, 'set_id', c.set_id,
                               'count', c.count, 'updated_at', to_char(c.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                               'server_seq', c.server_seq) as row
     from collection c
     where c.user_id = uid and c.server_seq > p_cursor
     order by c.server_seq
     limit p_limit + 1)
    union all
    (select 't', t.server_seq,
            jsonb_build_object('set_id', t.set_id, 'hidden_category_ids', t.hidden_category_ids,
                               'added_at', to_char(t.added_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                               'removed_at', to_char(t.removed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                               'updated_at', to_char(t.updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
                               'server_seq', t.server_seq)
     from tracked_sets t
     where t.user_id = uid and t.server_seq > p_cursor
     order by t.server_seq
     limit p_limit + 1)
  ),
  ranked as (
    select src, server_seq, row, row_number() over (order by server_seq) as n
    from candidates
  ),
  page as (
    select * from ranked where n <= p_limit
  )
  select jsonb_build_object(
    'collection', coalesce((select jsonb_agg(row order by server_seq) from page where src = 'c'), '[]'::jsonb),
    'tracked', coalesce((select jsonb_agg(row order by server_seq) from page where src = 't'), '[]'::jsonb),
    'next_cursor', coalesce((select max(server_seq) from page), p_cursor),
    'has_more', exists (select 1 from ranked where n > p_limit)
  ) into result;

  return result;
end;
$$;

revoke all on function public.push_changes(jsonb, jsonb) from public, anon, authenticated, service_role;
revoke all on function public.pull_changes(bigint, int) from public, anon, authenticated, service_role;
grant execute on function public.push_changes(jsonb, jsonb) to authenticated;
grant execute on function public.pull_changes(bigint, int) to authenticated;
