import type { DemoPerson } from "@kola/shared";
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ApiClient, ApiError } from "./api/client.js";
import {
  detectLocale,
  I18nContext,
  loadLocale,
  LOCALES,
  rememberLocale,
  t as translate,
  type I18n,
  type Locale,
} from "./i18n/index.js";
import { Logo, Settings as SettingsIcon, Users, Wallet } from "./icons.js";
import { idbStorage } from "./keys/idbStorage.js";
import { Keystore } from "./keys/keystore.js";
import { Backup } from "./screens/Backup.js";
import { Home } from "./screens/Home.js";
import { Onboarding } from "./screens/Onboarding.js";
import { Pay } from "./screens/Pay.js";
import { Restore } from "./screens/Restore.js";
import { Settings } from "./screens/Settings.js";
import { Unlock } from "./screens/Unlock.js";
import { ErrorMessage, Screen } from "./ui.js";

const Receive = lazy(() => import("./screens/Receive.js"));
const CirclesSection = lazy(() => import("./screens/circles/CirclesSection.js"));

/** Lock again after this long in the background. */
const AUTO_LOCK_MS = 5 * 60 * 1000;
const ACTIVE_DEMO_KEY = "kola.activeDemo";

function readActiveDemo(): string | null {
  try {
    return localStorage.getItem(ACTIVE_DEMO_KEY);
  } catch {
    return null;
  }
}

/** The published PIN of the regtest demo people. */
const DEMO_PIN = "123456";

type Session =
  | { state: "loading" }
  | { state: "onboarding" }
  | { state: "restoring" }
  | { state: "locked" }
  | { state: "setup"; error?: unknown }
  | { state: "ready" };

type Tab = "wallet" | "circles" | "settings";
type View = "home" | "receive" | "pay" | "circles" | "settings" | "backup";

const TAB_OF: Record<View, Tab> = {
  home: "wallet",
  receive: "wallet",
  pay: "wallet",
  circles: "circles",
  settings: "settings",
  backup: "settings",
};

const keystore = new Keystore(idbStorage);

