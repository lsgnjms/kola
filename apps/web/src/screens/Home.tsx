import type { WalletTransactionView } from "@kola/shared";
import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../api/client.js";
import { formatSat, formatTime } from "../format.js";
import { useI18n } from "../i18n/index.js";
import { ArrowDown, ArrowUp, Bolt, Cross, Refresh, Users } from "../icons.js";
import { ActionButton, ErrorMessage } from "../ui.js";

interface WalletState {
  balanceSat: number;
  transactions: WalletTransactionView[];
}

/** Rows shown before "See all": enough to recognise recent payments without a long scroll. */
const RECENT_ROWS = 5;

export function Home({
  api,
  onReceive,
  onPay,
  onCircles,
}: {
  api: ApiClient;
  onReceive: () => void;
  onPay: () => void;
  onCircles: () => void;
}) {
  const { t, locale } = useI18n();
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [{ balanceSat }, { transactions }] = await Promise.all([api.balance(), api.history()]);
      setWallet({ balanceSat, transactions });
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const transactions = wallet?.transactions ?? [];
  const visible = showAll ? transactions : transactions.slice(0, RECENT_ROWS);

  return (
    <section className="screen-body">
      <div className="hero" aria-live="polite">
        <span className="hero-label">{t("home.balance")}</span>
        <span className="hero-amount">
          {wallet ? formatSat(locale, wallet.balanceSat) : "…"}
          <span className="hero-unit">sats</span>
        </span>
        <span className="chip">
          <Bolt size={14} />
          {t("home.testMoney")}
        </span>
      </div>

      <div className="actions-row">
        <ActionButton icon={<ArrowDown />} label={t("home.receive")} onClick={onReceive} />
        <ActionButton icon={<ArrowUp />} label={t("home.pay")} onClick={onPay} />
        <ActionButton icon={<Users />} label={t("nav.circles")} onClick={onCircles} />
      </div>

      {error !== null && <ErrorMessage error={error} />}

      <div className="section-head">
        <h3>{t("home.history")}</h3>
        <button
          type="button"
          className="icon-btn"
          onClick={() => void refresh()}
          disabled={loading}
          aria-label={t("home.refresh")}
        >
          <Refresh size={20} />
        </button>
      </div>

      <div className="card card-flush">
        {wallet && transactions.length === 0 ? (
          <div className="empty">
            <span className="empty-icon">
              <Bolt />
            </span>
            <p>{t("home.empty")}</p>
          </div>
        ) : (
          <ul className="list">
            {visible.map((tx, i) => (
              <li key={`${tx.timestampMs}-${i}`} className={`row tx-${tx.direction} tx-${tx.status}`}>
                <span className="tx-icon">
                  {tx.status === "failed" ? <Cross size={20} /> : tx.direction === "in" ? <ArrowDown size={20} /> : <ArrowUp size={20} />}
                </span>
                <span className="row-main">
                  <span className="row-title">
                    {t(tx.direction === "in" ? "history.in" : "history.out")}
                    {tx.status !== "complete" && (
                      <span className={`pill ${tx.status === "pending" ? "pill-wait" : "pill-bad"}`} style={{ marginLeft: 8 }}>
                        {t(tx.status === "pending" ? "history.pending" : "history.failed")}
                      </span>
                    )}
                  </span>
                  <span className="row-sub">{formatTime(locale, tx.timestampMs)}</span>
                </span>
                <span className="row-end">
                  {tx.direction === "in" ? "+" : "−"}
                  {formatSat(locale, tx.amountSat)}
                  {tx.feeSat > 0 && <small>{t("history.fee", { amount: formatSat(locale, tx.feeSat) })}</small>}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {transactions.length > RECENT_ROWS && (
        <button type="button" className="secondary" onClick={() => setShowAll((s) => !s)}>
          {showAll ? t("home.showLess") : t("home.seeAll", { count: transactions.length })}
        </button>
      )}
    </section>
  );
}
