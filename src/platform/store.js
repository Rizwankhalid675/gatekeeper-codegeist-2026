/**
 * store.js — the Forge storage adapter.
 *
 * Thin on purpose. Everything that decides anything takes a `{ get, set }` and
 * does not know Forge exists, which is what lets the gate, the receipt chain and
 * the executor be tested without the Forge runtime.
 *
 * Uses @forge/kvs rather than the `storage` export from @forge/api, which
 * forge lint flags as deprecated. Because this adapter is the only place in the
 * app that touches storage at all, swapping the backing API is a four-line
 * change rather than a migration.
 */

import { kvs } from '@forge/kvs';

/** @type {import('../gate/receipts.js').Store} */
export const forgeStore = {
  async get(key) {
    return kvs.get(key);
  },
  async set(key, value) {
    await kvs.set(key, value);
  },
};

/**
 * Forge storage has no compare-and-swap, so this is the honest shape of what we
 * have: read, decide, write. Concurrent appends to one issue could collide.
 * See docs/LIMITS.md — the receipt chain detects the damage, it cannot prevent
 * it, and claiming otherwise would be the kind of unfalsifiable safety claim
 * this whole project is arguing against.
 */
export const STORAGE_HAS_CAS = false;
