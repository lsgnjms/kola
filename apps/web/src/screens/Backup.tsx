import { useId, useState, type FormEvent } from "react";
import { copyText } from "../clipboard.js";
import { useI18n } from "../i18n/index.js";
import type { Keystore } from "../keys/keystore.js";
import { PinField, Screen } from "../ui.js";

/** Shows the backup code after the PIN is re-entered. */
export function Backup({ keystore, onDone }: { keystore: Keystore; onDone: () => void }) {
  const { t } = useI18n();
  const codeId = useId();
  const [pin, setPin] = useState("");
  const [backup, setBackup] = useState<string | null>(null);
  const [retryAfterMs, setRetryAfterMs] = useState<number | null>(null);
  const [copied, setCopied] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pin.length !== 6) return;
    const result = await keystore.exportBackup(pin);
    setPin("");
    if (result.ok) setBackup(result.backup);
    else setRetryAfterMs(result.retryAfterMs);
  };

  return (
    <Screen title={t("backup.title")} onBack={onDone}>
      <p>{t("backup.explain")}</p>
      {backup ? (
        <>
          <label htmlFor={codeId}>{t("backup.codeLabel")}</label>
          <p id={codeId} className="mono notice">
            {backup}
          </p>
          <button type="button" className="primary" onClick={() => void copyText(backup).then(setCopied)}>
            {copied ? t("common.copied") : t("common.copy")}
          </button>
          <button type="button" className="secondary" onClick={onDone}>
            {t("common.done")}
          </button>
        </>
      ) : (
        <form onSubmit={submit}>
          <PinField label={t("pin.label")} value={pin} onChange={setPin} autoFocus />
          {retryAfterMs !== null && (
            <p className="notice notice-error" role="alert">
              {retryAfterMs > 0 ? t("unlock.wait", { seconds: Math.ceil(retryAfterMs / 1000) }) : t("unlock.wrong")}
            </p>
          )}
          <button type="submit" className="primary">
            {t("backup.reveal")}
          </button>
        </form>
      )}
    </Screen>
  );
}
