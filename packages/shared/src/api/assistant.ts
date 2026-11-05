import { z } from "zod";

export const AssistantLocale = z.enum(["en", "fr"]);
export type AssistantLocale = z.infer<typeof AssistantLocale>;

export const AssistantRequest = z
  .object({
    question: z.string().trim().min(1).max(500),
    locale: AssistantLocale,
  })
  .strict();
export type AssistantRequest = z.infer<typeof AssistantRequest>;

export const AssistantResponse = z.object({ answer: z.string().min(1).max(2000) });
export type AssistantResponse = z.infer<typeof AssistantResponse>;

/** `ai` when the server has an API key; otherwise the app answers from templates only. */
export const HealthResponse = z.object({
  status: z.literal("ok"),
  assistant: z.enum(["ai", "templated"]),
});

/** Regtest demo people offered on the welcome screen (DEMO_MODE only). Backup codes use the published PIN. */
export const DemoPerson = z.object({
  nickname: z.string(),
  role: z.enum(["organizer", "member"]),
  backup: z.string().startsWith("ncryptsec1"),
});
export type DemoPerson = z.infer<typeof DemoPerson>;

export const DemoPeopleResponse = z.object({ people: z.array(DemoPerson) });
