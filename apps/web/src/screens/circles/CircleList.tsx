import type { CircleSummary } from "@kola/shared";
import { useEffect, useState } from "react";
import type { ApiClient } from "../../api/client.js";
import { formatSat } from "../../format.js";
import { useI18n } from "../../i18n/index.js";
import { ErrorMessage, Screen } from "../../ui.js";

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
      {error !== null && <ErrorMessage error={error} />}
      {circles === null && error === null && <p aria-busy="true">{t("common.loading")}</p>}
      {circles?.length === 0 && <p>{t("circles.empty")}</p>}
      <ul className="cards">
        {circles?.map((c) => (
          <li key={c.id}>
            <button type="button" className="card" onClick={() => onOpen(c.id)}>
              <strong>{c.name}</strong>
              <span>
                {t("circles.summary", {
                  amount: formatSat(locale, c.contributionSat),
                  joined: c.membersJoined,
                  total: c.memberCount,
                })}
              </span>
              <span className={`badge badge-${c.status}`}>{t(`circles.status.${c.status}`)}</span>
            </button>
          </li>
        ))}
      </ul>
      <div className="actions">
        <button type="button" className="primary" onClick={onCreate}>
          {t("circles.create")}
        </button>
        <button type="button" className="secondary" onClick={onJoin}>
          {t("circles.join")}
        </button>
      </div>
    </Screen>
  );
}
