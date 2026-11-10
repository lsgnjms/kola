import type { DecodeResponse, PayResponse } from "@kola/shared";
import { useId, useState, type FormEvent } from "react";
import type { ApiClient } from "../api/client.js";
import { formatSat } from "../format.js";
import { useI18n } from "../i18n/index.js";
import { ArrowUp, Check, Clipboard, Clock } from "../icons.js";
import { ErrorMessage, Screen, Fiat } from "../ui.js";

type Step =
  | { name: "enter" }
  | { name: "confirm"; decoded: DecodeResponse }
  | { name: "sending"; decoded: DecodeResponse }
  | { name: "result"; result: PayResponse };

/** Paste → check amount → confirm → result. Nothing is paid without the confirm tap. */
export function Pay({ api, onDone }: { api: ApiClient; onDone: () => void }) {
  const { t, locale } = useI18n();
  const inputId = useId();
  const [paymentRequest, setPaymentRequest] = useState("");
  const [step, setStep] = useState<Step>({ name: "enter" });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  const check = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      setStep({ name: "confirm", decoded: await api.decode(paymentRequest.trim()) });
      setError(null);
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const pay = async (decoded: DecodeResponse) => {
    setStep({ name: "sending", decoded });
    try {
      setStep({ name: "result", result: await api.pay(paymentRequest.trim()) });
      setError(null);
    } catch (err) {
      setError(err);
      setStep({ name: "enter" });
    }
  };

  if (step.name === "result") {
    const { result } = step;
    const succeeded = result.status === "succeeded";
    return (
      <Screen title={t(succeeded ? "pay.successTitle" : "pay.inFlightTitle")}>
        <div className="card center">
          <span className="result-icon">{succeeded ? <Check size={36} /> : <Clock size={36} />}</span>
          <p className="big">
            {formatSat(locale, result.amountSat)} <span className="muted">sats</span>
          </p>
          <p role="status" className="hint">
            {succeeded ? t("pay.successFee", { amount: formatSat(locale, result.feeSat) }) : t("pay.inFlight")}
          </p>
        </div>
        <button type="button" className="primary" onClick={onDone}>
          {t("common.done")}
        </button>
      </Screen>
    );
  }

  if (step.name === "confirm" || step.name === "sending") {
    const sending = step.name === "sending";
    return (
      <Screen title={t("pay.confirmTitle")} {...(sending ? {} : { onBack: () => setStep({ name: "enter" }) })}>
        <div className="card center">
          <span className="result-icon">
            <ArrowUp size={36} />
          </span>
          <p className="big">
            {formatSat(locale, step.decoded.amountSat)} <span className="muted">sats</span>
          </p>
          <Fiat amountSat={step.decoded.amountSat} />
          <p className="hint">{t("pay.confirmAmount", { amount: formatSat(locale, step.decoded.amountSat) })}</p>
        </div>
        <button type="button" className="primary" disabled={sending} onClick={() => void pay(step.decoded)}>
          {sending ? t("pay.sending") : t("pay.confirm")}
        </button>
      </Screen>
    );
  }

  // The clipboard API needs a secure context; over plain-http LAN testing, members paste by hand.
  const canPaste = typeof navigator.clipboard?.readText === "function" && window.isSecureContext;

  return (
    <Screen title={t("pay.title")} onBack={onDone}>
      <form onSubmit={check}>
        <div className="card">
          <div className="section-head" style={{ marginTop: 0 }}>
            <label htmlFor={inputId}>{t("pay.pasteLabel")}</label>
            {canPaste && (
              <button
                type="button"
                className="ghost"
                style={{ minHeight: 40, padding: "0.25rem 0.5rem" }}
                onClick={() =>
                  void navigator.clipboard
                    .readText()
                    .then((text) => setPaymentRequest(text.trim()))
                    .catch(() => undefined)
                }
              >
                <Clipboard size={18} />
                {t("pay.pasteButton")}
              </button>
            )}
          </div>
          <textarea
            id={inputId}
            className="mono"
            rows={4}
            autoComplete="off"
            spellCheck={false}
            placeholder="lnbcrt…"
            value={paymentRequest}
            onChange={(e) => setPaymentRequest(e.target.value)}
          />
          <p className="hint">{t("pay.help")}</p>
        </div>
        {error !== null && <ErrorMessage error={error} />}
        <button type="submit" className="primary" disabled={busy || !paymentRequest.trim()}>
          {t("pay.check")}
        </button>
      </form>
    </Screen>
  );
}
