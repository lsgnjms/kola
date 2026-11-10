import { z } from "zod";

/** Local currencies Kola can show next to sats. Indicative only; never used for money decisions. */
export const FiatCurrency = z.enum(["XOF", "NGN"]);
export type FiatCurrency = z.infer<typeof FiatCurrency>;

/** Price of one whole bitcoin in each currency the server could fetch. */
export const FiatRates = z.object({ XOF: z.number().positive().optional(), NGN: z.number().positive().optional() });
export type FiatRates = z.infer<typeof FiatRates>;

export const RatesResponse = z.object({ rates: FiatRates, fetchedAtMs: z.number().int().nonnegative() });
