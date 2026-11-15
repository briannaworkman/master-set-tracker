import type { SupabaseClient } from '@supabase/supabase-js';
import { Alert, Platform } from 'react-native';
import { settleWithin, type SyncSession } from '../sync/SyncProvider';

export const SIGN_OUT_ERROR = "Couldn't sign out. Try again.";
export const DELETE_ERROR = "Couldn't delete your account. Check your connection and try again.";
export const DELETE_CONFIRM_TITLE = 'Delete your account?';
export const DELETE_CONFIRM_MESSAGE =
  "This permanently deletes your account and every mark you've saved, on all devices. This can't be undone.";

const APPLE_RELAY = /@privaterelay\.appleid\.com$/i;

/** The signed-in identity: the email, or "Signed in with Apple" for a hidden (relay) address. */
export function identityText(email: string | null, provider: string | null): string {
  if (email && !APPLE_RELAY.test(email)) return email;
  if (email || provider === 'apple') return 'Signed in with Apple';
  return 'Signed in';
}

/** How long sign-out waits for its final sync before checking what is still unsynced. */
export const SIGN_OUT_SYNC_TIMEOUT_MS = 15_000;

/** "<n> changes haven't synced yet and will be lost. Sign out anyway?" (singular for one). */
export function unsyncedWarning(n: number): string {
  return n === 1
    ? "1 change hasn't synced yet and will be lost. Sign out anyway?"
    : `${n} changes haven't synced yet and will be lost. Sign out anyway?`;
}

/** Shows `message` in a system alert: for errors the screen that started the flow can't show. */
export function showError(message: string): void {
  if (Platform.OS === 'web') {
    (globalThis as { alert?: (text: string) => void }).alert?.(message);
    return;
  }
  Alert.alert(message);
}

/** Asks with Cancel and a destructive `action` button; resolves true only for `action`. */
export function confirmDestructive(title: string, message: string | undefined, action: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    // react-native-web's Alert can't show buttons.
    const ask = (globalThis as { confirm?: (text: string) => boolean }).confirm;
    return Promise.resolve(ask ? ask(message ? `${title}\n\n${message}` : title) : false);
  }
  return new Promise((resolve) => {
    Alert.alert(
      title,
      message,
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: action, style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
}

type AuthClient = { auth: Pick<SupabaseClient['auth'], 'signOut' | 'getSession'> };

/**
 * True when the client no longer holds a session (this device is signed out). getSession reports
 * { session: null, error } when a refresh failed retryably but the session is still stored, so
 * only a null session with no error counts.
 */
async function sessionGone(client: AuthClient): Promise<boolean> {
  try {
    const { data, error } = await client.auth.getSession();
    return !error && data.session === null;
  } catch {
    return false;
  }
}

/**
 * Signs this device out with signOut({ scope: 'local' }): other devices signed in to the same
 * account stay signed in. auth-js removes the stored session first (firing SIGNED_OUT), then
 * revokes this device's refresh token on the server; it reports a failed revoke (e.g. offline)
 * as an error even though the device is already signed out, so an error with no session left
 * counts as success. Resolves false only if this device is still signed in.
 */
export async function endAuthSession(client: AuthClient): Promise<boolean> {
  try {
    const { error } = await client.auth.signOut({ scope: 'local' });
    if (!error) return true;
  } catch {
    // fall through to the session check
  }
  return sessionGone(client);
}

/** 'done', 'cancelled', or the error copy to show. */
export type FlowResult = 'done' | 'cancelled' | { error: string };

export interface FlowDeps {
  session: SyncSession;
  syncNow(): Promise<void>;
  confirm: typeof confirmDestructive;
}

/**
 * Sign out: sync (if online; at most SIGN_OUT_SYNC_TIMEOUT_MS) → if changes remain unsynced,
 * confirm → stop the engine → wipe local data → sign this device out (endAuthSession). A failed
 * wipe changes nothing (the session's engine is restarted) and returns the sign-out error. From
 * the wipe until the sign-out completes no app route is shown (SyncSession.endSession); if this
 * device is still signed in afterwards the session is restarted.
 */
export async function signOutFlow(client: AuthClient, { session, syncNow, confirm }: FlowDeps): Promise<FlowResult> {
  // The engine resolves at once while offline, and never rejects.
  await settleWithin(syncNow(), SIGN_OUT_SYNC_TIMEOUT_MS);
  const pending = session.pendingCount();
  if (pending > 0 && !(await confirm(unsyncedWarning(pending), undefined, 'Sign out'))) return 'cancelled';
  try {
    await session.endSession();
  } catch {
    return { error: SIGN_OUT_ERROR };
  }
  if ((await endAuthSession(client)) || !session.isSignedIn()) return 'done';
  // Still signed in on this device: bring the (now empty) session back so it pulls from the server.
  session.restart();
  return { error: SIGN_OUT_ERROR };
}

/**
 * Delete account: confirm → the delete-account Edge Function → stop → wipe → sign out locally
 * (the server session died with the account). If the function fails nothing changes and the
 * delete error is returned; if the local sign-out fails the session is restarted and the sign-out
 * error is returned.
 */
export async function deleteAccountFlow(
  client: Pick<SupabaseClient, 'auth' | 'functions'>,
  { session, confirm }: Omit<FlowDeps, 'syncNow'>,
): Promise<FlowResult> {
  if (!(await confirm(DELETE_CONFIRM_TITLE, DELETE_CONFIRM_MESSAGE, 'Delete account'))) return 'cancelled';
  try {
    const { error } = await client.functions.invoke('delete-account', { method: 'POST' });
    if (error) return { error: DELETE_ERROR };
  } catch {
    return { error: DELETE_ERROR };
  }
  try {
    await session.endSession();
  } catch {
    // The account is gone. Anything left locally is wiped by the next sign-in's owner check.
  }
  if ((await endAuthSession(client)) || !session.isSignedIn()) return 'done';
  // Still signed in on this device: reopen the app rather than leave it closed.
  session.restart();
  return { error: SIGN_OUT_ERROR };
}
