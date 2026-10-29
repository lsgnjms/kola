import { get, set } from "idb-keyval";
import type { KeyStorage } from "./keystore.js";

/** IndexedDB-backed storage (works on plain-http LAN testing, unlike WebCrypto). */
export const idbStorage: KeyStorage = {
  get: (key) => get<string>(key),
  set: (key, value) => set(key, value),
};
