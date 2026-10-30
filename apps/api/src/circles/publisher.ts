import type { DatabaseSync } from "node:sqlite";
import { buildCircleEvent, CircleEvent, eventKey } from "@kola/shared";
import type { FastifyBaseLogger } from "fastify";
import { finalizeEvent, getPublicKey, type Event } from "nostr-tools/pure";

export interface EventPublisher {
  /**
   * Records a fact in the circle's public record. Idempotent per `eventKey`, so
   * the engine can re-announce after a crash. Never blocks on the relay: a relay
   * outage must not stop money moving.
   */
  publish(event: CircleEvent): Promise<void>;
}

export type RelaySend = (event: Event) => Promise<void>;

const FLUSH_INTERVAL_MS = 5000;

/**
 * Signs events with the coordinator's key into a durable outbox, then delivers
 * them to the relay, retrying until accepted. Never logs event contents:
 * settled events carry preimages.
 */
export class NostrPublisher implements EventPublisher {
  readonly coordinatorPubkey: string;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing = false;

  constructor(
    private readonly deps: {
      db: DatabaseSync;
      secretKey: Uint8Array;
      send: RelaySend;
      nowS: () => number;
      log: Pick<FastifyBaseLogger, "warn">;
    },
  ) {
    this.coordinatorPubkey = getPublicKey(deps.secretKey);
    deps.db.exec(`
      CREATE TABLE IF NOT EXISTS nostr_outbox (
        seq          INTEGER PRIMARY KEY AUTOINCREMENT,
        event_key    TEXT NOT NULL UNIQUE,
        event_json   TEXT NOT NULL,
        published_at INTEGER
      );
    `);
  }

  start(): void {
    this.timer = setInterval(() => void this.flush(), FLUSH_INTERVAL_MS);
    void this.flush();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async publish(event: CircleEvent): Promise<void> {
    const key = eventKey(event);
    if (this.has(key)) return;
    const parsed = CircleEvent.parse(event);
    const template = buildCircleEvent(parsed, {
      coordinatorPubkey: this.coordinatorPubkey,
      nowS: this.deps.nowS(),
    });
    this.enqueue(key, finalizeEvent(template, this.deps.secretKey));
  }

  /** Queues an event someone else signed (a member's join). Callers verify it first. */
  addSigned(key: string, event: Event): void {
    if (!this.has(key)) this.enqueue(key, event);
  }

  has(key: string): boolean {
    return this.deps.db.prepare("SELECT 1 FROM nostr_outbox WHERE event_key = ?").get(key) !== undefined;
  }

  /** Sends everything not yet accepted. One rejected event doesn't hold up the rest. */
  async flush(): Promise<void> {
    if (this.flushing) return;
    this.flushing = true;
    try {
      const rows = this.deps.db
        .prepare("SELECT seq, event_json FROM nostr_outbox WHERE published_at IS NULL ORDER BY seq")
        .all() as { seq: number; event_json: string }[];
      for (const row of rows) {
        try {
          await this.deps.send(JSON.parse(row.event_json) as Event);
          if (!this.timer) return; // Stopped meanwhile: the database may be closed.
          this.deps.db
            .prepare("UPDATE nostr_outbox SET published_at = ? WHERE seq = ?")
            .run(this.deps.nowS(), row.seq);
        } catch {
          this.deps.log.warn({ seq: row.seq }, "relay did not accept an event; will retry");
        }
      }
    } finally {
      this.flushing = false;
    }
  }

  private enqueue(key: string, event: Event): void {
    this.deps.db
      .prepare("INSERT OR IGNORE INTO nostr_outbox (event_key, event_json) VALUES (?, ?)")
      .run(key, JSON.stringify(event));
    if (this.timer) void this.flush();
  }
}
