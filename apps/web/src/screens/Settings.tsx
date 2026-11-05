import type { DemoPerson } from "@kola/shared";
import { useState } from "react";
import { useI18n, LOCALES, type Locale } from "../i18n/index.js";
import { ChevronRight, Globe, Key, Lock, Shield } from "../icons.js";
import { Avatar, Screen } from "../ui.js";

const LANGUAGE_NAME: Record<Locale, string> = { en: "English", fr: "Français" };

export function Settings({
  onBackup,
  onLock,
  demoPeople,
  activeDemo,
  onDemoPerson,
}: {
  onBackup: () => void;
  onLock: () => void;
  demoPeople: DemoPerson[];
  activeDemo: string | null;
  onDemoPerson: (person: DemoPerson) => Promise<void>;
}) {
  const { t, locale, setLocale } = useI18n();
  const [switching, setSwitching] = useState<string | null>(null);
  return (
    <Screen title={t("settings.title")}>
      {demoPeople.length > 0 && (
        <div className="card">
          <h3>{t("settings.demoTitle")}</h3>
          <p className="hint">{t("settings.demoHelp")}</p>
          <div className="people">
            {demoPeople.map((person) => {
              const active = person.nickname === activeDemo;
              return (
                <button
                  key={person.nickname}
                  type="button"
                  className="person"
                  aria-pressed={active}
                  disabled={active || switching !== null}
                  style={active ? { borderColor: "var(--accent)", background: "var(--accent-soft)" } : undefined}
                  onClick={() => {
                    setSwitching(person.nickname);
                    void onDemoPerson(person);
                  }}
                >
                  <Avatar name={person.nickname} />
                  {person.nickname}
                  <small>
                    {active
                      ? t("settings.demoActive")
                      : switching === person.nickname
                        ? t("common.loading")
                        : t(person.role === "organizer" ? "demo.organizer" : "demo.member")}
                  </small>
                </button>
              );
            })}
          </div>
        </div>
      )}
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
