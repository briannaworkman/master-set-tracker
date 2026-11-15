// Deno Edge Function: daily TCGdex price refresh. Invoked by pg_cron (see the prices
// migration) with the service-role bearer. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are
// provided by Supabase. Not type-checked or run by the Node workspace.
import { createClient } from 'npm:@supabase/supabase-js@2';
import { refreshSet, type PriceRow } from '../_shared/prices.ts';

const TCGDEX = 'https://api.tcgdex.net/v2/en';

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/** verify_jwt (the platform default) has already validated the signature; check the caller is the service role. */
function isServiceRole(req: Request, serviceKey: string): boolean {
  const token = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return false;
  if (token === serviceKey) return true;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/')));
    return payload?.role === 'service_role';
  } catch {
    return false;
  }
}

async function fetchJson(path: string): Promise<unknown> {
  const res = await fetch(`${TCGDEX}${path}`);
  if (!res.ok) throw new Error(`HTTP ${res.status} ${path}`);
  return res.json();
}

Deno.serve(async (req) => {
  const url = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !serviceKey) return json({ error: 'misconfigured' }, 500);
  if (!isServiceRole(req, serviceKey)) return json({ error: 'unauthorized' }, 401);

  const db = createClient(url, serviceKey, { auth: { persistSession: false } });
  const { data: sets, error } = await db.from('price_sets').select('set_id, tcgdex_set_id').eq('enabled', true);
  if (error) return json({ error: error.message }, 500);

  const summary: { setId: string; rows: number; failed: string[]; error?: string }[] = [];
  for (const s of sets ?? []) {
    try {
      const { rows, failedCards } = await refreshSet({ setId: s.set_id, tcgdexSetId: s.tcgdex_set_id, fetchJson });
      if (rows.length > 0) {
        const fetched_at = new Date().toISOString();
        const payload = rows.map((r: PriceRow) => ({ ...r, fetched_at }));
        const { error: upErr } = await db.from('card_prices').upsert(payload, { onConflict: 'card_id,variant' });
        if (upErr) throw new Error(upErr.message);
      }
      summary.push({ setId: s.set_id, rows: rows.length, failed: failedCards });
    } catch (e) {
      summary.push({ setId: s.set_id, rows: 0, failed: [], error: (e as Error).message });
    }
    console.log(JSON.stringify(summary[summary.length - 1]));
  }
  return json({ sets: summary }, summary.some((s) => s.error) ? 207 : 200);
});
