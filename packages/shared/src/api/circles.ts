import { z } from "zod";
import { CycleState, MAX_MEMBERS, MIN_MEMBERS, PubkeyHex } from "../schemas.js";

/** Pseudonymous name shown to the circle. Stored on the server only, never published. */
export const Nickname = z.string().trim().min(1).max(24);

export const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export const JoinCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NP-Z2-9]{6}$/);

export const CreateCircleRequest = z
  .object({
    name: z.string().trim().min(1).max(60),
    contributionSat: z.number().int().positive(),
    memberCount: z.number().int().min(MIN_MEMBERS).max(MAX_MEMBERS),
    nickname: Nickname,
  })
  .strict();
export type CreateCircleRequest = z.infer<typeof CreateCircleRequest>;

export const JoinCircleRequest = z.object({ joinCode: JoinCode, nickname: Nickname }).strict();
export type JoinCircleRequest = z.infer<typeof JoinCircleRequest>;

export const CircleStatus = z.enum(["forming", "active", "completed"]);

/** A member's share in a cycle, in plain terms. */
export const ContributionStatus = z.enum(["unpaid", "held", "paid", "refunded"]);
export type ContributionStatus = z.infer<typeof ContributionStatus>;

export const CircleMemberView = z.object({
  position: z.number().int().nonnegative(),
  pubkey: PubkeyHex,
  nickname: z.string(),
  isYou: z.boolean(),
  isCreator: z.boolean(),
});

export const CycleView = z.object({
  /** 0-based round number. */
  cycleIndex: z.number().int().nonnegative(),
  attempt: z.number().int().positive(),
  state: CycleState,
  recipientPosition: z.number().int().nonnegative(),
  deadlineMs: z.number().int(),
  potSat: z.number().int().positive(),
  contributions: z.array(z.object({ position: z.number().int().nonnegative(), status: ContributionStatus })),
});
export type CycleView = z.infer<typeof CycleView>;

export const CircleView = z.object({
  id: z.string().uuid(),
  name: z.string(),
  contributionSat: z.number().int().positive(),
  memberCount: z.number().int(),
  status: CircleStatus,
  joinCode: z.string(),
  isCreator: z.boolean(),
  /** Signs the circle's public record. */
  coordinatorPubkey: PubkeyHex,
  /** This member's signed agreement to the rules is in the public record. */
  joinRecorded: z.boolean(),
  members: z.array(CircleMemberView),
  completedCycles: z.number().int().nonnegative(),
  currentCycle: CycleView.nullable(),
});
export type CircleView = z.infer<typeof CircleView>;

/** A member's signed `circle_joined` event. Checked in full by the API before it is published. */
export const RecordJoinRequest = z.object({ event: z.unknown() }).strict();

export const CircleSummary = z.object({
  id: z.string().uuid(),
  name: z.string(),
  contributionSat: z.number().int().positive(),
  memberCount: z.number().int(),
  membersJoined: z.number().int(),
  status: CircleStatus,
});
export type CircleSummary = z.infer<typeof CircleSummary>;

export const CircleListResponse = z.object({ circles: z.array(CircleSummary) });

export const ContributeResponse = z.object({ status: z.enum(["held", "pending", "already_paid"]) });
export type ContributeResponse = z.infer<typeof ContributeResponse>;
