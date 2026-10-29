import type { CreateInvoiceResponse } from "@kola/shared";
import { useId, useMemo, useState, type FormEvent } from "react";
import { renderSVG } from "uqr";
import type { ApiClient } from "../api/client.js";
import { useI18n } from "../i18n/index.js";
import { ErrorMessage, Screen } from "../ui.js";

/** Lazy-loaded: pulls in the QR encoder only when someone receives. */
export default function Receive({ api, onDone }: { api: ApiClient; onDone: () => void }) {
  const { t } = useI18n();
  const amountId = useId();
  const [amount, setAmount] = useState("");
  const [invoice, setInvoice] = useState<CreateInvoiceResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const qr = useMemo(
    () => (invoice ? renderSVG(invoice.paymentRequest.toUpperCase(), { border: 2 }) : null),
    [invoice],
  );

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amountSat = Number(amount);
    if (!Number.isSafeInteger(amountSat) || amountSat <= 0) return;
    setBusy(true);
    try {
      setInvoice(await api.createInvoice(amountSat));
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const copy = async () => {
    if (!invoice) return;
    await navigator.clipboard.writeText(invoice.paymentRequest);
    setCopied(true);
  };

  if (invoice && qr) {
    return (
      <Screen title={t("receive.title")} onBack={onDone}>
        <p>{t("receive.show")}</p>
        {/* uqr returns a static SVG string built from the invoice; no user HTML involved. */}
        <div className="qr" role="img" aria-label={t("receive.qrLabel")} dangerouslySetInnerHTML={{ __html: qr }} />
        <p className="mono">{invoice.paymentRequest}</p>
        <button type="button" className="primary" onClick={() => void copy()}>
          {copied ? t("common.copied") : t("common.copy")}
        </button>
        <p>{t("receive.expires", { minutes: Math.round(invoice.expiresInSeconds / 60) })}</p>
        <button type="button" className="secondary" onClick={onDone}>
          {t("common.done")}
        </button>
      </Screen>
    );
  }

  return (
    <Screen title={t("receive.title")} onBack={onDone}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor={amountId}>{t("receive.amountLabel")}</label>
          <input
            id={amountId}
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            autoFocus
          />
        </div>
        {error !== null && <ErrorMessage error={error} />}
        <button type="submit" className="primary" disabled={busy || !amount}>
          {t("receive.create")}
        </button>
      </form>
    </Screen>
  );
}
