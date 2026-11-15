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

type AuthClient = Pick<SupabaseClient, 'auth'>;

/**
 * Ends the Supabase session. `global` first revokes the refresh token on the server; if that fails
 * (offline, server error) the session is still cleared on this device with scope 'local'.
 * Resolves false only if even the local sign-out failed.
 */
export async function endAuthSession(client: AuthClient, scope: 'global' | 'local'): Promise<boolean> {
  if (scope === 'global') {
    try {
      const { error } = await client.auth.signOut();
      if (!error) return true;
    } catch {
      // fall through to the local sign-out
    }
  }
  try {
    const { error } = await client.auth.signOut({ scope: 'local' });
    return !error;
  } catch {
    return false;
  }
}

export type FlowResult = 'done' | 'cancelled' | 'failed';

export interface FlowDeps {
  session: SyncSession;
  syncNow(): Promise<void>;
  confirm: typeof confirmDestructive;
}

/**
 * Sign out: sync (if online; at most SIGN_OUT_SYNC_TIMEOUT_MS) → if changes remain unsynced,
 * confirm → stop the engine → wipe local data → sign out. A failed wipe changes nothing (the
 * session's engine is restarted) and returns 'failed'. A failed server sign-out after the wipe
 * still signs out locally.
 */
export async function signOutFlow(client: AuthClient, { session, syncNow, confirm }: FlowDeps): Promise<FlowResult> {
  // The engine resolves at once while offline, and never rejects.
  await settleWithin(syncNow(), SIGN_OUT_SYNC_TIMEOUT_MS);
  const pending = session.pendingCount();
  if (pending > 0 && !(await confirm(unsyncedWarning(pending), undefined, 'Sign out'))) return 'cancelled';
  try {
    await session.endSession();
  } catch {
    return 'failed';
  }
  if (await endAuthSession(client, 'global')) return 'done';
  // Still signed in on this device: bring the (now empty) session back so it pulls from the server.
  session.restart();
  return 'failed';
}

/**
 * Delete account: confirm → the delete-account Edge Function → stop → wipe → sign out locally
 * (the server session died with the account). If the function fails nothing changes.
 */
export async function deleteAccountFlow(
  client: Pick<SupabaseClient, 'auth' | 'functions'>,
  { session, confirm }: Omit<FlowDeps, 'syncNow'>,
): Promise<FlowResult> {
  if (!(await confirm(DELETE_CONFIRM_TITLE, DELETE_CONFIRM_MESSAGE, 'Delete account'))) return 'cancelled';
  try {
    const { error } = await client.functions.invoke('delete-account', { method: 'POST' });
    if (error) return 'failed';
  } catch {
    return 'failed';
  }
  try {
    await session.endSession();
  } catch {
    // The account is gone. Anything left locally is wiped by the next sign-in's owner check.
  }
  await endAuthSession(client, 'local');
  return 'done';
}
