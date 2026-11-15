import { beforeEach, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CardSource, SourceCard, SourceSet } from '../src/source/tcgdex.js';
import { runCli } from '../src/cli.js';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const fixture = fileURLToPath(new URL('./fixtures/rules/sv03.5.yaml', import.meta.url));

function fakeSource() {
  const cards = new Map<string, SourceCard>();
  const mk = (id: string, name: string, rarity: string | null) =>
    cards.set(id, { id, localId: id.split('-')[1]!, name, rarity, imageUrl: null });
  mk('sv03.5-001', 'Bulbasaur', 'Common');
  mk('sv03.5-002', 'Ivysaur', 'Uncommon');
  mk('sv03.5-003', 'Venusaur ex', null);
  let failing: string | null = null;
  let totalCards = 3;
  const source: CardSource & { addCard(id: string): void; failOn(id: string): void; setTotal(n: number): void } = {
    async getSet(id): Promise<SourceSet> {
      if (id !== 'sv03.5') throw new Error(`source failure for set ${id}`);
      return {
        id, name: '151', releaseDate: '2023-09-22', series: 'Scarlet & Violet',
        logoUrl: 'https://logo', totalCards, cardIds: [...cards.keys()],
      };
    },
    async getCard(id) {
      if (id === failing) throw new Error(`boom ${id}`);
      const c = cards.get(id);
      if (!c) throw new Error(`unknown card ${id}`);
      return c;
    },
    addCard(id) {
      mk(id, 'New card', 'Common');
      totalCards++;
    },
    failOn(id) { failing = id; },
    setTotal(n) { totalCards = n; },
  };
  return source;
}

let root: string;
let source: ReturnType<typeof fakeSource>;
let logs: string[];
let deps: { root: string; source: CardSource; log: (s: string) => void };

const p = (rel: string) => join(root, rel);
const exists = (rel: string) => existsSync(p(rel));
const read = (rel: string) => readFileSync(p(rel), 'utf8');
const json = (rel: string) => JSON.parse(read(rel));

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'mst-cli-'));
  mkdirSync(p('catalog/rules'), { recursive: true });
  cpSync(join(repo, 'catalog/version-kinds.yaml'), p('catalog/version-kinds.yaml'));
  cpSync(fixture, p('catalog/rules/sv03.5.yaml'));
  source = fakeSource();
  logs = [];
  deps = { root, source, log: (s) => logs.push(s) };
});

