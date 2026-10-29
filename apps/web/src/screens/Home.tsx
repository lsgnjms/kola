import type { WalletTransactionView } from "@kola/shared";
import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../api/client.js";
import { formatSat, formatTime } from "../format.js";
import { useI18n } from "../i18n/index.js";
import { ErrorMessage } from "../ui.js";

interface WalletState {
  balanceSat: number;
  transactions: WalletTransactionView[];
}

export function Home({
  api,
  onReceive,
  onPay,
  onLock,
}: {
  api: ApiClient;
  onReceive: () => void;
  onPay: () => void;
  onLock: () => void;
}) {
  const { t, locale } = useI18n();
  const [wallet, setWallet] = useState<WalletState | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);

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

  return (
    <section className="screen-body">
      <div className="balance" aria-live="polite">
        <p className="balance-label">{t("home.balance")}</p>
        <p className="balance-amount">
          {wallet ? t("common.sats", { amount: formatSat(locale, wallet.balanceSat) }) : t("common.loading")}
        </p>
      </div>

      {error !== null && <ErrorMessage error={error} />}

      <div className="actions">
        <button type="button" className="primary" onClick={onReceive}>
          {t("home.receive")}
        </button>
        <button type="button" className="primary" onClick={onPay}>
          {t("home.pay")}
        </button>
      </div>

      <div className="row">
        <h2>{t("home.history")}</h2>
        <button type="button" className="secondary" onClick={() => void refresh()} disabled={loading}>
          {t("home.refresh")}
        </button>
      </div>
      {wallet && wallet.transactions.length === 0 && <p>{t("home.empty")}</p>}
      <ul className="history">
        {wallet?.transactions.map((tx, i) => (
          <li key={`${tx.timestampMs}-${i}`} className={`tx tx-${tx.direction} tx-${tx.status}`}>
            <span>
              <strong>{t(tx.direction === "in" ? "history.in" : "history.out")}</strong>
              {tx.status !== "complete" && (
                <span className="tx-status">
                  {" · "}
                  {t(tx.status === "pending" ? "history.pending" : "history.failed")}
                </span>
              )}
              <br />
              <small>{formatTime(locale, tx.timestampMs)}</small>
            </span>
            <span className="tx-amount">
              {tx.direction === "in" ? "+" : "−"}
              {t("common.sats", { amount: formatSat(locale, tx.amountSat) })}
              {tx.feeSat > 0 && (
                <>
                  <br />
                  <small>{t("history.fee", { amount: formatSat(locale, tx.feeSat) })}</small>
                </>
              )}
            </span>
          </li>
        ))}
      </ul>

      <button type="button" className="secondary" onClick={onLock}>
        {t("home.lock")}
      </button>
    </section>
  );
}
