import type { CircleView } from "@kola/shared";
import { useEffect, useId, useState, type FormEvent } from "react";
import type { ApiClient } from "../../api/client.js";
import { copyText } from "../../clipboard.js";
import { formatSat } from "../../format.js";
import { useI18n } from "../../i18n/index.js";
import { ErrorMessage } from "../../ui.js";
import { quickAnswer, type QuickQuestion } from "./quickAnswers.js";

const QUICK: { question: QuickQuestion; label: "assistant.whoseTurn" | "assistant.whoOwes" | "assistant.reminder" }[] = [
  { question: "whose_turn", label: "assistant.whoseTurn" },
  { question: "who_owes", label: "assistant.whoOwes" },
  { question: "reminder", label: "assistant.reminder" },
];

/**
 * Lazy-loaded. Quick questions are answered on the phone; free-text questions
 * appear only when the server has an AI key. Either way it can only read.
 */
export default function Assistant({ api, view }: { api: ApiClient; view: CircleView }) {
  const { t, locale } = useI18n();
  const inputId = useId();
  const [mode, setMode] = useState<"ai" | "templated">("templated");
  const [answer, setAnswer] = useState<{ text: string; copyable: boolean } | null>(null);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    void api.assistantMode().then(setMode);
  }, [api]);

  const show = (text: string, copyable: boolean) => {
    setAnswer({ text, copyable });
    setCopied(false);
    setError(null);
  };

  const ask = async (e: FormEvent) => {
    e.preventDefault();
    if (!question.trim() || busy) return;
    setBusy(true);
    try {
      show((await api.askAssistant(view.id, question.trim(), locale)).answer, true);
      setQuestion("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="round">
      <h3>{t("assistant.title")}</h3>
      <div className="quick">
        {QUICK.map(({ question: q, label }) => (
          <button
            key={q}
            type="button"
            className="secondary"
            onClick={() =>
              show(quickAnswer(t, view, q, Date.now(), (amount) => formatSat(locale, amount)), q === "reminder")
            }
          >
            {t(label)}
          </button>
        ))}
      </div>

      {mode === "ai" && (
        <form onSubmit={ask}>
          <div className="field">
            <label htmlFor={inputId}>{t("assistant.askLabel")}</label>
            <input id={inputId} value={question} maxLength={500} onChange={(e) => setQuestion(e.target.value)} />
          </div>
          <button type="submit" className="primary" disabled={busy || !question.trim()}>
            {busy ? t("assistant.thinking") : t("assistant.ask")}
          </button>
        </form>
      )}

      {error !== null && <ErrorMessage error={error} />}
      {answer && (
        // Plain text only: React escapes it, so a model reply can never inject markup.
        <div className="notice" role="status">
          <p className="answer">{answer.text}</p>
          {answer.copyable && (
            <button type="button" className="secondary" onClick={() => void copyText(answer.text).then(setCopied)}>
              {copied ? t("common.copied") : t("common.copy")}
            </button>
          )}
        </div>
      )}
      <small className="muted">{t(mode === "ai" ? "assistant.aiNote" : "assistant.templatedNote")}</small>
    </section>
  );
}
