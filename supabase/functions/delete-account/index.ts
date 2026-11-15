// Deno Edge Function: deletes the calling user's account (and, by cascade, every row of theirs).
// Invoked by the app with the user's own JWT; the platform gateway verifies it (verify_jwt = true
// in supabase/config.toml) and the function verifies it again with the service-role client.
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase. Not type-checked or run
// by the Node workspace; the logic lives in ../_shared/delete-account.ts, which is tested.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { deleteAccount } from '../_shared/delete-account.ts';

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': 'authorization, x-client-info, apikey, content-type',
  'access-control-allow-methods': 'POST, OPTIONS',
};

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'content-type': 'application/json' } });
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'misconfigured' }, 500);

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const { status, body } = await deleteAccount(req.headers.get('authorization'), admin);
  return json(body, status);
});
