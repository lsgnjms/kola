import type { DatabaseSync } from "node:sqlite";
import type { CycleState, HoldInvoiceState } from "@kola/shared";

export type CircleStatus = "forming" | "active" | "completed";

export interface CircleRow {
  id: string;
  name: string;
  contributionSat: number;
  memberCount: number;
  periodSeconds: number;
  creatorPubkey: string;
  joinCode: string;
  status: CircleStatus;
  createdAtMs: number;
}

export interface MemberRow {
  pubkey: string;
  position: number;
  nickname: string;
}

export interface CycleKey {
  circleId: string;
  cycleIndex: number;
  attempt: number;
}

export interface CycleRow extends CycleKey {
  state: CycleState;
  recipientPubkey: string;
  deadlineMs: number;
  openedAtMs: number;
  payoutRequest: string | null;
  payoutHash: string | null;
  payoutAttempts: number;
  nextRetryMs: number | null;
}

export interface ContributionRow extends CycleKey {
  memberPubkey: string;
  paymentHash: string;
  paymentRequest: string;
  state: HoldInvoiceState;
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS circles (
    id               TEXT PRIMARY KEY,
    name             TEXT NOT NULL,
    contribution_sat INTEGER NOT NULL,
    member_count     INTEGER NOT NULL,
    period_seconds   INTEGER NOT NULL,
    creator_pubkey   TEXT NOT NULL,
    join_code        TEXT NOT NULL UNIQUE,
    status           TEXT NOT NULL,
    created_at       INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS circle_members (
    circle_id  TEXT NOT NULL REFERENCES circles(id),
    pubkey     TEXT NOT NULL,
    position   INTEGER NOT NULL,
    nickname   TEXT NOT NULL,
    joined_at  INTEGER NOT NULL,
    PRIMARY KEY (circle_id, pubkey),
    UNIQUE (circle_id, position)
  );
  CREATE TABLE IF NOT EXISTS cycles (
    circle_id        TEXT NOT NULL REFERENCES circles(id),
    cycle_index      INTEGER NOT NULL,
    attempt          INTEGER NOT NULL,
    state            TEXT NOT NULL,
    recipient_pubkey TEXT NOT NULL,
    deadline_ms      INTEGER NOT NULL,
    opened_at        INTEGER NOT NULL,
    payout_request   TEXT,
    payout_hash      TEXT,
    payout_attempts  INTEGER NOT NULL DEFAULT 0,
    next_retry_ms    INTEGER,
    PRIMARY KEY (circle_id, cycle_index, attempt)
  );
  CREATE TABLE IF NOT EXISTS contributions (
    circle_id       TEXT NOT NULL,
    cycle_index     INTEGER NOT NULL,
    attempt         INTEGER NOT NULL,
    member_pubkey   TEXT NOT NULL,
    payment_hash    TEXT NOT NULL UNIQUE,
    payment_request TEXT NOT NULL,
    state           TEXT NOT NULL,
    PRIMARY KEY (circle_id, cycle_index, attempt, member_pubkey)
  );
`;

type Row = Record<string, unknown>;

/**
 * Circle and cycle cache. Money state always comes from LND; these rows only
 * record what the engine last saw and decided, so it can resume after a restart.
 */
export class CircleStore {
  constructor(private readonly db: DatabaseSync) {
    db.exec(SCHEMA);
  }

  createCircle(c: CircleRow): void {
    this.db
      .prepare(
        `INSERT INTO circles (id, name, contribution_sat, member_count, period_seconds, creator_pubkey, join_code, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(c.id, c.name, c.contributionSat, c.memberCount, c.periodSeconds, c.creatorPubkey, c.joinCode, c.status, c.createdAtMs);
  }

  getCircle(id: string): CircleRow | null {
    const row = this.db.prepare("SELECT * FROM circles WHERE id = ?").get(id) as Row | undefined;
    return row ? toCircle(row) : null;
  }

  getCircleByJoinCode(code: string): CircleRow | null {
    const row = this.db.prepare("SELECT * FROM circles WHERE join_code = ?").get(code) as Row | undefined;
    return row ? toCircle(row) : null;
  }

  circlesFor(pubkey: string): CircleRow[] {
    return (
      this.db
        .prepare(
          `SELECT c.* FROM circles c JOIN circle_members m ON m.circle_id = c.id
           WHERE m.pubkey = ? ORDER BY c.created_at DESC`,
        )
        .all(pubkey) as Row[]
    ).map(toCircle);
  }

  setCircleStatus(id: string, status: CircleStatus): void {
    this.db.prepare("UPDATE circles SET status = ? WHERE id = ?").run(status, id);
  }

  /** Appends a member at the next rotation position. */
  addMember(circleId: string, pubkey: string, nickname: string, joinedAtMs: number): number {
    const position = this.members(circleId).length;
    this.db
      .prepare("INSERT INTO circle_members (circle_id, pubkey, position, nickname, joined_at) VALUES (?, ?, ?, ?, ?)")
      .run(circleId, pubkey, position, nickname, joinedAtMs);
    return position;
  }

  /** Members in rotation order. */
  members(circleId: string): MemberRow[] {
    return (
      this.db
        .prepare("SELECT pubkey, position, nickname FROM circle_members WHERE circle_id = ? ORDER BY position")
        .all(circleId) as Row[]
    ).map((r) => ({ pubkey: String(r.pubkey), position: Number(r.position), nickname: String(r.nickname) }));
  }

  insertCycle(c: CycleRow): void {
    this.db
      .prepare(
        `INSERT INTO cycles (circle_id, cycle_index, attempt, state, recipient_pubkey, deadline_ms, opened_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(c.circleId, c.cycleIndex, c.attempt, c.state, c.recipientPubkey, c.deadlineMs, c.openedAtMs);
  }

  getCycle(k: CycleKey): CycleRow | null {
    const row = this.db
      .prepare("SELECT * FROM cycles WHERE circle_id = ? AND cycle_index = ? AND attempt = ?")
      .get(k.circleId, k.cycleIndex, k.attempt) as Row | undefined;
    return row ? toCycle(row) : null;
  }

  /** Most recently opened cycle of a circle, if any. */
  latestCycle(circleId: string): CycleRow | null {
    const row = this.db
      .prepare("SELECT * FROM cycles WHERE circle_id = ? ORDER BY cycle_index DESC, attempt DESC LIMIT 1")
      .get(circleId) as Row | undefined;
    return row ? toCycle(row) : null;
  }

  cyclesInStates(states: readonly CycleState[]): CycleRow[] {
    const placeholders = states.map(() => "?").join(", ");
    return (
      this.db.prepare(`SELECT * FROM cycles WHERE state IN (${placeholders})`).all(...states) as Row[]
    ).map(toCycle);
  }

  paidOutCount(circleId: string): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM cycles WHERE circle_id = ? AND state = 'paid_out'")
      .get(circleId) as Row;
    return Number(row.n);
  }

  attemptsFor(circleId: string, cycleIndex: number): number {
    const row = this.db
      .prepare("SELECT COUNT(*) AS n FROM cycles WHERE circle_id = ? AND cycle_index = ?")
      .get(circleId, cycleIndex) as Row;
    return Number(row.n);
  }

  updateCycle(
    k: CycleKey,
    patch: Partial<Pick<CycleRow, "state" | "payoutRequest" | "payoutHash" | "payoutAttempts" | "nextRetryMs">>,
  ): void {
    const columns: Record<keyof typeof patch, string> = {
      state: "state",
      payoutRequest: "payout_request",
      payoutHash: "payout_hash",
      payoutAttempts: "payout_attempts",
      nextRetryMs: "next_retry_ms",
    };
    const entries = Object.entries(patch) as [keyof typeof patch, string | number | null][];
    if (entries.length === 0) return;
    const sets = entries.map(([k]) => `${columns[k]} = ?`).join(", ");
    this.db
      .prepare(`UPDATE cycles SET ${sets} WHERE circle_id = ? AND cycle_index = ? AND attempt = ?`)
      .run(...entries.map(([, v]) => v), k.circleId, k.cycleIndex, k.attempt);
  }

  insertContribution(c: ContributionRow): void {
    this.db
      .prepare(
        `INSERT INTO contributions (circle_id, cycle_index, attempt, member_pubkey, payment_hash, payment_request, state)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(c.circleId, c.cycleIndex, c.attempt, c.memberPubkey, c.paymentHash, c.paymentRequest, c.state);
  }

  contributions(k: CycleKey): ContributionRow[] {
    return (
      this.db
        .prepare("SELECT * FROM contributions WHERE circle_id = ? AND cycle_index = ? AND attempt = ?")
        .all(k.circleId, k.cycleIndex, k.attempt) as Row[]
    ).map(toContribution);
  }

  contributionByHash(paymentHash: string): ContributionRow | null {
    const row = this.db.prepare("SELECT * FROM contributions WHERE payment_hash = ?").get(paymentHash) as
      | Row
      | undefined;
    return row ? toContribution(row) : null;
  }

  setContributionState(paymentHash: string, state: HoldInvoiceState): void {
    this.db.prepare("UPDATE contributions SET state = ? WHERE payment_hash = ?").run(state, paymentHash);
  }
}

function toCircle(r: Row): CircleRow {
  return {
    id: String(r.id),
    name: String(r.name),
    contributionSat: Number(r.contribution_sat),
    memberCount: Number(r.member_count),
    periodSeconds: Number(r.period_seconds),
    creatorPubkey: String(r.creator_pubkey),
    joinCode: String(r.join_code),
    status: String(r.status) as CircleStatus,
    createdAtMs: Number(r.created_at),
  };
}

function toCycle(r: Row): CycleRow {
  return {
    circleId: String(r.circle_id),
    cycleIndex: Number(r.cycle_index),
    attempt: Number(r.attempt),
    state: String(r.state) as CycleState,
    recipientPubkey: String(r.recipient_pubkey),
    deadlineMs: Number(r.deadline_ms),
    openedAtMs: Number(r.opened_at),
    payoutRequest: r.payout_request == null ? null : String(r.payout_request),
    payoutHash: r.payout_hash == null ? null : String(r.payout_hash),
    payoutAttempts: Number(r.payout_attempts),
    nextRetryMs: r.next_retry_ms == null ? null : Number(r.next_retry_ms),
  };
}

function toContribution(r: Row): ContributionRow {
  return {
    circleId: String(r.circle_id),
    cycleIndex: Number(r.cycle_index),
    attempt: Number(r.attempt),
    memberPubkey: String(r.member_pubkey),
    paymentHash: String(r.payment_hash),
    paymentRequest: String(r.payment_request),
    state: String(r.state) as HoldInvoiceState,
  };
}
