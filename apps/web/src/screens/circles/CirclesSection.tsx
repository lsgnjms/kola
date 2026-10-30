import { useState } from "react";
import type { ApiClient } from "../../api/client.js";
import { CircleDetail } from "./CircleDetail.js";
import { CircleList } from "./CircleList.js";
import { CreateCircle } from "./CreateCircle.js";
import { JoinCircle } from "./JoinCircle.js";

type Route = { name: "list" } | { name: "create" } | { name: "join" } | { name: "detail"; id: string };

/** Lazy-loaded: the circles screens aren't part of the first download. */
export default function CirclesSection({ api }: { api: ApiClient }) {
  const [route, setRoute] = useState<Route>({ name: "list" });
  const toList = () => setRoute({ name: "list" });
  const toDetail = (id: string) => setRoute({ name: "detail", id });

  switch (route.name) {
    case "create":
      return <CreateCircle api={api} onBack={toList} onCreated={toDetail} />;
    case "join":
      return <JoinCircle api={api} onBack={toList} onJoined={toDetail} />;
    case "detail":
      return <CircleDetail api={api} id={route.id} onBack={toList} />;
    case "list":
      return (
        <CircleList
          api={api}
          onOpen={toDetail}
          onCreate={() => setRoute({ name: "create" })}
          onJoin={() => setRoute({ name: "join" })}
        />
      );
  }
}
