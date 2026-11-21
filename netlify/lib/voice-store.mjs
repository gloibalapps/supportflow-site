// Site-wide usage record for voice notes.
//
// Netlify Blobs is used because this is one small JSON document per licence,
// and Blobs is already part of a Netlify function deploy: no new database,
// no new API key, and no production migration. getStore (not getDeployStore)
// keeps the record across deploys, with strong consistency so two overlapping
// notes can't both read the same remaining minutes and write them back.
//
// Netlify Database would be the usual place for relational data, and Supabase
// already holds licences, but neither is needed for a single counter. A new
// Supabase table would mean a production migration. The document stores
// seconds and dates only. It never stores audio, a transcript, or a participant.

import { getStore } from "@netlify/blobs";

export const VOICE_STORE = "voice-notes-usage";

export function memoryUsageStore() {
  const map = new Map();
  return {
    async get(key) {
      const row = map.get(key);
      if (!row) return null;
      return { value: JSON.parse(JSON.stringify(row.value)), etag: row.etag };
    },
    async set(key, value, etag) {
      const row = map.get(key) || null;
      const current = row ? row.etag : null;
      if ((etag || null) !== current) {
        const err = new Error("conflict");
        err.code = "conflict";
        throw err;
      }
      map.set(key, {
        value: JSON.parse(JSON.stringify(value)),
        etag: String((Number(current) || 0) + 1),
      });
    },
  };
}

export function adaptBlobsStore(blobs) {
  return {
    async get(key) {
      const res = await blobs.getWithMetadata(key, { type: "json", consistency: "strong" });
      if (!res || res.data == null) return null;
      return { value: res.data, etag: res.etag || null };
    },
    async set(key, value, etag) {
      const options = etag ? { onlyIfMatch: etag } : { onlyIfNew: true };
      const result = await blobs.setJSON(key, value, options);
      if (!result || result.modified === false) {
        const err = new Error("conflict");
        err.code = "conflict";
        throw err;
      }
    },
  };
}

export function openUsageStore() {
  const blobs = getStore({ name: VOICE_STORE, consistency: "strong" });
  return adaptBlobsStore(blobs);
}

export async function updateUsage(store, key, fn) {
  let last = null;
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const cur = await store.get(key);
    const result = await fn(cur ? cur.value : null);
    last = result;
    if (!result.write) return result;
    try {
      await store.set(key, result.value, cur ? cur.etag : null);
      return result;
    } catch (e) {
      if (e && e.code === "conflict") continue;
      throw e;
    }
  }
  const err = new Error("conflict");
  err.code = "conflict";
  err.result = last;
  throw err;
}
