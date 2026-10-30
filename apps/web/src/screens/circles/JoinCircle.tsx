import { useId, useState, type FormEvent } from "react";
import type { ApiClient } from "../../api/client.js";
import { useI18n } from "../../i18n/index.js";
import { ErrorMessage, Screen } from "../../ui.js";

export function JoinCircle({
  api,
  onBack,
  onJoined,
}: {
  api: ApiClient;
  onBack: () => void;
  onJoined: (id: string) => void;
}) {
  const { t } = useI18n();
  const ids = { code: useId(), nickname: useId(), help: useId() };
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const valid = code.length === 6 && nickname.trim();

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    try {
      const circle = await api.joinCircle({ joinCode: code, nickname: nickname.trim() });
      onJoined(circle.id);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <Screen title={t("join.title")} onBack={onBack}>
      <form onSubmit={submit}>
        <div className="field">
          <label htmlFor={ids.code}>{t("join.code")}</label>
          <input
            id={ids.code}
            className="code"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            maxLength={6}
            value={code}
            // Same alphabet as the server: no 0/O/1/I, so codes read aloud unambiguously.
            onChange={(e) => setCode(e.target.value.toUpperCase().replace(/[^A-HJ-NP-Z2-9]/g, ""))}
            autoFocus
          />
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
        {error !== null && <ErrorMessage error={error} />}
        <button type="submit" className="primary" disabled={!valid || busy}>
          {t("join.submit")}
        </button>
      </form>
    </Screen>
  );
}
