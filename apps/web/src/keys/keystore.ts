import * as nip49 from "nostr-tools/nip49";
import { finalizeEvent, generateSecretKey, getPublicKey, type Event, type EventTemplate } from "nostr-tools/pure";

/**
 * The member's Nostr key, created on this device and stored only as a NIP-49
 * `ncryptsec` (scrypt + XChaCha20-Poly1305 via nostr-tools; no custom crypto).
 * The decrypted key lives in memory while unlocked and is wiped on lock.
 * The server never sees it.
 */

export interface KeyStorage {
  get(key: string): Promise<string | undefined>;
  set(key: string, value: string): Promise<void>;
}

/** scrypt cost 2^15 (32 MiB): ~1 s on a mid-range Android, ~0.2 s on a laptop. */
export const SCRYPT_LOGN = 15;
export const PIN_PATTERN = /^\d{6}$/;
/** Wrong PINs allowed before the UI starts making the user wait. */
const FREE_ATTEMPTS = 5;
const MAX_WAIT_MS = 15 * 60 * 1000;

const RECORD_KEY = "kola.key.v1";
const ATTEMPTS_KEY = "kola.key.attempts";

interface StoredKey {
  ncryptsec: string;
  pubkey: string;
}

interface Attempts {
  failures: number;
  lastFailureMs: number;
}

export type UnlockResult = { ok: true } | { ok: false; retryAfterMs: number };

export class Keystore {
  private secretKey: Uint8Array | null = null;
  private pubkeyHex: string | null = null;

  constructor(
    private readonly storage: KeyStorage,
    private readonly now: () => number = Date.now,
    private readonly logn: number = SCRYPT_LOGN,
  ) {}

  async status(): Promise<"none" | "locked" | "unlocked"> {
    if (this.secretKey) return "unlocked";
    return (await this.load()) ? "locked" : "none";
  }

  get pubkey(): string | null {
    return this.pubkeyHex;
  }

  /** Creates and stores a new key. Leaves the keystore unlocked. */
  async create(pin: string): Promise<string> {
    assertPin(pin);
    const secretKey = generateSecretKey();
    const pubkey = getPublicKey(secretKey);
    const stored: StoredKey = { ncryptsec: nip49.encrypt(secretKey, pin, this.logn), pubkey };
    await this.storage.set(RECORD_KEY, JSON.stringify(stored));
    await this.saveAttempts({ failures: 0, lastFailureMs: 0 });
    this.secretKey = secretKey;
    this.pubkeyHex = pubkey;
    return pubkey;
  }

  /** Waiting time before another PIN attempt is allowed (0 = now). */
  async retryAfterMs(): Promise<number> {
    const { failures, lastFailureMs } = await this.loadAttempts();
    if (failures < FREE_ATTEMPTS) return 0;
    const wait = Math.min(MAX_WAIT_MS, 30_000 * 2 ** (failures - FREE_ATTEMPTS));
    return Math.max(0, lastFailureMs + wait - this.now());
  }

  async unlock(pin: string): Promise<UnlockResult> {
    const waitMs = await this.retryAfterMs();
    if (waitMs > 0) return { ok: false, retryAfterMs: waitMs };
    const stored = await this.load();
    if (!stored) throw new Error("no key on this device");

    let secretKey: Uint8Array;
    try {
      secretKey = nip49.decrypt(stored.ncryptsec, pin);
    } catch {
      const attempts = await this.loadAttempts();
      await this.saveAttempts({ failures: attempts.failures + 1, lastFailureMs: this.now() });
      return { ok: false, retryAfterMs: await this.retryAfterMs() };
    }
    await this.saveAttempts({ failures: 0, lastFailureMs: 0 });
    this.secretKey = secretKey;
    this.pubkeyHex = stored.pubkey;
    return { ok: true };
  }

  /**
   * Restores a key from a backup code (NIP-49 `ncryptsec`) and its PIN.
   * Re-encrypts at this app's scrypt cost so unlocking stays fast on phones.
   * Returns false if the code or PIN is wrong.
   */
  async restore(backup: string, pin: string): Promise<boolean> {
    assertPin(pin);
    let secretKey: Uint8Array;
    try {
      secretKey = nip49.decrypt(backup.trim(), pin);
    } catch {
      return false;
    }
    const pubkey = getPublicKey(secretKey);
    const stored: StoredKey = { ncryptsec: nip49.encrypt(secretKey, pin, this.logn), pubkey };
    await this.storage.set(RECORD_KEY, JSON.stringify(stored));
    await this.saveAttempts({ failures: 0, lastFailureMs: 0 });
    this.secretKey = secretKey;
    this.pubkeyHex = pubkey;
    return true;
  }

  /**
   * The backup code, after re-checking the PIN (wrong PINs count toward the
   * wait-out, same as unlocking). The code is useless without the PIN.
   */
  async exportBackup(pin: string): Promise<{ ok: true; backup: string } | { ok: false; retryAfterMs: number }> {
    const waitMs = await this.retryAfterMs();
    if (waitMs > 0) return { ok: false, retryAfterMs: waitMs };
    const stored = await this.load();
    if (!stored) throw new Error("no key on this device");
    try {
      nip49.decrypt(stored.ncryptsec, pin).fill(0);
    } catch {
      const attempts = await this.loadAttempts();
      await this.saveAttempts({ failures: attempts.failures + 1, lastFailureMs: this.now() });
      return { ok: false, retryAfterMs: await this.retryAfterMs() };
    }
    return { ok: true, backup: stored.ncryptsec };
  }

  lock(): void {
    this.secretKey?.fill(0);
    this.secretKey = null;
  }

  /** Signs an event with the unlocked key. */
  sign(template: EventTemplate): Event {
    if (!this.secretKey) throw new Error("keystore is locked");
    return finalizeEvent(template, this.secretKey);
  }

  private async load(): Promise<StoredKey | null> {
    const raw = await this.storage.get(RECORD_KEY);
    if (!raw) return null;
    const stored = JSON.parse(raw) as StoredKey;
    this.pubkeyHex ??= stored.pubkey;
    return stored;
  }

  private async loadAttempts(): Promise<Attempts> {
    const raw = await this.storage.get(ATTEMPTS_KEY);
    return raw ? (JSON.parse(raw) as Attempts) : { failures: 0, lastFailureMs: 0 };
  }

  private async saveAttempts(attempts: Attempts): Promise<void> {
    await this.storage.set(ATTEMPTS_KEY, JSON.stringify(attempts));
  }
}

function assertPin(pin: string): void {
  if (!PIN_PATTERN.test(pin)) throw new Error("PIN must be 6 digits");
}
