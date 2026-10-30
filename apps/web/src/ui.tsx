import { useId, type ReactNode } from "react";
import { ApiError } from "./api/client.js";
import { describeError } from "./format.js";
import { useI18n } from "./i18n/index.js";

export function Screen({ title, children, onBack }: { title: string; children: ReactNode; onBack?: () => void }) {
  const { t } = useI18n();
  return (
    <section className="screen-body">
      {onBack && (
        <button type="button" className="link" onClick={onBack}>
          ← {t("common.back")}
        </button>
      )}
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** Shows an API error in plain words, including whether money moved. */
export function ErrorMessage({ error }: { error: unknown }) {
  const { t } = useI18n();
  const lines =
    error instanceof ApiError ? describeError(t, error.code, error.moneyMoved) : describeError(t, "internal");
  return (
    <div className="notice notice-error" role="alert">
      {lines.map((line) => (
        <p key={line}>{line}</p>
      ))}
    </div>
  );
}

export function PinField({
  label,
  value,
  onChange,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (pin: string) => void;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        className="pin"
        type="password"
        inputMode="numeric"
        autoComplete="off"
        pattern="[0-9]*"
        maxLength={6}
        value={value}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value.replace(/\D/g, "").slice(0, 6))}
      />
    </div>
  );
}
