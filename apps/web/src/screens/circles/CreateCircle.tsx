import { useId, useState, type FormEvent } from "react";
import type { ApiClient } from "../../api/client.js";
import { formatSat } from "../../format.js";
import { useI18n } from "../../i18n/index.js";
import { ErrorMessage, Screen } from "../../ui.js";

const SIZES = [2, 3, 4, 5, 6, 8, 10, 12];

export function CreateCircle({
  api,
  onBack,
  onCreated,
}: {
  api: ApiClient;
  onBack: () => void;
  onCreated: (id: string) => void;
}) {
  const { t, locale } = useI18n();
  const ids = { name: useId(), amount: useId(), size: useId(), nickname: useId(), help: useId() };
  const [name, setName] = useState("");
  const [amount, setAmount] = useState("");
  const [memberCount, setMemberCount] = useState(3);
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const contributionSat = Number(amount);
  const valid = name.trim() && nickname.trim() && Number.isSafeInteger(contributionSat) && contributionSat > 0;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      const circle = await api.createCircle({ name: name.trim(), contributionSat, memberCount, nickname: nickname.trim() });
      onCreated(circle.id);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Screen title={t("create.title")} onBack={onBack}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor={ids.name}>{t("create.name")}</label>
          <input id={ids.name} value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label htmlFor={ids.amount}>{t("create.amount")}</label>
          <input
            id={ids.amount}
            inputMode="numeric"
            pattern="[0-9]*"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
          />
        </div>
        <div className="field">
          <label htmlFor={ids.size}>{t("create.members")}</label>
          <select id={ids.size} value={memberCount} onChange={(e) => setMemberCount(Number(e.target.value))}>
            {SIZES.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={ids.nickname}>{t("create.nickname")}</label>
          <input
            id={ids.nickname}
            value={nickname}
            maxLength={24}
            aria-describedby={ids.help}
            onChange={(e) => setNickname(e.target.value)}
          />
          <small id={ids.help}>{t("create.nicknameHelp")}</small>
        </div>
        {contributionSat > 0 && (
          <p className="notice">{t("create.potPreview", { amount: formatSat(locale, contributionSat * memberCount) })}</p>
        )}
        {error !== null && <ErrorMessage error={error} />}
        <button type="submit" className="primary" disabled={!valid || busy}>
          {t("create.submit")}
        </button>
      </form>
    </Screen>
  );
}