describe('runCli', () => {
  it('build writes dist and checklist but no lock for an unpublished set', async () => {
    expect(await runCli(['build', 'sv03.5'], deps)).toBe(0);
    expect(exists('catalog/dist/sets/sv03.5.json')).toBe(true);
    expect(exists('catalog/dist/checklists/sv03.5.csv')).toBe(true);
    expect(exists('catalog/locks/sv03.5.lock.json')).toBe(false);
    expect(json('catalog/dist/index.json').sets).toEqual([]);
    expect(logs.join('\n')).toMatch(/151: 3 cards, 9 versions \(Main set 3, Promos & stamped 0\)/);
  });

  it('publish writes the lock and lists the set in the index', async () => {
    expect(await runCli(['publish', 'sv03.5'], deps)).toBe(0);
    expect(json('catalog/locks/sv03.5.lock.json').catalogVersion).toBe(1);
    expect(json('catalog/dist/index.json').sets.map((s: { id: string }) => s.id)).toEqual(['sv03.5']);
    expect(json('catalog/dist/index.json').kinds).toHaveLength(6);
  });

  it('refuses to publish an already published set', async () => {
    await runCli(['publish', 'sv03.5'], deps);
    expect(await runCli(['publish', 'sv03.5'], deps)).toBe(1);
  });

  it('refuses to change a published set without --accept-changes', async () => {
    await runCli(['publish', 'sv03.5'], deps);
    const setBefore = read('catalog/dist/sets/sv03.5.json');
    const csvBefore = read('catalog/dist/checklists/sv03.5.csv');
    source.addCard('sv03.5-004');
    expect(await runCli(['build', 'sv03.5'], deps)).toBe(1);
    expect(logs.join('\n')).toMatch(/sv03\.5-004:normal/);
    expect(json('catalog/locks/sv03.5.lock.json').catalogVersion).toBe(1);
    expect(read('catalog/dist/sets/sv03.5.json')).toBe(setBefore);
    expect(read('catalog/dist/checklists/sv03.5.csv')).toBe(csvBefore);
  });

  it('accepts changes when asked and bumps the catalog version', async () => {
    await runCli(['publish', 'sv03.5'], deps);
    source.addCard('sv03.5-004');
    expect(await runCli(['build', 'sv03.5', '--accept-changes'], deps)).toBe(0);
    expect(json('catalog/locks/sv03.5.lock.json').catalogVersion).toBe(2);
    const dist = json('catalog/dist/sets/sv03.5.json');
    expect(dist.catalogVersion).toBe(2);
    const newCard = dist.cards.find((c: { id: string }) => c.id === 'sv03.5-004');
    const others = dist.cards.filter((c: { id: string }) => c.id !== 'sv03.5-004');
    const prevMax = Math.max(...others.flatMap((c: { versions: { position: number }[] }) => c.versions.map((v) => v.position)));
    expect(newCard.versions.map((v: { position: number }) => v.position)).toEqual([1, 2, 3, 4].map((n) => prevMax + n));
  });

  it('writes nothing when a later set in a multi-set build fails', async () => {
    await runCli(['publish', 'sv03.5'], deps);
    writeFileSync(p('catalog/rules/zz.yaml'), read('catalog/rules/sv03.5.yaml').replace('id: sv03.5', 'id: zz').replace('tcgdex: sv03.5', 'tcgdex: zz'));
    const files = ['catalog/dist/sets/sv03.5.json', 'catalog/dist/checklists/sv03.5.csv', 'catalog/locks/sv03.5.lock.json', 'catalog/dist/index.json'];
    const before = files.map(read);
    source.addCard('sv03.5-004');
    expect(await runCli(['build', '--all', '--accept-changes'], deps)).toBe(1);
    expect(files.map(read)).toEqual(before);
    expect(exists('catalog/dist/sets/zz.json')).toBe(false);
  });

  it('leaves previous dist files intact when the source fails mid-build', async () => {
    await runCli(['build', 'sv03.5'], deps);
    const before = read('catalog/dist/sets/sv03.5.json');
    source.failOn('sv03.5-002');
    expect(await runCli(['build', 'sv03.5'], deps)).toBe(1);
    expect(read('catalog/dist/sets/sv03.5.json')).toBe(before);
  });

  it('exits 1 naming an unknown set id', async () => {
    expect(await runCli(['build', 'nope'], deps)).toBe(1);
    expect(logs.join('\n')).toContain('nope');
  });

  it('build --all builds every rules file', async () => {
    expect(await runCli(['build', '--all'], deps)).toBe(0);
    expect(exists('catalog/dist/sets/sv03.5.json')).toBe(true);
  });

  it('rejects a lock whose setId differs', async () => {
    await runCli(['publish', 'sv03.5'], deps);
    const lock = json('catalog/locks/sv03.5.lock.json');
    writeFileSync(p('catalog/locks/sv03.5.lock.json'), JSON.stringify({ ...lock, setId: 'other' }));
    expect(await runCli(['build', 'sv03.5'], deps)).toBe(1);
    expect(logs.join('\n')).toMatch(/other/);
  });

  it('rejects a malformed lock, naming its path', async () => {
    await runCli(['publish', 'sv03.5'], deps);
    const lock = json('catalog/locks/sv03.5.lock.json');
    const [first, second] = Object.keys(lock.positions) as [string, string];
    lock.positions[second] = lock.positions[first];
    writeFileSync(p('catalog/locks/sv03.5.lock.json'), JSON.stringify(lock));
    expect(await runCli(['build', 'sv03.5'], deps)).toBe(1);
    expect(logs.join('\n')).toMatch(/sv03\.5\.lock\.json.*position \d+ is used by both/);
  });

  it('rejects a lock that is not valid JSON, naming its path', async () => {
    await runCli(['publish', 'sv03.5'], deps);
    writeFileSync(p('catalog/locks/sv03.5.lock.json'), '{ nope');
    expect(await runCli(['build', 'sv03.5'], deps)).toBe(1);
    expect(logs.join('\n')).toMatch(/sv03\.5\.lock\.json/);
  });

  it('warns when fetched card count differs from the source total', async () => {
    source.setTotal(5);
    expect(await runCli(['build', 'sv03.5'], deps)).toBe(0);
    expect(logs.join('\n')).toMatch(/warning/i);
  });

  it('exits 1 when a locked set has no dist JSON for the index', async () => {
    await runCli(['publish', 'sv03.5'], deps);
    // second set with a lock but never built
    cpSync(p('catalog/rules/sv03.5.yaml'), p('catalog/rules/zz.yaml'));
    writeFileSync(p('catalog/locks/zz.lock.json'), JSON.stringify({ setId: 'zz', catalogVersion: 1, positions: {}, retired: [] }));
    expect(await runCli(['build', 'sv03.5'], deps)).toBe(1);
    expect(logs.join('\n')).toContain('zz');
  });
});
