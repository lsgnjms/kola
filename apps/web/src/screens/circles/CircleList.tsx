import type { CircleSummary } from "@kola/shared";
import { useEffect, useState, type CSSProperties } from "react";
import type { ApiClient } from "../../api/client.js";
import { formatSat } from "../../format.js";
import { useI18n } from "../../i18n/index.js";
import { ChevronRight, Key, Plus, Users } from "../../icons.js";
import { ActionButton, ErrorMessage, Screen } from "../../ui.js";

export function CircleList({
  api,
  onOpen,
  onCreate,
  onJoin,
}: {
  api: ApiClient;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onJoin: () => void;
}) {
  const { t, locale } = useI18n();
  const [circles, setCircles] = useState<CircleSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .listCircles()
      .then((res) => setCircles(res.circles))
      .catch(setError);
  }, [api]);

  return (
    <Screen title={t("circles.title")}>
      <div className="actions-row" style={{ "--cols": 2 } as CSSProperties}>
        <ActionButton icon={<Plus />} label={t("circles.create")} onClick={onCreate} />
        <ActionButton icon={<Key />} label={t("circles.join")} onClick={onJoin} />
      </div>

      {error !== null && <ErrorMessage error={error} />}
      {circles === null && error === null && <p aria-busy="true">{t("common.loading")}</p>}
      {circles?.length === 0 && (
        <div className="card empty">
          <span className="empty-icon">
            <Users />
          </span>
          <p>{t("circles.empty")}</p>
        </div>
      )}

      {circles?.map((c) => (
        <button key={c.id} type="button" className="card circle-card" onClick={() => onOpen(c.id)}>
          <span className="circle-card-top">
            <span className="recipient">
              <span className="benefit-icon">
                <Users size={20} />
              </span>
              <strong>{c.name}</strong>
            </span>
            <span className={`pill ${c.status === "active" ? "pill-ok" : c.status === "forming" ? "pill-wait" : ""}`}>
              {t(`circles.status.${c.status}`)}
            </span>
          </span>
          <span className="row-sub">
            {t("circles.summary", {
              amount: formatSat(locale, c.contributionSat),
              joined: c.membersJoined,
              total: c.memberCount,
            })}
          </span>
          <span className="progress" aria-hidden="true">
            <span style={{ width: `${(c.membersJoined / c.memberCount) * 100}%` }} />
          </span>
          <span className="circle-card-top">
            <span className="muted">{t("circles.potEach", { amount: formatSat(locale, c.contributionSat * c.memberCount) })}</span>
            <ChevronRight size={20} />
          </span>
        </button>
      ))}
    </Screen>
  );
}
