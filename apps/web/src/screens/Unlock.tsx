import { useState, type FormEvent } from "react";
import { useI18n } from "../i18n/index.js";
import type { UnlockResult } from "../keys/keystore.js";
import { PinField, Screen } from "../ui.js";

export function Unlock({ onUnlock }: { onUnlock: (pin: string) => Promise<UnlockResult> }) {
  const { t } = useI18n();
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<{ retryAfterMs: number } | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (pin.length !== 6 || busy) return;
    setBusy(true);
    const result = await onUnlock(pin);
    setBusy(false);
    if (!result.ok) {
      setPin("");
      setFailure({ retryAfterMs: result.retryAfterMs });
    }
  };

  return (
    <Screen title={t("unlock.title")}>
      <form onSubmit={submit}>
        <PinField label={t("pin.label")} value={pin} onChange={setPin} autoFocus />
        {failure && (
          <p className="notice notice-error" role="alert">
            {failure.retryAfterMs > 0
              ? t("unlock.wait", { seconds: Math.ceil(failure.retryAfterMs / 1000) })
              : t("unlock.wrong")}
          </p>
        )}
        <button type="submit" className="primary" disabled={busy}>
          {busy ? t("unlock.checking") : t("unlock.button")}
        </button>
      </form>
    </Screen>
  );
}
