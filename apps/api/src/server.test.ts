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

describe("rate limiting behind the local proxy", () => {
  it("counts each forwarded visitor separately", async () => {
    const app = await buildServer(loadEnv({ LOG_LEVEL: "fatal", DB_PATH: ":memory:" }));
    const hit = (ip: string) =>
      app.inject({ method: "GET", url: "/health", remoteAddress: "127.0.0.1", headers: { "x-forwarded-for": ip } });
    for (let i = 0; i < 100; i++) expect((await hit("203.0.113.1")).statusCode).toBe(200);
    expect((await hit("203.0.113.1")).statusCode).toBe(429);
    expect((await hit("203.0.113.2")).statusCode).toBe(200);
    await app.close();
  });
});

describe("loadEnv", () => {
  it("names bad variables without echoing values", () => {
    expect(() => loadEnv({ API_PORT: "not-a-port-secret" })).toThrow(/API_PORT/);
    expect(() => loadEnv({ API_PORT: "not-a-port-secret" })).not.toThrow(/secret/);
  });
});
