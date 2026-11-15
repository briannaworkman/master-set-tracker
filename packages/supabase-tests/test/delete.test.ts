import { describe, expect, it, vi } from 'vitest';
import { asUser, createDb, createUser } from '../src/harness';
import { deleteAccount, type DeleteAccountAdmin } from '../../../supabase/functions/_shared/delete-account';

const T1 = '2026-11-16T10:00:00.001Z';

describe('deleting an auth user', () => {
  it('cascades to the profile, tracked sets and collection rows, leaving other users alone', async () => {
    const db = await createDb();
    const alice = await createUser(db, 'alice@example.com');
    const bob = await createUser(db, 'bob@example.com');
    for (const uid of [alice, bob]) {
      await asUser(db, uid, (tx) =>
        tx.query('select public.push_changes($1::jsonb, $2::jsonb)', [
          JSON.stringify([{ card_id: 'sv1-001', kind: 'normal', set_id: 'sv1', count: 2, updated_at: T1 }]),
          JSON.stringify([{ set_id: 'sv1', hidden_category_ids: [], added_at: T1, removed_at: null, updated_at: T1 }]),
        ]),
      );
    }
    const counts = async (uid: string) => {
      const r = await db.query<{ p: number; t: number; c: number }>(
        `select (select count(*) from public.profiles where user_id = $1)::int as p,
                (select count(*) from public.tracked_sets where user_id = $1)::int as t,
                (select count(*) from public.collection where user_id = $1)::int as c`,
        [uid],
      );
      return r.rows[0];
    };
    expect(await counts(alice)).toEqual({ p: 1, t: 1, c: 1 });

    await db.query('delete from auth.users where id = $1', [alice]);

    expect(await counts(alice)).toEqual({ p: 0, t: 0, c: 0 });
    expect(await counts(bob)).toEqual({ p: 1, t: 1, c: 1 });
  });
});

function fakeAdmin(opts: { user?: { id: string } | null; getUserError?: unknown; deleteError?: unknown; getUserThrows?: boolean } = {}) {
  const getUser = vi.fn(async (_jwt: string) => {
    if (opts.getUserThrows) throw new TypeError('fetch failed');
    if (opts.getUserError) return { data: { user: null }, error: opts.getUserError };
    return { data: { user: opts.user === undefined ? { id: 'user-a' } : opts.user }, error: null };
  });
  const deleteUser = vi.fn(async (_id: string) => ({ data: {}, error: opts.deleteError ?? null }));
  const admin: DeleteAccountAdmin = { auth: { getUser, admin: { deleteUser } } };
  return { admin, getUser, deleteUser };
}

describe('deleteAccount', () => {
  it("verifies the caller's JWT and deletes exactly that user", async () => {
    const { admin, getUser, deleteUser } = fakeAdmin({ user: { id: 'user-a' } });
    const r = await deleteAccount('Bearer jwt-of-a', admin);
    expect(getUser).toHaveBeenCalledWith('jwt-of-a');
    expect(deleteUser).toHaveBeenCalledWith('user-a');
    expect(deleteUser).toHaveBeenCalledTimes(1);
    expect(r).toEqual({ status: 200, body: { deleted: true } });
  });

  it.each([[null], [''], ['Bearer '], ['Basic abc']])('returns 401 without a bearer token (%j)', async (header) => {
    const { admin, getUser, deleteUser } = fakeAdmin();
    const r = await deleteAccount(header, admin);
    expect(r.status).toBe(401);
    expect(getUser).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });

  it('returns 401 when the token does not resolve to a user', async () => {
    for (const opts of [{ getUserError: { status: 401, message: 'invalid JWT' } }, { user: null }]) {
      const { admin, deleteUser } = fakeAdmin(opts);
      const r = await deleteAccount('Bearer bad', admin);
      expect(r.status).toBe(401);
      expect(deleteUser).not.toHaveBeenCalled();
    }
  });

  it('returns 500 when the auth service cannot be reached', async () => {
    const { admin, deleteUser } = fakeAdmin({ getUserThrows: true });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const r = await deleteAccount('Bearer jwt', admin);
    expect(r.status).toBe(500);
    expect(deleteUser).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it('returns 500 when the delete fails, logging neither the token nor the email', async () => {
    const { admin } = fakeAdmin({ deleteError: { status: 500, message: 'failed to delete a@example.com' } });
    const logs: unknown[] = [];
    const errors = vi.spyOn(console, 'error').mockImplementation((...a) => logs.push(...a));
    const info = vi.spyOn(console, 'log').mockImplementation((...a) => logs.push(...a));
    const r = await deleteAccount('Bearer secret-jwt', admin);
    expect(r.status).toBe(500);
    expect(JSON.stringify(r.body)).not.toContain('example.com');
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain('secret-jwt');
    expect(logged).not.toContain('example.com');
    errors.mockRestore();
    info.mockRestore();
  });
});
