import { auditCircle, type AuditResult, type CircleView } from "@kola/shared";
import { useCallback, useEffect, useState } from "react";
import { formatSat, formatTime } from "../../format.js";
import { useI18n } from "../../i18n/index.js";
import { describeEntry, fetchRecord } from "./record.js";

/** Lazy-loaded: the relay client is only downloaded when someone opens the record. */
export default function AuditLog({ view }: { view: CircleView }) {
  const { t, locale } = useI18n();
  const [result, setResult] = useState<AuditResult | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setUnreachable(false);
    try {
      const raw = await fetchRecord(view);
      // Checked here on the phone: signatures and hashes are recomputed, not taken on trust.
      setResult(auditCircle(raw, { circleId: view.id, coordinatorPubkey: view.coordinatorPubkey }));
    } catch {
      setUnreachable(true);
    } finally {
      setLoading(false);
    }
  }, [view]);

  // Once per opening; the circle screen's refreshes must not refetch the record.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => void load(), [view.id]);

  const nameOf = (pubkey: string) =>
    view.members.find((m) => m.pubkey === pubkey)?.nickname ?? `${pubkey.slice(0, 8)}…`;

  return (
    <section className="round" aria-busy={loading}>
      <h3>{t("audit.title")}</h3>
      <p>{t("audit.explain")}</p>
      {loading && <p>{t("common.loading")}</p>}
      {unreachable && (
        <p className="notice notice-error" role="alert">
          {t("audit.unreachable")}
        </p>
      )}
      {result && result.entries.length === 0 && result.problems.length === 0 && <p>{t("audit.empty")}</p>}
      {result && result.problems.length > 0 && (
        <div className="notice notice-error" role="alert">
          <p>{t("audit.problems")}</p>
          {[...new Set(result.problems.map((p) => p.code))].map((code) => (
            <p key={code}>{t(`audit.problem.${code}`)}</p>
          ))}
        </div>
      )}
      {result && result.entries.length > 0 && result.problems.length === 0 && (
        <p className="notice" role="status">
          ✓ {t("audit.allGood", { count: result.entries.length })}
        </p>
      )}
      {result && result.entries.length > 0 && (
        <ol className="members">
          {result.entries.map((entry) => (
            <li key={entry.id}>
              <span>{describeEntry(t, entry, nameOf, (amount) => formatSat(locale, amount))}</span>
              <small>{formatTime(locale, entry.createdAtS * 1000)}</small>
            </li>
          ))}
        </ol>
      )}
      <button type="button" className="secondary" disabled={loading} onClick={() => void load()}>
        {t("home.refresh")}
      </button>
    </section>
  );
}
