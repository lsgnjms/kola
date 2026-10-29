import type { DecodeResponse, PayResponse } from "@kola/shared";
import { useId, useState, type FormEvent } from "react";
import type { ApiClient } from "../api/client.js";
import { formatSat } from "../format.js";
import { useI18n } from "../i18n/index.js";
import { ErrorMessage, Screen } from "../ui.js";

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
        <p className="big">{t("common.sats", { amount: formatSat(locale, result.amountSat) })}</p>
        <p role="status">
          {succeeded ? t("pay.successFee", { amount: formatSat(locale, result.feeSat) }) : t("pay.inFlight")}
        </p>
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
        <p className="big">{t("pay.confirmAmount", { amount: formatSat(locale, step.decoded.amountSat) })}</p>
        <button type="button" className="primary" disabled={sending} onClick={() => void pay(step.decoded)}>
          {sending ? t("pay.sending") : t("pay.confirm")}
        </button>
      </Screen>
    );
  }

  return (
    <Screen title={t("pay.title")} onBack={onDone}>
      <form onSubmit={check}>
        <div className="field">
          <label htmlFor={inputId}>{t("pay.pasteLabel")}</label>
          <textarea
            id={inputId}
            className="mono"
            rows={4}
            autoComplete="off"
            spellCheck={false}
            value={paymentRequest}
            onChange={(e) => setPaymentRequest(e.target.value)}
          />
        </div>
        {error !== null && <ErrorMessage error={error} />}
        <button type="submit" className="primary" disabled={busy || !paymentRequest.trim()}>
          {t("pay.check")}
        </button>
      </form>
    </Screen>
  );
}
