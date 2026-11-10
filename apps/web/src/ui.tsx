import { useId, type ReactNode } from "react";
import { ApiError } from "./api/client.js";
import { describeError } from "./format.js";
import { useI18n } from "./i18n/index.js";
import { ChevronLeft, Message } from "./icons.js";
import { whatsappUrl } from "./whatsapp.js";

export function Screen({
  title,
  children,
  onBack,
  action,
}: {
  title: string;
  children: ReactNode;
  onBack?: () => void;
  action?: ReactNode;
}) {
  const { t } = useI18n();
  return (
    <section className="screen-body">
      <div className="screen-head">
        {onBack && (
          <button type="button" className="icon-btn" onClick={onBack} aria-label={t("common.back")}>
            <ChevronLeft />
          </button>
        )}
        <h2 style={{ flex: 1 }}>{title}</h2>
        {action}
      </div>
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

/** Round icon button with a label underneath, as in mobile wallets. */
export function ActionButton({
  icon,
  label,
  onClick,
  disabled = false,
}: {
  icon: ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button type="button" className="action" onClick={onClick} disabled={disabled}>
      <span className="action-icon">{icon}</span>
      {label}
    </button>
  );
}

const AVATAR_COLOURS = ["#1f7a4d", "#b5532a", "#2b6cb0", "#8a4fbf", "#b7791f", "#2c7a7b", "#c53060", "#4a5568"];

/** Initial on a colour picked from the name, so each member is recognisable at a glance. */
export function Avatar({ name, small = false }: { name: string; small?: boolean }) {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const colour = AVATAR_COLOURS[hash % AVATAR_COLOURS.length];
  return (
    <span className={small ? "avatar avatar-sm" : "avatar"} style={{ background: colour }} aria-hidden="true">
      {name.trim().charAt(0).toUpperCase() || "?"}
    </span>
  );
}

/** The approximate local-currency value of an amount, when a rate is available. */
export function Fiat({ amountSat, className = "fiat" }: { amountSat: number; className?: string }) {
  const { fiat } = useI18n();
  const text = fiat(amountSat);
  return text ? <span className={className}>{text}</span> : null;
}

/** Opens WhatsApp with `text` ready to send to a chat the member picks. */
export function WhatsAppButton({ text }: { text: string }) {
  const { t } = useI18n();
  return (
    <a className="secondary whatsapp" href={whatsappUrl(text)} target="_blank" rel="noopener noreferrer">
      <Message size={20} />
      {t("common.whatsapp")}
    </a>
  );
}
