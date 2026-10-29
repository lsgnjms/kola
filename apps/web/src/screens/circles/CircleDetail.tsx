import type { CircleView, ContributeResponse } from "@kola/shared";
import { useCallback, useEffect, useState } from "react";
import type { ApiClient } from "../../api/client.js";
import { copyText } from "../../clipboard.js";
import { formatSat } from "../../format.js";
import { useI18n } from "../../i18n/index.js";
import { ErrorMessage, Screen } from "../../ui.js";
import { canPay, canStartRound, formatCountdown, isLive, memberAt, myContribution, nextRoundNumber } from "./model.js";

/** Refresh while a round is moving; a GET every few seconds is cheap on 3G. */
const LIVE_REFRESH_MS = 3000;

export function CircleDetail({ api, id, onBack }: { api: ApiClient; id: string; onBack: () => void }) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<CircleView | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [contributed, setContributed] = useState<ContributeResponse["status"] | null>(null);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(Date.now());

  const load = useCallback(async () => {
    try {
      setView(await api.getCircle(id));
    } catch (err) {
      setError(err);
    }
  }, [api, id]);

  useEffect(() => {
    void load();
  }, [load]);

  const live = view !== null && (isLive(view) || view.status === "forming");
  useEffect(() => {
    if (!live) return;
    const refresh = setInterval(() => void load(), LIVE_REFRESH_MS);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      clearInterval(refresh);
      clearInterval(clock);
    };
  }, [live, load]);

  const act = async (action: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  if (!view) {
    return (
      <Screen title={t("circles.title")} onBack={onBack}>
        {error !== null ? <ErrorMessage error={error} /> : <p aria-busy="true">{t("common.loading")}</p>}
      </Screen>
    );
  }

  const cycle = view.currentCycle;
  const recipient = cycle ? memberAt(view, cycle.recipientPosition) : null;
  const sats = (amount: number) => formatSat(locale, amount);
  const contributionLabel = {
    unpaid: t("contrib.unpaid"),
    held: t("contrib.held"),
    paid: t("contrib.paid"),
    refunded: t("contrib.refunded"),
  };

  return (
    <Screen title={view.name} onBack={onBack}>
      <p>
        {t("circles.summary", {
          amount: sats(view.contributionSat),
          joined: view.members.length,
          total: view.memberCount,
        })}
      </p>

      {view.status === "forming" && (
        <div className="notice">
          <p>{t("circle.waiting", { count: view.memberCount - view.members.length })}</p>
          <p>{t("circle.invite")}</p>
          <p className="code big">{view.joinCode}</p>
          {view.isCreator && <p>{t("circle.notReady")}</p>}
          <button type="button" className="secondary" onClick={() => void copyText(view.joinCode).then(setCopied)}>
            {copied ? t("common.copied") : t("common.copy")}
          </button>
        </div>
      )}

      {cycle && recipient && (
        <section className="round" aria-live="polite">
          <h3>{t("circle.round", { n: cycle.cycleIndex + 1, total: view.memberCount })}</h3>
          <p>{t("circle.recipient", { name: recipient.nickname, amount: sats(cycle.potSat) })}</p>
          <p className="round-state">
            {cycle.state === "paid_out"
              ? t("circle.state.paid_out", { name: recipient.nickname, amount: sats(cycle.potSat) })
              : cycle.state === "paying_out"
                ? t("circle.state.paying_out", { name: recipient.nickname })
                : t(`circle.state.${cycle.state}`)}
          </p>
          {cycle.state === "collecting" && (
            <p className="countdown">{t("circle.timeLeft", { time: formatCountdown(cycle.deadlineMs - now) })}</p>
          )}
          <ul className="contributions">
            {cycle.contributions.map((c) => (
              <li key={c.position} className={`contrib contrib-${c.status}`}>
                <span>{memberAt(view, c.position)?.nickname}</span>
                <span>{contributionLabel[c.status]}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {canPay(view, now) && (
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              const res = await api.contribute(view.id);
              setContributed(res.status);
              await load();
            })
          }
        >
          {busy ? t("circle.paying") : t("circle.payShare", { amount: sats(view.contributionSat) })}
        </button>
      )}
      {contributed && cycle?.state === "collecting" && myContribution(view) !== "unpaid" && (
        <p className="notice" role="status">
          {t("circle.shareHeld")}
        </p>
      )}
      {contributed === "pending" && myContribution(view) === "unpaid" && (
        <p className="notice" role="status">
          {t("circle.sharePending")}
        </p>
      )}

      {canStartRound(view) && (
        <button
          type="button"
          className="primary"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              setContributed(null);
              setView(await api.openRound(view.id));
            })
          }
        >
          {t("circle.startRound", { n: nextRoundNumber(view) })}
        </button>
      )}
      {view.status === "active" && !view.isCreator && !isLive(view) && <p>{t("circle.waitOrganizer")}</p>}
      {view.status === "completed" && <p className="notice">{t("circle.complete")}</p>}
      {error !== null && <ErrorMessage error={error} />}

      <h3>{t("circle.members")}</h3>
      <ol className="members">
        {view.members.map((m) => (
          <li key={m.position} className={cycle?.recipientPosition === m.position && isLive(view) ? "current" : ""}>
            <span>
              {m.nickname}
              {m.isYou && ` (${t("circle.you")})`}
              {m.isCreator && ` · ${t("circle.organizer")}`}
            </span>
            <small>{t("circle.receivesRound", { n: m.position + 1 })}</small>
          </li>
        ))}
      </ol>
    </Screen>
  );
}
