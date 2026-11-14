import { auditCircle, type AuditResult, type CircleView } from "@kola/shared";
import { useCallback, useEffect, useState } from "react";
import { formatSat, formatTime } from "../../format.js";
import { useI18n } from "../../i18n/index.js";
import { Check, Refresh, Shield } from "../../icons.js";
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
    <section className="card" aria-busy={loading}>
      <h3>{t("audit.title")}</h3>
      <p className="hint">{t("audit.explain")}</p>
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
        <p className="notice notice-ok benefit" role="status">
          <Shield size={20} />
          <span>{t("audit.allGood", { count: result.entries.length })}</span>
        </p>
      )}
      {result && result.ignored > 0 && <p className="hint">{t("audit.ignored", { count: result.ignored })}</p>}
      {result && result.entries.length > 0 && (
        <ol className="list">
          {result.entries.map((entry) => (
            <li key={entry.id} className="row">
              <span className="tx-icon" style={{ width: 32, height: 32 }}>
                <Check size={16} />
              </span>
              <span className="row-main">
                <span>{describeEntry(t, entry, nameOf, (amount) => formatSat(locale, amount))}</span>
                <span className="row-sub">{formatTime(locale, entry.createdAtS * 1000)}</span>
              </span>
            </li>
          ))}
        </ol>
      )}
      <button type="button" className="secondary" disabled={loading} onClick={() => void load()}>
        <Refresh size={20} />
        {t("home.refresh")}
      </button>
    </section>
  );
}
