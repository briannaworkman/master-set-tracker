// Pure logic for the delete-account Edge Function. No Deno or Node APIs, so both the Deno
// function and the vitest suite can import this file.

/** The slice of a service-role supabase-js client this needs (the real client fits it). */
export interface DeleteAccountAdmin {
  auth: {
    getUser(jwt: string): Promise<{ data: { user: { id: string } | null }; error: unknown }>;
    admin: {
      deleteUser(id: string): Promise<{ error: unknown }>;
    };
  };
}

export interface DeleteAccountResult {
  status: number;
  body: Record<string, unknown>;
}

/** Status code of a supabase-js error, if it has one. Never its message (it may hold an email). */
function statusOf(e: unknown): unknown {
  return typeof e === 'object' && e !== null ? (e as { status?: unknown }).status : undefined;
}

/**
 * Deletes the caller's own account. The bearer in `authorization` is verified with the
 * service-role client (`auth.getUser(jwt)`); only the user it resolves to is deleted, so a caller
 * can never delete anyone else. Their rows go with it via `on delete cascade`. 401 without a
 * valid user. Logs never include the token or the user's email.
 */
export async function deleteAccount(authorization: string | null, admin: DeleteAccountAdmin): Promise<DeleteAccountResult> {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '');
  const jwt = match?.[1];
  if (!jwt) return { status: 401, body: { error: 'unauthorized' } };

  let userId: string;
  try {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error || !data.user) return { status: 401, body: { error: 'unauthorized' } };
    userId = data.user.id;
  } catch {
    console.error('delete-account: could not verify the caller');
    return { status: 500, body: { error: 'unavailable' } };
  }

  try {
    const { error } = await admin.auth.admin.deleteUser(userId);
    if (error) {
      console.error('delete-account: deleteUser failed', { status: statusOf(error) });
      return { status: 500, body: { error: 'delete failed' } };
    }
  } catch {
    console.error('delete-account: deleteUser threw');
    return { status: 500, body: { error: 'delete failed' } };
  }
  return { status: 200, body: { deleted: true } };
}