export function App() {
  const [locale, setLocaleState] = useState<Locale>("en");
  const [session, setSession] = useState<Session>({ state: "loading" });
  const [view, setView] = useState<View>("home");
  // Bumped when the current tab is tapped again, which takes that tab back to its first screen.
  const [tabReset, setTabReset] = useState(0);
  const [demoPeople, setDemoPeople] = useState<DemoPerson[]>([]);
  const [activeDemo, setActiveDemo] = useState<string | null>(readActiveDemo);

  /** Which demo person this browser is playing, so Settings can mark them. Cleared for real keys. */
  const markDemo = (nickname: string | null) => {
    setActiveDemo(nickname);
    try {
      if (nickname) localStorage.setItem(ACTIVE_DEMO_KEY, nickname);
      else localStorage.removeItem(ACTIVE_DEMO_KEY);
    } catch {
      // Not remembered; only affects the marker in Settings.
    }
  };

  const setLocale = useCallback((next: Locale) => {
    rememberLocale(next);
    void loadLocale(next).then(() => setLocaleState(next));
  }, []);

  const i18n = useMemo<I18n>(
    () => ({ locale, setLocale, t: (key, vars) => translate(locale, key, vars) }),
    [locale, setLocale],
  );
  const { t } = i18n;

  const api = useMemo(
    () => new ApiClient({ baseUrl: `${location.origin}/api`, sign: (template) => keystore.sign(template) }),
    [],
  );

  useEffect(() => setLocale(detectLocale()), [setLocale]);

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    void keystore.status().then((s) => setSession({ state: s === "none" ? "onboarding" : "locked" }));
    void api.demoPeople().then(setDemoPeople);
  }, [api]);

  const lock = useCallback(() => {
    keystore.lock();
    setView("home");
    setSession({ state: "locked" });
  }, []);

  useEffect(() => {
    let hiddenAt = 0;
    const onVisibility = () => {
      if (document.hidden) hiddenAt = Date.now();
      else if (hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS) lock();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [lock]);

  /** Binds (or re-confirms) this key's demo wallet. Idempotent on the server. */
  const setUpWallet = useCallback(async () => {
    setSession({ state: "setup" });
    try {
      await api.claim();
      setView("home");
      setSession({ state: "ready" });
    } catch (error) {
      setSession({ state: "setup", error });
    }
  }, [api]);

  const openDemoPerson = async (person: DemoPerson) => {
    keystore.lock();
    if (await keystore.restore(person.backup, DEMO_PIN)) {
      markDemo(person.nickname);
      await setUpWallet();
    }
  };

  let content;
  switch (session.state) {
    case "loading":
      content = <p aria-busy="true">{t("common.loading")}</p>;
      break;
    case "onboarding":
      content = (
        <Onboarding
          onCreate={async (pin) => {
            await keystore.create(pin);
            markDemo(null);
            await setUpWallet();
          }}
          onRestore={() => setSession({ state: "restoring" })}
          demoPeople={demoPeople}
          onDemoPerson={openDemoPerson}
        />
      );
      break;
    case "restoring":
      content = (
        <Restore
          onBack={() =>
            void keystore.status().then((s) => (s === "none" ? setSession({ state: "onboarding" }) : setUpWallet()))
          }
          onRestore={async (backup, pin) => {
            const ok = await keystore.restore(backup, pin);
            if (ok) markDemo(null);
            if (ok) await setUpWallet();
            return ok;
          }}
        />
      );
      break;
    case "locked":
      content = (
        <Unlock
          onUnlock={async (pin) => {
            const result = await keystore.unlock(pin);
            if (result.ok) await setUpWallet();
            return result;
          }}
        />
      );
      break;
    case "setup": {
      // This key has no wallet to lose, so swapping it for a demo person or a backup is safe.
      const full = session.error instanceof ApiError && session.error.code === "no_wallet_available";
      content = (
        <Screen title={t("setup.working")}>
          {session.error === undefined ? (
            <p aria-busy="true">{t("common.loading")}</p>
          ) : (
            <>
              <ErrorMessage error={session.error} />
              {full && demoPeople.length > 0 && (
                <button type="button" className="primary" onClick={() => setSession({ state: "onboarding" })}>
                  {t("setup.tryDemo")}
                </button>
              )}
              <button type="button" className={full ? "secondary" : "primary"} onClick={() => void setUpWallet()}>
                {t("common.retry")}
              </button>
              {full && (
                <button type="button" className="ghost" onClick={() => setSession({ state: "restoring" })}>
                  {t("restore.start")}
                </button>
              )}
            </>
          )}
        </Screen>
      );
      break;
    }
    case "ready":
      content =
        view === "circles" ? (
          <Suspense fallback={<p aria-busy="true">{t("common.loading")}</p>}>
            <CirclesSection key={tabReset} api={api} />
          </Suspense>
        ) : view === "receive" ? (
          <Suspense fallback={<p aria-busy="true">{t("common.loading")}</p>}>
            <Receive api={api} onDone={() => setView("home")} />
          </Suspense>
        ) : view === "pay" ? (
          <Pay api={api} onDone={() => setView("home")} />
        ) : view === "settings" ? (
          <Settings
            onBackup={() => setView("backup")}
            onLock={lock}
            demoPeople={demoPeople}
            activeDemo={activeDemo}
            onDemoPerson={openDemoPerson}
          />
        ) : view === "backup" ? (
          <Backup keystore={keystore} onDone={() => setView("settings")} />
        ) : (
          <Home
            api={api}
            onReceive={() => setView("receive")}
            onPay={() => setView("pay")}
            onCircles={() => setView("circles")}
          />
        );
      break;
  }

  const tabs: { tab: Tab; view: View; label: string; icon: JSX.Element }[] = [
    { tab: "wallet", view: "home", label: t("nav.wallet"), icon: <Wallet /> },
    { tab: "circles", view: "circles", label: t("nav.circles"), icon: <Users /> },
    { tab: "settings", view: "settings", label: t("nav.settings"), icon: <SettingsIcon /> },
  ];

  return (
    <I18nContext.Provider value={i18n}>
      <div className="app">
        <header className="topbar">
          <span className="brand">
            <Logo size={30} />
            {t("app.name")}
          </span>
          <select
            className="lang"
            aria-label={t("app.language")}
            value={locale}
            onChange={(e) => setLocale(e.target.value as Locale)}
          >
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        </header>
        <main>{content}</main>
      </div>
      {session.state === "ready" && (
        <nav className="tabbar" aria-label={t("app.name")}>
          <div className="tabbar-inner">
            {tabs.map(({ tab, view: target, label, icon }) => (
              <button
                key={tab}
                type="button"
                className="tab"
                aria-current={TAB_OF[view] === tab ? "page" : undefined}
                onClick={() => {
                  if (TAB_OF[view] === tab) setTabReset((n) => n + 1);
                  setView(target);
                }}
              >
                {icon}
                {label}
              </button>
            ))}
          </div>
        </nav>
      )}
    </I18nContext.Provider>
  );
}
