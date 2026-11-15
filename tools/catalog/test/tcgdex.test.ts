import { mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it } from 'vitest';
import { createTcgdexSource, type CardSource } from '../src/source/tcgdex.js';

const here = dirname(fileURLToPath(import.meta.url));
const fx = (name: string) => readFileSync(resolve(here, 'fixtures/tcgdex', name), 'utf8');

const routes: Record<string, string> = {
  '/sets/sv03.5': 'set-sv03.5.json',
  '/cards/sv03.5-001': 'card-sv03.5-001.json',
  '/cards/sv03.5-002': 'card-sv03.5-002.json',
  '/cards/sv03.5-003': 'card-sv03.5-003.json',
};

function makeFake() {
  const fake = (async (input: string | URL | Request) => {
    fake.calls++;
    const path = new URL(String(input)).pathname.replace(/^\/v2\/en/, '');
    const file = routes[path];
    if (!file) return new Response('not found', { status: 404 });
    return new Response(fx(file), { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch & { calls: number };
  fake.calls = 0;
  return fake;
}

describe('tcgdex source', () => {
  let cacheDir: string;
  let fake: ReturnType<typeof makeFake>;
  let src: CardSource;
  beforeEach(() => {
    cacheDir = mkdtempSync(join(tmpdir(), 'tcgdex-'));
    fake = makeFake();
    src = createTcgdexSource({ fetch: fake, cacheDir });
  });

  it('maps a set', async () => {
    const s = await src.getSet('sv03.5');
    expect(s).toMatchObject({ id: 'sv03.5', series: 'Scarlet & Violet', totalCards: 3, cardIds: ['sv03.5-001', 'sv03.5-002', 'sv03.5-003'] });
    expect(s.logoUrl).toBe('https://assets.tcgdex.net/en/sv/sv03.5/logo.webp');
  });
  it('maps a card and builds the high-res image url', async () =>
    expect((await src.getCard('sv03.5-001')).imageUrl).toBe('https://assets.tcgdex.net/en/sv/sv03.5/001/high.webp'));
  it('returns null image and rarity when missing', async () => {
    expect((await src.getCard('sv03.5-002')).imageUrl).toBeNull();
    expect((await src.getCard('sv03.5-003')).rarity).toBeNull();
  });
  it('serves repeat requests from the disk cache', async () => {
    await src.getCard('sv03.5-001');
    await createTcgdexSource({ fetch: fake, cacheDir }).getCard('sv03.5-001');
    expect(fake.calls).toBe(1);
  });
  it('throws on a non-200 and caches nothing', async () => {
    await expect(src.getCard('sv03.5-999')).rejects.toThrow(/TCGdex 404 for \/cards\/sv03\.5-999/);
    expect(readdirSync(cacheDir)).toHaveLength(0);
  });
  it('rejects and caches nothing when the body stream errors mid-read', async () => {
    const failing = (async () => {
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(new TextEncoder().encode('{"id":'));
          c.error(new Error('boom'));
        },
      });
      return new Response(stream, { status: 200 });
    }) as typeof fetch;
    const s = createTcgdexSource({ fetch: failing, cacheDir });
    await expect(s.getCard('sv03.5-001')).rejects.toThrow();
    expect(readdirSync(cacheDir)).toHaveLength(0);
  });
  it('rejects and caches nothing on a 200 with invalid JSON', async () => {
    const bad = (async () => new Response('<html>oops', { status: 200 })) as typeof fetch;
    const s = createTcgdexSource({ fetch: bad, cacheDir });
    await expect(s.getCard('sv03.5-001')).rejects.toThrow();
    expect(readdirSync(cacheDir)).toHaveLength(0);
  });
  it('handles concurrent requests for the same path', async () => {
    const [a, b] = await Promise.all([src.getCard('sv03.5-001'), src.getCard('sv03.5-001')]);
    expect(a).toEqual(b);
    expect(a.id).toBe('sv03.5-001');
    expect(readdirSync(cacheDir).filter((f) => f.endsWith('.tmp'))).toHaveLength(0);
  });
});
