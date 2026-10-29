import { useId, useState, type FormEvent } from "react";
import { useI18n } from "../i18n/index.js";
import { PinField, Screen } from "../ui.js";

/** Paste a backup code and its PIN to use an existing wallet on this phone. */
export function Restore({ onRestore, onBack }: { onRestore: (backup: string, pin: string) => Promise<boolean>; onBack: () => void }) {
  const { t } = useI18n();
  const codeId = useId();
  const [backup, setBackup] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!backup.trim() || pin.length !== 6 || busy) return;
    setBusy(true);
    const ok = await onRestore(backup, pin);
    if (!ok) {
      setBusy(false);
      setPin("");
      setWrong(true);
    }
  };

  return (
    <Screen title={t("restore.title")} onBack={onBack}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor={codeId}>{t("restore.codeLabel")}</label>
          <textarea
            id={codeId}
            className="mono"
            rows={4}
            autoComplete="off"
            spellCheck={false}
            value={backup}
            onChange={(e) => setBackup(e.target.value)}
            autoFocus
          />
        </div>
        <PinField label={t("restore.pinLabel")} value={pin} onChange={setPin} />
        {wrong && (
          <p className="notice notice-error" role="alert">
            {t("restore.wrong")}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? t("unlock.checking") : t("restore.submit")}
        </button>
      </form>
    </Screen>
  );
}
