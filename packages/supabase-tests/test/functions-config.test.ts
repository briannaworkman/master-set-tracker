import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(fileURLToPath(new URL(`../../../supabase/${path}`, import.meta.url)), 'utf8');

/** The `key = value` lines of one `[section]` of config.toml (comments dropped). */
function section(toml: string, name: string): Record<string, string> {
  const body = toml.split(/^\[/m).find((s) => s.startsWith(`${name}]`)) ?? '';
  const out: Record<string, string> = {};
  for (const line of body.split('\n').slice(1)) {
    const m = /^\s*([\w-]+)\s*=\s*(.+?)\s*$/.exec(line.replace(/#.*$/, ''));
    if (m) out[m[1]!] = m[2]!;
  }
  return out;
}

describe('Edge Function config', () => {
  it('turns the gateway JWT check off for both functions (each verifies its caller itself)', () => {
    const toml = read('config.toml');
    expect(section(toml, 'functions.refresh-prices').verify_jwt).toBe('false');
    expect(section(toml, 'functions.delete-account').verify_jwt).toBe('false');
  });

  it('pins supabase-js to one exact version in both functions and the import map', () => {
    const specs = ['functions/refresh-prices/index.ts', 'functions/delete-account/index.ts', 'functions/deno.json'].flatMap(
      (f) => read(f).match(/npm:@supabase\/supabase-js@[^'"\s]*/g) ?? [],
    );
    expect(specs).toHaveLength(3);
    expect(new Set(specs)).toEqual(new Set(['npm:@supabase/supabase-js@2.119.0']));
  });

  it('refresh-prices is gated by REFRESH_PRICES_SECRET, not the service-role key', () => {
    const src = read('functions/refresh-prices/index.ts');
    expect(src).toContain("authorizeRefresh(req.headers.get('authorization'), Deno.env.get('REFRESH_PRICES_SECRET'))");
    expect(src).not.toContain('isServiceRole');
  });
});
