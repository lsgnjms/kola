import { useState, type FormEvent } from "react";
import { useI18n } from "../i18n/index.js";
import { PIN_PATTERN } from "../keys/keystore.js";
import { PinField, Screen } from "../ui.js";

type Step = "welcome" | "create" | "confirm" | "working";

/** Welcome → choose PIN → confirm PIN → key is created on this device. */
export function Onboarding({ onCreate }: { onCreate: (pin: string) => Promise<void> }) {
  const { t } = useI18n();
  const [step, setStep] = useState<Step>("welcome");
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [problem, setProblem] = useState<"invalid" | "mismatch" | null>(null);

  if (step === "welcome") {
    return (
      <Screen title={t("onboarding.title")}>
        <p>{t("onboarding.body")}</p>
        <button type="button" className="primary" onClick={() => setStep("create")}>
          {t("onboarding.start")}
        </button>
      </Screen>
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
    <Screen title={t("pin.createTitle")}>
      <p>{t("pin.createHelp")}</p>
      <form onSubmit={submitCreate}>
        <PinField label={t("pin.label")} value={pin} onChange={setPin} autoFocus />
        {problem && (
          <p className="notice notice-error" role="alert">
            {t(problem === "invalid" ? "pin.invalid" : "pin.mismatch")}
          </p>
        )}
        <button type="submit" className="primary">
          {t("common.continue")}
        </button>
      </form>
    </Screen>
  ) : (
    <Screen title={t("pin.confirmTitle")} onBack={() => setStep("create")}>
      <form onSubmit={submitConfirm}>
        <PinField label={t("pin.label")} value={confirm} onChange={setConfirm} autoFocus />
        <button type="submit" className="primary">
          {t("common.continue")}
        </button>
      </form>
    </Screen>
  );
}
