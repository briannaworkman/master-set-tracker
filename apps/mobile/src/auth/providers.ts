import type { SupabaseClient } from '@supabase/supabase-js';
import * as Crypto from 'expo-crypto';
import { Platform } from 'react-native';
import { backendConfig } from '../backend/config';

// Native sign-in modules are required lazily so web and Jest never load them unless asked.
type AppleModule = typeof import('expo-apple-authentication');
type GoogleModule = typeof import('@react-native-google-signin/google-signin');
export const loadApple = (): AppleModule => require('expo-apple-authentication');
const loadGoogle = (): GoogleModule => require('@react-native-google-signin/google-signin');

/** True when Google sign-in can be offered on this platform and build. */
export function googleAvailable(): boolean {
  return Platform.OS !== 'web' && Boolean(backendConfig.googleIosClientId || backendConfig.googleWebClientId);
}

function toHex(bytes: Uint8Array): string {
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Resolves quietly when the user cancels; throws on any other failure. */
export async function signInWithApple(client: SupabaseClient): Promise<void> {
  const Apple = loadApple();
  const raw = toHex(Crypto.getRandomBytes(32));
  const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, raw);
  let credential;
  try {
    credential = await Apple.signInAsync({
      nonce: hashed,
      requestedScopes: [Apple.AppleAuthenticationScope.FULL_NAME, Apple.AppleAuthenticationScope.EMAIL],
    });
  } catch (e) {
    if ((e as { code?: string })?.code === 'ERR_REQUEST_CANCELED') return;
    throw e;
  }
  if (!credential.identityToken) throw new Error('Apple returned no identity token');
  const { error } = await client.auth.signInWithIdToken({
    provider: 'apple',
    token: credential.identityToken,
    nonce: raw,
  });
  if (error) throw error;
}

let googleConfigured = false;

/** Resolves quietly when the user cancels; throws on any other failure. */
export async function signInWithGoogle(client: SupabaseClient): Promise<void> {
  const { GoogleSignin } = loadGoogle();
  if (!googleConfigured) {
    GoogleSignin.configure({
      iosClientId: backendConfig.googleIosClientId ?? undefined,
      webClientId: backendConfig.googleWebClientId ?? undefined,
    });
    googleConfigured = true;
  }
  let response;
  try {
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices();
    response = await GoogleSignin.signIn();
  } catch (e) {
    if ((e as { code?: string })?.code === 'SIGN_IN_CANCELLED') return;
    throw e;
  }
  if (response.type === 'cancelled') return;
  const idToken = response.data.idToken;
  if (!idToken) throw new Error('Google returned no ID token');
  const { error } = await client.auth.signInWithIdToken({ provider: 'google', token: idToken });
  if (error) throw error;
}

export async function sendEmailCode(client: SupabaseClient, email: string): Promise<void> {
  const { error } = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  if (error) throw error;
}

export async function verifyEmailCode(client: SupabaseClient, email: string, code: string): Promise<void> {
  const { error } = await client.auth.verifyOtp({ email, token: code, type: 'email' });
  if (error) throw error;
}
