import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface SourceCard {
  id: string;
  localId: string;
  name: string;
  rarity: string | null;
  imageUrl: string | null;
}

export interface SourceSet {
  id: string;
  name: string;
  releaseDate: string;
  series: string;
  logoUrl: string | null;
  totalCards: number;
  cardIds: string[];
}

export interface CardSource {
  getSet(id: string): Promise<SourceSet>;
  getCard(id: string): Promise<SourceCard>;
}

const DEFAULT_BASE_URL = 'https://api.tcgdex.net/v2/en';

interface RawSet {
  id: string;
  name: string;
  releaseDate: string;
  logo?: string;
  serie: { name: string };
  cardCount: { total: number };
  cards: { id: string }[];
}

interface RawCard {
  id: string;
  localId: string;
  name: string;
  image?: string;
  rarity?: string;
}

export function createTcgdexSource(opts: {
  fetch?: typeof fetch;
  cacheDir: string;
  baseUrl?: string;
}): CardSource {
  const doFetch = opts.fetch ?? globalThis.fetch;
  const baseUrl = (opts.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
  const { cacheDir } = opts;

  const cachePath = (path: string) =>
    join(cacheDir, `${path.replace(/^\/+/, '').replace(/[^A-Za-z0-9._-]/g, '_')}.json`);

  async function getJson<T>(path: string): Promise<T> {
    const file = cachePath(path);
    if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as T;

    const res = await doFetch(`${baseUrl}${path}`);
    if (res.status !== 200) throw new Error(`TCGdex ${res.status} for ${path}`);
    const body = await res.text();
    const data = JSON.parse(body) as T;

    mkdirSync(cacheDir, { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, body);
    renameSync(tmp, file);
    return data;
  }

  return {
    async getSet(id) {
      const raw = await getJson<RawSet>(`/sets/${id}`);
      return {
        id: raw.id,
        name: raw.name,
        releaseDate: raw.releaseDate,
        series: raw.serie.name,
        logoUrl: raw.logo ? `${raw.logo}.webp` : null,
        totalCards: raw.cardCount.total,
        cardIds: raw.cards.map((c) => c.id),
      };
    },
    async getCard(id) {
      const raw = await getJson<RawCard>(`/cards/${id}`);
      return {
        id: raw.id,
        localId: raw.localId,
        name: raw.name,
        rarity: raw.rarity ?? null,
        imageUrl: raw.image ? `${raw.image}/high.webp` : null,
      };
    },
  };
}
