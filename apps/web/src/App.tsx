import { useState } from "react";
import { detectLocale, LOCALES, t, type Locale } from "./i18n/index.js";

export function App() {
  const [locale, setLocale] = useState<Locale>(detectLocale);

  return (
    <main className="screen">
      <header className="header">
        <h1>{t(locale, "app.name")}</h1>
        <select
          aria-label={t(locale, "app.language")}
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
      <p>{t(locale, "app.tagline")}</p>
    </main>
  );
}
