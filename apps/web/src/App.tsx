import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { ApiClient } from "./api/client.js";
import { detectLocale, I18nContext, LOCALES, t as translate, type I18n, type Locale } from "./i18n/index.js";
import { idbStorage } from "./keys/idbStorage.js";
import { Keystore } from "./keys/keystore.js";
import { Home } from "./screens/Home.js";
import { Onboarding } from "./screens/Onboarding.js";
import { Pay } from "./screens/Pay.js";
import { Unlock } from "./screens/Unlock.js";
import { ErrorMessage, Screen } from "./ui.js";

const Receive = lazy(() => import("./screens/Receive.js"));
const CirclesSection = lazy(() => import("./screens/circles/CirclesSection.js"));

/** Lock again after this long in the background. */
const AUTO_LOCK_MS = 5 * 60 * 1000;

type Session =
  | { state: "loading" }
  | { state: "onboarding" }
  | { state: "locked" }
  | { state: "setup"; error?: unknown }
  | { state: "ready" };

type View = "home" | "receive" | "pay" | "circles";

const keystore = new Keystore(idbStorage);

export function App() {
  const [locale, setLocale] = useState<Locale>(detectLocale);
  const [session, setSession] = useState<Session>({ state: "loading" });
  const [view, setView] = useState<View>("home");

  const i18n = useMemo<I18n>(
    () => ({ locale, setLocale, t: (key, vars) => translate(locale, key, vars) }),
    [locale],
  );
  const { t } = i18n;

  const api = useMemo(
    () => new ApiClient({ baseUrl: `${location.origin}/api`, sign: (template) => keystore.sign(template) }),
    [],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
  }, [locale]);

  useEffect(() => {
    void keystore.status().then((s) => setSession({ state: s === "none" ? "onboarding" : "locked" }));
  }, []);

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
      setSession({ state: "ready" });
    } catch (error) {
      setSession({ state: "setup", error });
    }
  }, [api]);

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
            await setUpWallet();
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
    case "setup":
      content = (
        <Screen title={t("setup.working")}>
          {session.error === undefined ? (
            <p aria-busy="true">{t("common.loading")}</p>
          ) : (
            <>
              <ErrorMessage error={session.error} />
              <button type="button" className="primary" onClick={() => void setUpWallet()}>
                {t("common.retry")}
              </button>
            </>
          )}
        </Screen>
      );
      break;
    case "ready":
      content =
        view === "circles" ? (
          <Suspense fallback={<p aria-busy="true">{t("common.loading")}</p>}>
            <CirclesSection api={api} />
          </Suspense>
        ) : view === "receive" ? (
          <Suspense fallback={<p aria-busy="true">{t("common.loading")}</p>}>
            <Receive api={api} onDone={() => setView("home")} />
          </Suspense>
        ) : view === "pay" ? (
          <Pay api={api} onDone={() => setView("home")} />
        ) : (
          <Home api={api} onReceive={() => setView("receive")} onPay={() => setView("pay")} onLock={lock} />
        );
      break;
  }

  return (
    <I18nContext.Provider value={i18n}>
      <main className="screen">
        <header className="header">
          <h1>{t("app.name")}</h1>
          <select aria-label={t("app.language")} value={locale} onChange={(e) => setLocale(e.target.value as Locale)}>
            {LOCALES.map((l) => (
              <option key={l} value={l}>
                {l.toUpperCase()}
              </option>
            ))}
          </select>
        </header>
        {session.state === "ready" && (
          <nav className="tabs" aria-label={t("app.name")}>
            <button type="button" aria-current={view !== "circles" ? "page" : undefined} onClick={() => setView("home")}>
              {t("nav.wallet")}
            </button>
            <button type="button" aria-current={view === "circles" ? "page" : undefined} onClick={() => setView("circles")}>
              {t("nav.circles")}
            </button>
          </nav>
        )}
        {content}
      </main>
    </I18nContext.Provider>
  );
}
