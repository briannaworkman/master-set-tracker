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

const chunkKey = (key: string, i: number) => `${key}.${i}`;
const countKey = (key: string) => `${key}.n`;

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

async function removeChunks(key: string): Promise<void> {
  const count = Number(await SecureStore.getItemAsync(countKey(key)));
  if (Number.isInteger(count) && count > 0) {
    for (let i = 0; i < count; i++) await SecureStore.deleteItemAsync(chunkKey(key, i));
  }
  await SecureStore.deleteItemAsync(countKey(key));
}

/** supabase-js storage adapter over expo-secure-store with transparent chunking. */
export const secureStorage = {
  async getItem(key: string): Promise<string | null> {
    try {
      const count = Number(await SecureStore.getItemAsync(countKey(key)));
      if (!Number.isInteger(count) || count <= 0) return SecureStore.getItemAsync(key);
      const parts: string[] = [];
      for (let i = 0; i < count; i++) {
        const part = await SecureStore.getItemAsync(chunkKey(key, i));
        if (part == null) return null;
        parts.push(part);
      }
      return parts.join('');
    } catch {
      return null;
    }
  },

  async setItem(key: string, value: string): Promise<void> {
    await removeChunks(key);
    if (utf8Bytes(value) <= CHUNK_BYTES) {
      await SecureStore.setItemAsync(key, value);
      return;
    }
    await SecureStore.deleteItemAsync(key);
    const chunks = splitUtf8(value, CHUNK_BYTES);
    for (let i = 0; i < chunks.length; i++) await SecureStore.setItemAsync(chunkKey(key, i), chunks[i] as string);
    await SecureStore.setItemAsync(countKey(key), String(chunks.length));
  },

  async removeItem(key: string): Promise<void> {
    await removeChunks(key);
    await SecureStore.deleteItemAsync(key);
  },
};
