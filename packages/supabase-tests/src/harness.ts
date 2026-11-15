import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PGlite, type Transaction } from '@electric-sql/pglite';

/** Repo-root `supabase/migrations`, applied in filename order. */
export const MIGRATIONS_DIR = fileURLToPath(new URL('../../../supabase/migrations', import.meta.url));

/**
 * Minimal stand-in for what hosted Supabase provides before any project migration runs:
 * the API roles, the permissive default privileges in `public` (as on a project with
 * auto-expose on: the worst case for the migration's revokes), an `auth` schema with
 * `auth.users`, and `auth.uid()` reading the JWT `sub` claim the same way Supabase does.
 * The migrations themselves run unchanged on top of this.
 */
const SUPABASE_STUB = `
  create role anon nologin noinherit;
  create role authenticated nologin noinherit;
  create role service_role nologin noinherit bypassrls;
  grant usage on schema public to anon, authenticated, service_role;
  -- Hosted Supabase's default privileges for objects postgres creates in public. With these in
  -- place, anything the API roles can't do is down to the migration's own revokes.
  alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
  alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;

  create schema auth;
  grant usage on schema auth to anon, authenticated, service_role;
  create table auth.users (id uuid primary key, email text);
  create function auth.uid() returns uuid
    language sql stable
    as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
`;

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort()
    .map((f) => join(MIGRATIONS_DIR, f));
}

/** A fresh in-memory database with the Supabase stub and every project migration applied. */
export async function createDb(): Promise<PGlite> {
  const db = await PGlite.create();
  await db.exec(SUPABASE_STUB);
  for (const file of migrationFiles()) {
    try {
      await db.exec(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`migration ${file} failed: ${(e as Error).message}`);
    }
  }
  return db;
}

/** Inserts an `auth.users` row as the auth service would (fires signup triggers). */
export async function createUser(db: PGlite, email: string): Promise<string> {
  const r = await db.query<{ id: string }>(
    'insert into auth.users (id, email) values (gen_random_uuid(), $1) returning id',
    [email],
  );
  return r.rows[0]!.id;
}

async function asRole<T>(
  db: PGlite,
  role: 'anon' | 'authenticated' | 'service_role',
  sub: string,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    // `set local` / is_local=true: both revert when the transaction ends.
    await tx.exec(`set local role ${role}`);
    await tx.query(`select set_config('request.jwt.claim.sub', $1, true)`, [sub]);
    return fn(tx);
  });
}

/** Runs `fn` in a transaction as the `authenticated` role with the JWT `sub` = `userId`. */
export function asUser<T>(db: PGlite, userId: string, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return asRole(db, 'authenticated', userId, fn);
}

/** Runs `fn` in a transaction as the `anon` role (no user). */
export function asAnon<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return asRole(db, 'anon', '', fn);
}

/** Runs `fn` in a transaction as `service_role` (bypasses RLS, no user). */
export function asService<T>(db: PGlite, fn: (tx: Transaction) => Promise<T>): Promise<T> {
  return asRole(db, 'service_role', '', fn);
}
