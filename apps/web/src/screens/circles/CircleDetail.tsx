import type { CircleView, ContributeResponse } from "@kola/shared";
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import type { ApiClient } from "../../api/client.js";
import { copyText } from "../../clipboard.js";
import { formatSat } from "../../format.js";
import { useI18n } from "../../i18n/index.js";
import { Check, Clock, Copy, Receipt, Share, Sparkles } from "../../icons.js";
import { ActionButton, Avatar, ErrorMessage, Screen, Fiat, WhatsAppButton } from "../../ui.js";
import { canPay, canStartRound, formatCountdown, isLive, memberAt, myContribution, nextRoundNumber } from "./model.js";

const AuditLog = lazy(() => import("./AuditLog.js"));
const Assistant = lazy(() => import("./Assistant.js"));

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

  const [showRecord, setShowRecord] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const joinRecordTried = useRef(false);

  const load = useCallback(async () => {
    try {
      const next = await api.getCircle(id);
      setView(next);
      // Add our signed agreement to the record. Quietly retried next visit: it never blocks money.
      if (!next.joinRecorded && !joinRecordTried.current) {
        joinRecordTried.current = true;
        await api.recordJoin(next).catch(() => undefined);
      }
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

  const potSat = view.contributionSat * view.memberCount;
  const nextPosition = (nextRoundNumber(view) - 1) % view.memberCount;
  const paidCount = cycle?.contributions.filter((c) => c.status === "held" || c.status === "paid").length ?? 0;
  const roundLive = cycle !== null && isLive(view);
  // During a round: its recipient. Between rounds: whoever is next in the rotation, not last round's.
  const heroMember = roundLive ? recipient : memberAt(view, nextPosition);
  const pill = { unpaid: "pill-wait", held: "pill-ok", paid: "pill-ok", refunded: "" } as const;

  return (
    <Screen title={view.name} onBack={onBack}>
      <div className="hero" aria-live="polite">
        <span className="hero-label">{t("circle.potLabel")}</span>
        <span className="hero-amount">
          {sats(cycle?.potSat ?? potSat)}
          <span className="hero-unit">sats</span>
        </span>
        <Fiat amountSat={cycle?.potSat ?? potSat} className="hero-fiat" />
        <span className="hero-label">
          {t("circles.summary", { amount: sats(view.contributionSat), joined: view.members.length, total: view.memberCount })}
        </span>
        {view.status !== "forming" && view.status !== "completed" && heroMember && (
          <div className="hero-row">
            <span className="recipient">
              <Avatar name={heroMember.nickname} />
              <span>
                <strong>{heroMember.nickname}</strong>
                <br />
                <small>
                  {roundLive
                    ? t("circle.round", { n: (cycle?.cycleIndex ?? 0) + 1, total: view.memberCount })
                    : t("circle.nextUp", { n: nextRoundNumber(view) })}
                </small>
              </span>
            </span>
            {cycle?.state === "collecting" && (
              <span className="chip countdown">
                <Clock size={14} />
                {formatCountdown(cycle.deadlineMs - now)}
              </span>
            )}
          </div>
        )}
        {roundLive && cycle && (
          <div className="progress" style={{ marginTop: "0.75rem" }} aria-hidden="true">
            <span style={{ width: `${(paidCount / view.memberCount) * 100}%` }} />
          </div>
        )}
      </div>

      {view.status === "forming" && (
        <div className="card">
          <h3>{t("circle.inviteTitle")}</h3>
          <p className="hint">
            {t("circle.waiting", { count: view.memberCount - view.members.length })} {t("circle.invite")}
          </p>
          <p className="code-box">{view.joinCode}</p>
          <button type="button" className="secondary" onClick={() => void copyText(view.joinCode).then(setCopied)}>
            <Copy size={20} />
            {copied ? t("common.copied") : t("common.copy")}
          </button>
          <WhatsAppButton
            text={t("circle.inviteMessage", {
              name: view.name,
              amount: sats(view.contributionSat),
              code: view.joinCode,
              url: location.origin,
            })}
          />
          {view.isCreator && <p className="hint">{t("circle.notReady")}</p>}
        </div>
      )}

      {cycle && recipient && (
        <div className="card">
          <div className="section-head" style={{ marginTop: 0 }}>
            <h3>{t("circle.round", { n: cycle.cycleIndex + 1, total: view.memberCount })}</h3>
            <span className="muted">{t("circle.paidCount", { paid: paidCount, total: view.memberCount })}</span>
          </div>
          <p className="hint">
            {cycle.state === "paid_out"
              ? t("circle.state.paid_out", { name: recipient.nickname, amount: sats(cycle.potSat) })
              : cycle.state === "paying_out"
                ? t("circle.state.paying_out", { name: recipient.nickname })
                : t(`circle.state.${cycle.state}`)}
          </p>
          <ul className="list">
            {cycle.contributions.map((c) => {
              const member = memberAt(view, c.position);
              return (
                <li key={c.position} className="row">
                  <Avatar name={member?.nickname ?? "?"} small />
                  <span className="row-main">
                    <span className="row-title">
                      {member?.nickname}
                      {member?.isYou && <span className="muted"> ({t("circle.you")})</span>}
                    </span>
                  </span>
                  <span className={`pill ${pill[c.status]}`}>{contributionLabel[c.status]}</span>
                </li>
              );
            })}
          </ul>
        </div>
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
        <p className="notice notice-ok" role="status">
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
      {view.status === "active" && !view.isCreator && !isLive(view) && (
        <p className="notice">{t("circle.waitOrganizer")}</p>
      )}
      {view.status === "completed" && <p className="notice notice-ok">{t("circle.complete")}</p>}
      {error !== null && <ErrorMessage error={error} />}

      <div className="actions-row">
        <ActionButton
          icon={<Sparkles />}
          label={t("circle.actionAsk")}
          onClick={() => {
            setShowAssistant((s) => !s);
            setShowRecord(false);
          }}
        />
        <ActionButton
          icon={<Receipt />}
          label={t("circle.actionRecord")}
          onClick={() => {
            setShowRecord((s) => !s);
            setShowAssistant(false);
          }}
        />
        <ActionButton
          icon={copied ? <Check /> : <Share />}
          label={copied ? t("common.copied") : t("circle.actionInvite")}
          onClick={() => void copyText(view.joinCode).then(setCopied)}
        />
      </div>
      {showAssistant && (
        <Suspense fallback={<p aria-busy="true">{t("common.loading")}</p>}>
          <Assistant api={api} view={view} />
        </Suspense>
      )}
      {showRecord && (
        <Suspense fallback={<p aria-busy="true">{t("common.loading")}</p>}>
          <AuditLog view={view} />
        </Suspense>
      )}

      <h3>{t("circle.members")}</h3>
      <div className="card card-flush">
        <ol className="list timeline">
          {view.members.map((m) => {
            const received = m.position < view.completedCycles;
            const current = roundLive && cycle?.recipientPosition === m.position;
            return (
              <li key={m.position} className={current ? "row current" : "row"}>
                <Avatar name={m.nickname} small />
                <span className="row-main">
                  <span className="row-title">
                    {m.nickname}
                    {m.isYou && <small> · {t("circle.you")}</small>}
                    {m.isCreator && <small> · {t("circle.organizer")}</small>}
                  </span>
                  <span className="row-sub">{t("circle.receivesRound", { n: m.position + 1 })}</span>
                </span>
                {received && <span className="pill pill-ok">{t("circle.received")}</span>}
                {current && <span className="pill pill-wait">{t("circle.thisRound")}</span>}
              </li>
            );
          })}
        </ol>
      </div>
    </Screen>
  );
}
