import { useI18n, LOCALES, type Locale } from "../i18n/index.js";
import { ChevronRight, Globe, Key, Lock, Shield } from "../icons.js";
import { Screen } from "../ui.js";

const LANGUAGE_NAME: Record<Locale, string> = { en: "English", fr: "Français" };

export function Settings({ onBackup, onLock }: { onBackup: () => void; onLock: () => void }) {
  const { t, locale, setLocale } = useI18n();
  return (
    <Screen title={t("settings.title")}>
      <div className="card card-flush">
        <div className="row">
          <span className="tx-icon">
            <Globe size={20} />
          </span>
          <span className="row-main">
            <span className="row-title">{t("settings.language")}</span>
          </span>
          <select
            className="lang"
            aria-label={t("settings.language")}
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {LANGUAGE_NAME[l]}
              </option>
            ))}
          </select>
        </div>
      </div>

      <h3>{t("settings.security")}</h3>
      <div className="card card-flush">
        <button type="button" className="row circle-card" style={{ background: "none" }} onClick={onBackup}>
          <span className="tx-icon">
            <Key size={20} />
          </span>
          <span className="row-main">
            <span className="row-title">{t("home.backup")}</span>
            <span className="row-sub">{t("settings.backupHelp")}</span>
          </span>
          <ChevronRight size={20} />
        </button>
        <button type="button" className="row circle-card" style={{ background: "none" }} onClick={onLock}>
          <span className="tx-icon">
            <Lock size={20} />
          </span>
          <span className="row-main">
            <span className="row-title">{t("home.lock")}</span>
            <span className="row-sub">{t("settings.lockHelp")}</span>
          </span>
          <ChevronRight size={20} />
        </button>
      </div>

      <div className="notice">
        <p className="benefit">
          <span className="benefit-icon">
            <Shield size={20} />
          </span>
          <span>{t("settings.about")}</span>
        </p>
      </div>
    </Screen>
  );
}
