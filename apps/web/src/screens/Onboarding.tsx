import type { DemoPerson } from "@kola/shared";
import { useState, type FormEvent } from "react";
import { useI18n } from "../i18n/index.js";
import { Logo, Receipt, Shield, Users } from "../icons.js";
import { PIN_PATTERN } from "../keys/keystore.js";
import { Avatar, PinField, Screen } from "../ui.js";

type Step = "welcome" | "create" | "confirm" | "working";

/** Welcome → choose PIN → confirm PIN → key is created on this device. Or: one tap as a demo person. */
export function Onboarding({
  onCreate,
  onRestore,
  demoPeople,
  onDemoPerson,
}: {
  onCreate: (pin: string) => Promise<void>;
  onRestore: () => void;
  demoPeople: DemoPerson[];
  onDemoPerson: (person: DemoPerson) => Promise<void>;
}) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("welcome");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<"invalid" | "mismatch" | null>(null);

  if (step === "welcome") {
    const benefits = [
      { icon: <Shield />, title: t("welcome.b1Title"), body: t("welcome.b1") },
      { icon: <Users />, title: t("welcome.b2Title"), body: t("welcome.b2") },
      { icon: <Receipt />, title: t("welcome.b3Title"), body: t("welcome.b3") },
    ];
    return (
      <section className="welcome">
        <div className="welcome-hero">
          <Logo size={72} />
          <h2>{t("welcome.title")}</h2>
          <p>{t("welcome.body")}</p>
        </div>

        <div className="card">
          {benefits.map((b) => (
            <div key={b.title} className="benefit">
              <span className="benefit-icon">{b.icon}</span>
              <p>
                <strong>{b.title}</strong>
                <span>{b.body}</span>
              </p>
            </div>
          ))}
        </div>

        <button type="button" className="primary" onClick={() => setStep("create")}>
          {t("onboarding.start")}
        </button>
        <button type="button" className="ghost" onClick={onRestore}>
          {t("restore.start")}
        </button>

        {demoPeople.length > 0 && (
          <div className="card">
            <h3>{t("demo.title")}</h3>
            <p className="hint">{t("demo.body")}</p>
            <div className="people">
              {demoPeople.map((person) => (
                <button
                  key={person.nickname}
                  type="button"
                  className="person"
                  onClick={() => {
                    setStep("working");
                    void onDemoPerson(person);
                  }}
                >
                  <Avatar name={person.nickname} />
                  {person.nickname}
                  <small>{t(person.role === "organizer" ? "demo.organizer" : "demo.member")}</small>
                </button>
              ))}
            </div>
            <p className="hint center">{t("demo.pinNote")}</p>
          </div>
        )}
      </section>
    );
  }

  if (step === "working") {
    return (
      <Screen title={t("setup.working")}>
        <p aria-busy="true">{t("common.loading")}</p>
      </Screen>
    );
  }

  const submitCreate = (e: FormEvent) => {
    e.preventDefault();
    if (!PIN_PATTERN.test(pin)) return setProblem("invalid");
    setProblem(null);
    setStep("confirm");
  };

  const submitConfirm = async (e: FormEvent) => {
    e.preventDefault();
    if (confirm !== pin) {
      setPin("");
      setConfirm("");
      setProblem("mismatch");
      setStep("create");
      return;
    }
    setStep("working");
    await onCreate(pin);
  };

  return step === "create" ? (
    <Screen title={t("pin.createTitle")} onBack={() => setStep("welcome")}>
      <p className="hint">{t("pin.createHelp")}</p>
      <form onSubmit={submitCreate} className="card">
        <PinField label={t("pin.label")} value={pin} onChange={setPin} autoFocus />
        {problem && (
          <p className="notice notice-error" role="alert">
            {t(problem === "invalid" ? "pin.invalid" : "pin.mismatch")}
          </p>
        )}
        <button type="submit" className="primary" disabled={pin.length !== 6}>
          {t("common.continue")}
        </button>
      </form>
    </Screen>
  ) : (
    <Screen title={t("pin.confirmTitle")} onBack={() => setStep("create")}>
      <form onSubmit={submitConfirm} className="card">
        <PinField label={t("pin.label")} value={confirm} onChange={setConfirm} autoFocus />
        <button type="submit" className="primary" disabled={confirm.length !== 6}>
          {t("common.continue")}
        </button>
      </form>
    </Screen>
  );
}
