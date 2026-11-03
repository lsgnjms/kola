/** Counts uses per key per UTC day. In memory: a restart resets it, which only ever errs towards fewer refusals. */
export class DailyQuota {
  private readonly used = new Map<string, number>();

  constructor(private readonly limit: number) {}

  /** Records one use; false if the key has already used today's allowance. */
  take(key: string, nowMs: number): boolean {
    const day = new Date(nowMs).toISOString().slice(0, 10);
    for (const k of this.used.keys()) if (!k.endsWith(day)) this.used.delete(k);
    const slot = `${key}:${day}`;
    const count = this.used.get(slot) ?? 0;
    if (count >= this.limit) return false;
    this.used.set(slot, count + 1);
    return true;
  }
}
