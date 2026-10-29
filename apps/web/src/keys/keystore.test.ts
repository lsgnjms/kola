import { verifyEvent } from "nostr-tools/pure";
import { describe, expect, it } from "vitest";
import { Keystore, type KeyStorage } from "./keystore.js";

function memoryStorage(): KeyStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: async (k) => data.get(k),
    set: async (k, v) => {
      data.set(k, v);
    },
  };
}

// Low scrypt cost keeps tests fast; production uses SCRYPT_LOGN.
const LOGN = 8;
const template = { kind: 1, created_at: 1, tags: [], content: "" };

describe("Keystore", () => {
  it("creates a key, stores only the encrypted form, and signs", async () => {
    const storage = memoryStorage();
    const ks = new Keystore(storage, Date.now, LOGN);
    expect(await ks.status()).toBe("none");

    const pubkey = await ks.create("123456");
    expect(await ks.status()).toBe("unlocked");
    const stored = [...storage.data.values()].join(" ");
    expect(stored).toContain("ncryptsec1");
    expect(stored).not.toMatch(/nsec1/);

    const event = ks.sign(template);
    expect(event.pubkey).toBe(pubkey);
    expect(verifyEvent(event)).toBe(true);
  });

  it("locks, refuses to sign, and unlocks with the right PIN only", async () => {
    const storage = memoryStorage();
    const first = new Keystore(storage, Date.now, LOGN);
    const pubkey = await first.create("123456");
    first.lock();
    expect(() => first.sign(template)).toThrow(/locked/);

    // Fresh instance = app reload: key comes back from storage.
    const ks = new Keystore(storage, Date.now, LOGN);
    expect(await ks.status()).toBe("locked");
    expect(ks.pubkey).toBe(pubkey);
    expect(await ks.unlock("000000")).toEqual({ ok: false, retryAfterMs: 0 });
    expect(await ks.unlock("123456")).toEqual({ ok: true });
    expect(ks.sign(template).pubkey).toBe(pubkey);
  });

  it("makes the user wait after repeated wrong PINs, even across reloads", async () => {
    const storage = memoryStorage();
    let now = 1_000_000;
    const ks = new Keystore(storage, () => now, LOGN);
    await ks.create("123456");
    ks.lock();

    for (let i = 0; i < 4; i++) expect(await ks.unlock("000000")).toEqual({ ok: false, retryAfterMs: 0 });
    expect(await ks.unlock("000000")).toEqual({ ok: false, retryAfterMs: 30_000 });

    const reloaded = new Keystore(storage, () => now, LOGN);
    // Even the right PIN is refused while waiting.
    expect(await reloaded.unlock("123456")).toEqual({ ok: false, retryAfterMs: 30_000 });
    now += 30_000;
    expect(await reloaded.unlock("123456")).toEqual({ ok: true });
  });

  it("backs up and restores the same identity on another device", async () => {
    const phone1 = new Keystore(memoryStorage(), Date.now, LOGN);
    const pubkey = await phone1.create("123456");
    expect(await phone1.exportBackup("000000")).toEqual({ ok: false, retryAfterMs: 0 });
    const exported = await phone1.exportBackup("123456");
    if (!exported.ok) throw new Error("export failed");
    expect(exported.backup).toMatch(/^ncryptsec1/);

    const phone2 = new Keystore(memoryStorage(), Date.now, LOGN);
    expect(await phone2.restore(exported.backup, "654321")).toBe(false);
    expect(await phone2.restore("not a backup", "123456")).toBe(false);
    expect(await phone2.restore(`  ${exported.backup}\n`, "123456")).toBe(true);
    expect(phone2.pubkey).toBe(pubkey);
    expect(phone2.sign(template).pubkey).toBe(pubkey);
  });

  it("rejects PINs that aren't 6 digits", async () => {
    const ks = new Keystore(memoryStorage(), Date.now, LOGN);
    await expect(ks.create("1234")).rejects.toThrow();
    await expect(ks.create("12345a")).rejects.toThrow();
  });
});
