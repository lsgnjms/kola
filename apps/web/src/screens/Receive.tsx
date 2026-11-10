import type { CreateInvoiceResponse } from "@kola/shared";
import { useId, useMemo, useState, type FormEvent } from "react";
import { renderSVG } from "uqr";
import type { ApiClient } from "../api/client.js";
import { copyText } from "../clipboard.js";
import { formatSat } from "../format.js";
import { useI18n } from "../i18n/index.js";
import { Copy, Share } from "../icons.js";
import { ErrorMessage, Screen, Fiat } from "../ui.js";

const PRESETS_SAT = [1_000, 5_000, 10_000, 20_000];

/** Lazy-loaded: pulls in the QR encoder only when someone receives. */
export default function Receive({ api, onDone }: { api: ApiClient; onDone: () => void }) {
  const { t, locale } = useI18n();
  const amountId = useId();
  const [amount, setAmount] = useState("");
  const [invoice, setInvoice] = useState<{ response: CreateInvoiceResponse; amountSat: number } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const qr = useMemo(
    () => (invoice ? renderSVG(invoice.response.paymentRequest.toUpperCase(), { border: 2 }) : null),
    [invoice],
  );
  // Web Share needs a secure context (https or localhost); over plain-http LAN testing it is absent.
  const canShare = typeof navigator.share === "function";

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const amountSat = Number(amount);
    if (!Number.isSafeInteger(amountSat) || amountSat <= 0) return;
    setBusy(true);
    try {
      setInvoice({ response: await api.createInvoice(amountSat), amountSat });
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (invoice && qr) {
    const request = invoice.response.paymentRequest;
    return (
      <Screen title={t("receive.title")} onBack={onDone}>
        <div className="card">
          <p className="big">
            {formatSat(locale, invoice.amountSat)} <span className="muted">sats</span>
          </p>
          <Fiat amountSat={invoice.amountSat} />
          {/* uqr returns a static SVG string built from the invoice; no user HTML involved. */}
          <div className="qr" role="img" aria-label={t("receive.qrLabel")} dangerouslySetInnerHTML={{ __html: qr }} />
          <p className="hint center">{t("receive.show")}</p>
          <p className="mono center">
            {request.slice(0, 18)}…{request.slice(-10)}
          </p>
        </div>
        <div className={canShare ? "button-pair" : ""} style={canShare ? undefined : { display: "grid" }}>
          <button type="button" className="primary" onClick={() => void copyText(request).then(setCopied)}>
            <Copy size={20} />
            {copied ? t("common.copied") : t("common.copy")}
          </button>
          {canShare && (
            <button
              type="button"
              className="secondary"
              onClick={() => void navigator.share({ text: request }).catch(() => undefined)}
            >
              <Share size={20} />
              {t("receive.share")}
            </button>
          )}
        </div>
        <p className="hint center">{t("receive.expires", { minutes: Math.round(invoice.response.expiresInSeconds / 60) })}</p>
        <button type="button" className="ghost" onClick={onDone}>
          {t("common.done")}
        </button>
      </Screen>
    );
  }

  return (
    <Screen title={t("receive.title")} onBack={onDone}>
      <form onSubmit={submit}>
        <div className="card">
          <label htmlFor={amountId} className="center">
            {t("receive.amountLabel")}
          </label>
          <input
            id={amountId}
            className="amount-input"
            type="text"
            inputMode="numeric"
            placeholder="0"
            value={amount ? formatSat(locale, Number(amount)) : ""}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, "").slice(0, 9))}
            autoFocus
          />
          <div className="presets">
            {PRESETS_SAT.map((sat) => (
              <button
                key={sat}
                type="button"
                className="preset"
                aria-pressed={Number(amount) === sat}
                onClick={() => setAmount(String(sat))}
              >
                {formatSat(locale, sat)}
              </button>
            ))}
          </div>
        </div>
        {error !== null && <ErrorMessage error={error} />}
        <button type="submit" className="primary" disabled={busy || !amount}>
          {t("receive.create")}
        </button>
      </form>
    </Screen>
  );
}
