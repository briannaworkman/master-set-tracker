import * as SecureStore from 'expo-secure-store';

/** Keychain/Keystore values are capped (~2 KB on some platforms), so larger values are split. */
const CHUNK_BYTES = 1800;

/** UTF-8 byte length without relying on Node's Buffer (absent in React Native). */
function utf8Bytes(s: string): number {
  let n = 0;
  for (const ch of s) {
    const c = ch.codePointAt(0) as number;
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c < 0x10000 ? 3 : 4;
  }
  return n;
}

/**
 * Chunked layout: the pointer `<key>.n` holds "<generation>:<count>" and the chunks live under
 * `<key>.<generation>.<i>`, the generation alternating between 'a' and 'b'. A write puts the new
 * chunks under the other generation, then flips the pointer (one Keychain write), then deletes
 * the old chunks, so a crash at any step leaves either the old or the new value readable. Values
 * up to CHUNK_BYTES live under the plain key while no pointer exists. An earlier layout stored a
 * bare count in `<key>.n` with chunks under `<key>.<i>` (generation null); it is still read and is
 * cleaned up by the next write.
 */
type Generation = 'a' | 'b' | null;
type Pointer = { gen: Generation; count: number };

const pointerKey = (key: string) => `${key}.n`;
const chunkKey = (key: string, gen: Generation, i: number) => (gen ? `${key}.${gen}.${i}` : `${key}.${i}`);

function parsePointer(raw: string | null): Pointer | null {
  if (raw == null) return null;
  const m = /^(?:([ab]):)?(\d+)$/.exec(raw);
  if (!m) return null;
  const count = Number(m[2]);
  return count > 0 ? { gen: (m[1] as 'a' | 'b' | undefined) ?? null, count } : null;
}

async function readPointer(key: string): Promise<Pointer | null> {
  return parsePointer(await SecureStore.getItemAsync(pointerKey(key)));
}

/** Deletes chunks `from`, `from + 1`, … of `gen` until one is missing (chunks are contiguous). */
async function deleteChunksFrom(key: string, gen: Generation, from: number): Promise<void> {
  for (let i = from; (await SecureStore.getItemAsync(chunkKey(key, gen, i))) != null; i++) {
    await SecureStore.deleteItemAsync(chunkKey(key, gen, i));
  }
}

/** Deletes the chunks `pointer` names, and any orphaned by a crashed write to the other generation. */
async function deleteChunks(key: string, pointer: Pointer | null): Promise<void> {
  if (!pointer) return;
  for (let i = 0; i < pointer.count; i++) await SecureStore.deleteItemAsync(chunkKey(key, pointer.gen, i));
  await deleteChunksFrom(key, pointer.gen === 'a' ? 'b' : 'a', 0);
}

/** Splits on code-point boundaries so every chunk is at most `max` UTF-8 bytes. */
function splitUtf8(value: string, max: number): string[] {
  const chunks: string[] = [];
  let current = '';
  let currentBytes = 0;
  for (const ch of value) {
    const b = utf8Bytes(ch);
    if (currentBytes + b > max) {
      chunks.push(current);
      current = '';
      currentBytes = 0;
    }
    current += ch;
    currentBytes += b;
  }
  if (current) chunks.push(current);
  return chunks;
}

/** supabase-js storage adapter over expo-secure-store with transparent, crash-safe chunking. */
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const pointer = await readPointer(key);
      if (!pointer) return await SecureStore.getItemAsync(key);
      const parts: string[] = [];
      for (let i = 0; i < pointer.count; i++) {
        const part = await SecureStore.getItemAsync(chunkKey(key, pointer.gen, i));
        if (part == null) return null;
        parts.push(part);
      }
      return parts.join('');
    } catch (e) {
      // Never log the value: only which key and what the Keychain said.
      console.warn(`secureStorage: could not read ${key}`, e instanceof Error ? e.message : String(e));
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    const old = await readPointer(key);
    if (utf8Bytes(value) <= CHUNK_BYTES) {
      // The plain key is only read once the pointer is gone, so the old value survives a crash
      // until the pointer delete below.
      await SecureStore.setItemAsync(key, value);
      if (old) {
        await SecureStore.deleteItemAsync(pointerKey(key));
        await deleteChunks(key, old);
      }
      return;
    }
    const gen: 'a' | 'b' = old?.gen === 'a' ? 'b' : 'a';
    const chunks = splitUtf8(value, CHUNK_BYTES);
    for (let i = 0; i < chunks.length; i++) await SecureStore.setItemAsync(chunkKey(key, gen, i), chunks[i] as string);
    // Leftovers of this generation from a write that crashed before its pointer flip.
    await deleteChunksFrom(key, gen, chunks.length);
    await SecureStore.setItemAsync(pointerKey(key), `${gen}:${chunks.length}`);
    await SecureStore.deleteItemAsync(key);
    if (old) for (let i = 0; i < old.count; i++) await SecureStore.deleteItemAsync(chunkKey(key, old.gen, i));
  },

  async removeItem(key: string): Promise<void> {
    const old = await readPointer(key);
    await SecureStore.deleteItemAsync(pointerKey(key));
    await SecureStore.deleteItemAsync(key);
    await deleteChunks(key, old);
  },
};
