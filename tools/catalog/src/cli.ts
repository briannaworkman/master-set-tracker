import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { CatalogIndex, SetCatalog } from '@mst/catalog-core';
import { buildSet } from './build/build-set.js';
import { parseLock, type PositionLock } from './build/positions.js';
import { toChecklistCsv } from './checklist/csv.js';
import { writeFileAtomic } from './fs/atomic.js';
import { parseSetRules, parseVersionKinds } from './rules/schema.js';
import { createTcgdexSource, type CardSource } from './source/tcgdex.js';

export interface CliDeps {
  root: string;
  source: CardSource;
  log: (s: string) => void;
}

const USAGE = 'usage: catalog build <id...|--all> [--accept-changes] | catalog publish <id>';

const json = (v: unknown) => JSON.stringify(v, null, 2) + '\n';

async function listIds(dir: string, suffix: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  return (await readdir(dir)).filter((f) => f.endsWith(suffix)).map((f) => f.slice(0, -suffix.length)).sort();
}

async function readLock(path: string, setId: string): Promise<PositionLock | null> {
  if (!existsSync(path)) return null;
  let data: unknown;
  try {
    data = JSON.parse(await readFile(path, 'utf8'));
  } catch (err) {
    throw new Error(`invalid lock file ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
  const lock = parseLock(data, path);
  if (lock.setId !== setId) {
    throw new Error(`lock file ${path} is for set "${lock.setId}", not "${setId}"`);
  }
  return lock;
}

export async function runCli(argv: string[], deps: CliDeps): Promise<number> {
  const { root, source, log } = deps;
  const [command, ...rest] = argv;
  const flags = rest.filter((a) => a.startsWith('--'));
  const args = rest.filter((a) => !a.startsWith('--'));

  const catalogDir = join(root, 'catalog');
  const rulesPath = (id: string) => join(catalogDir, 'rules', `${id}.yaml`);
  const lockPath = (id: string) => join(catalogDir, 'locks', `${id}.lock.json`);
  const setPath = (id: string) => join(catalogDir, 'dist', 'sets', `${id}.json`);
  const csvPath = (id: string) => join(catalogDir, 'dist', 'checklists', `${id}.csv`);

  try {
    if (command !== 'build' && command !== 'publish') {
      log(USAGE);
      return 1;
    }
    const known = new Set<string>(['--all', '--accept-changes']);
    const unknown = flags.find((f) => !known.has(f));
    if (unknown) {
      log(`unknown option ${unknown}\n${USAGE}`);
      return 1;
    }
    const all = flags.includes('--all');
    const acceptChanges = flags.includes('--accept-changes');
    if (command === 'publish' && (all || acceptChanges || args.length !== 1)) {
      log(USAGE);
      return 1;
    }

    const ids = all ? await listIds(join(catalogDir, 'rules'), '.yaml') : args;
    if (ids.length === 0) {
      log(USAGE);
      return 1;
    }
    for (const id of ids) {
      if (!existsSync(rulesPath(id))) {
        log(`unknown set "${id}": no rules file at catalog/rules/${id}.yaml`);
        return 1;
      }
    }

    const kinds = parseVersionKinds(await readFile(join(catalogDir, 'version-kinds.yaml'), 'utf8'));
    interface Planned {
      id: string;
      catalog: SetCatalog;
      csv: string;
      lock: PositionLock | null;
      summary: string;
    }
    const planned: Planned[] = [];
    let failed = false;

    // Phase 1: build everything in memory and run every check. Nothing is written here.
    for (const id of ids) {
      try {
        const rules = parseSetRules(await readFile(rulesPath(id), 'utf8'), kinds);
        if (rules.id !== id) throw new Error(`rules file ${id}.yaml declares id "${rules.id}"`);
        const lock = await readLock(lockPath(id), id);
        if (command === 'publish' && lock) throw new Error(`set "${id}" is already published`);

        const result = await buildSet({ rules, source, lock });
        for (const w of result.warnings) log(`warning (${id}): ${w}`);

        if (lock && result.changed && !acceptChanges) {
          log(
            `${id} is published and its versions would change; pass --accept-changes to bump the catalog version.\n` +
              `  added: ${result.added.join(', ') || '(none)'}\n` +
              `  retired: ${result.retiredKeys.join(', ') || '(none)'}`,
          );
          failed = true;
          continue;
        }

        const perCategory = result.catalog.categories
          .map((c) => `${c.label} ${result.catalog.cards.filter((card) => card.categoryId === c.id).length}`)
          .join(', ');
        planned.push({
          id,
          catalog: result.catalog,
          csv: toChecklistCsv(result.catalog, kinds),
          lock: command === 'publish' || (lock && result.changed) ? result.lock : null,
          summary:
            `${result.catalog.name}: ${result.catalog.cards.length} cards, ` +
            `${result.catalog.versionCount} versions (${perCategory})`,
        });
      } catch (err) {
        log(`${id}: ${err instanceof Error ? err.message : String(err)}`);
        failed = true;
      }
    }

    // Index preconditions: every published set (existing or about to be) needs a dist JSON.
    const plannedById = new Map(planned.map((p) => [p.id, p]));
    const publishedIds = new Set(await listIds(join(catalogDir, 'locks'), '.lock.json'));
    for (const p of planned) if (p.lock) publishedIds.add(p.id);
    const indexSets: CatalogIndex['sets'] = [];
    for (const id of [...publishedIds].sort()) {
      let c = plannedById.get(id)?.catalog;
      if (!c) {
        if (!existsSync(setPath(id))) {
          log(`set "${id}" is published but ${setPath(id)} is missing; run build ${id}`);
          failed = true;
          continue;
        }
        c = JSON.parse(await readFile(setPath(id), 'utf8')) as SetCatalog;
      }
      indexSets.push({
        id: c.id, name: c.name, series: c.series, releaseDate: c.releaseDate,
        logoUrl: c.logoUrl, catalogVersion: c.catalogVersion, versionCount: c.versionCount,
      });
    }
    if (failed) return 1;

    // Phase 2: write. The lock is the authority, so it goes first; the index goes last.
    for (const p of planned) {
      if (p.lock) await writeFileAtomic(lockPath(p.id), json(p.lock));
      await writeFileAtomic(setPath(p.id), json(p.catalog));
      await writeFileAtomic(csvPath(p.id), p.csv);
      log(p.summary);
    }
    const index: CatalogIndex = { generatedAt: new Date().toISOString(), kinds, sets: indexSets };
    await writeFileAtomic(join(catalogDir, 'dist', 'index.json'), json(index));
    return 0;
  } catch (err) {
    log(err instanceof Error ? err.message : String(err));
    return 1;
  }
}

async function main(): Promise<void> {
  const root = resolve(fileURLToPath(new URL('../../..', import.meta.url)));
  const code = await runCli(process.argv.slice(2), {
    root,
    source: createTcgdexSource({ cacheDir: join(root, 'catalog/.cache') }),
    log: console.log,
  });
  process.exitCode = code;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  void main();
}
