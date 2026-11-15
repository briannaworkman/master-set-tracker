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

const UNAVAILABLE: DeleteAccountResult = { status: 503, body: { error: 'unavailable' } };

/**
 * A getUser error that says nothing about the token: no HTTP status (a network failure; supabase-js
 * reports those with status 0 or none) or a 5xx from the auth service.
 */
function isUnavailable(error: unknown): boolean {
  const status = statusOf(error);
  return typeof status !== 'number' || status === 0 || status >= 500;
}

/**
 * Deletes the caller's own account. The bearer in `authorization` is verified with the
 * service-role client (`auth.getUser(jwt)`); only the user it resolves to is deleted, so a caller
 * can never delete anyone else. Their rows go with it via `on delete cascade`. 401 without a
 * valid user (a 4xx from getUser, or no user); 503 when the auth service can't be reached or fails.
 * Logs never include the token or the user's email.
 */
export async function deleteAccount(authorization: string | null, admin: DeleteAccountAdmin): Promise<DeleteAccountResult> {
  const match = /^Bearer\s+(\S+)\s*$/i.exec(authorization ?? '');
  const jwt = match?.[1];
  if (!jwt) return { status: 401, body: { error: 'unauthorized' } };

  let userId: string;
  try {
    const { data, error } = await admin.auth.getUser(jwt);
    if (error) {
      if (isUnavailable(error)) {
        console.error('delete-account: could not verify the caller', { status: statusOf(error) });
        return UNAVAILABLE;
      }
      return { status: 401, body: { error: 'unauthorized' } };
    }
    if (!data.user) return { status: 401, body: { error: 'unauthorized' } };
    userId = data.user.id;
  } catch {
    console.error('delete-account: could not verify the caller');
    return UNAVAILABLE;
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
