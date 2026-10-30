import { describe, expect, it } from "vitest";
import { loadEnv } from "./env.js";
import { buildServer } from "./server.js";

describe("server", () => {
  it("reports health and runs without an AI key", async () => {
    const app = await buildServer(loadEnv({ LOG_LEVEL: "fatal", DB_PATH: ":memory:" }));
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok", assistant: "templated" });
    await app.close();
  });
});

describe("loadEnv", () => {
  it("names bad variables without echoing values", () => {
    expect(() => loadEnv({ API_PORT: "not-a-port-secret" })).toThrow(/API_PORT/);
    expect(() => loadEnv({ API_PORT: "not-a-port-secret" })).not.toThrow(/secret/);
  });
});
