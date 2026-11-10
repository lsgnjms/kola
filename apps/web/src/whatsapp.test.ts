import { describe, expect, it } from "vitest";
import { whatsappUrl } from "./whatsapp.js";

describe("whatsappUrl", () => {
  it("encodes the whole message, including line breaks and symbols", () => {
    expect(whatsappUrl("Code: DAKAR2 & 10,000 sats\nhttps://x/?a=1")).toBe(
      "https://wa.me/?text=Code%3A%20DAKAR2%20%26%2010%2C000%20sats%0Ahttps%3A%2F%2Fx%2F%3Fa%3D1",
    );
  });
});
