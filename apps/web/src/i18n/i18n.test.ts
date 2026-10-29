import { ApiErrorCode } from "@kola/shared";
import { describe, expect, it } from "vitest";
import en from "./en.json";
import fr from "./fr.json";
import { t } from "./index.js";

const placeholders = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();

describe("i18n", () => {
  it("has the same keys in every language", () => {
    expect(Object.keys(fr).sort()).toEqual(Object.keys(en).sort());
  });

  it("uses the same placeholders in every language", () => {
    for (const [key, value] of Object.entries(en)) {
      expect(placeholders(fr[key as keyof typeof fr]), key).toEqual(placeholders(value));
    }
  });

  it("has a message for every API error code", () => {
    for (const code of [...ApiErrorCode.options, "network"]) {
      expect(en, code).toHaveProperty(`errors.${code}`);
    }
  });

  it("keeps jargon out of user-facing copy", () => {
    const jargon = /\b(htlc|preimage|macaroon|invoice|nostr|lnd|bolt11|nsec)\b/i;
    for (const [key, value] of [...Object.entries(en), ...Object.entries(fr)]) {
      expect(value, key).not.toMatch(jargon);
    }
  });

  it("fills placeholders", () => {
    expect(t("fr", "common.sats", { amount: "1 000" })).toBe("1 000 sats");
  });
});
