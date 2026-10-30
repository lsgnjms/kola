import {
  ApiErrorBody,
  BalanceResponse,
  buildCircleEvent,
  CircleListResponse,
  CircleView,
  ClaimResponse,
  ContributeResponse,
  type CreateCircleRequest,
  type JoinCircleRequest,
  CreateInvoiceResponse,
  DecodeResponse,
  HistoryResponse,
  httpAuthTemplate,
  PayResponse,
  type ApiErrorCode,
} from "@kola/shared";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import type { Event, EventTemplate } from "nostr-tools/pure";
import type { z } from "zod";

export type ClientErrorCode = ApiErrorCode | "network";

export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    /** false: no money moved. null: unknown. undefined: not a payment. */
    readonly moneyMoved?: boolean | null,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

export interface ApiClientOptions {
  /** The API base as this browser reaches it, e.g. `${location.origin}/api`. Signed into every request. */
  baseUrl: string;
  sign: (template: EventTemplate) => Event;
  fetch?: typeof fetch;
  nowMs?: () => number;
}

/** Wallet API client. Every request is NIP-98 signed with the member's on-device key. */
export class ApiClient {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private readonly nowMs: () => number;

  constructor(private readonly opts: ApiClientOptions) {
    this.base = opts.baseUrl.replace(/\/+$/, "");
    this.fetchFn = opts.fetch ?? fetch.bind(globalThis);
    this.nowMs = opts.nowMs ?? Date.now;
  }

  claim() {
    return this.call("POST", "/wallet/claim", ClaimResponse);
  }

  balance() {
    return this.call("GET", "/wallet/balance", BalanceResponse);
  }

  createInvoice(amountSat: number) {
    return this.call("POST", "/wallet/invoices", CreateInvoiceResponse, { amountSat });
  }

  decode(paymentRequest: string) {
    return this.call("POST", "/wallet/decode", DecodeResponse, { paymentRequest });
  }

  pay(paymentRequest: string) {
    return this.call("POST", "/wallet/pay", PayResponse, { paymentRequest }, { isPayment: true });
  }

  history() {
    return this.call("GET", "/wallet/history", HistoryResponse);
  }

  listCircles() {
    return this.call("GET", "/circles", CircleListResponse);
  }

  createCircle(input: CreateCircleRequest) {
    return this.call("POST", "/circles", CircleView, input);
  }

  joinCircle(input: JoinCircleRequest) {
    return this.call("POST", "/circles/join", CircleView, input);
  }

  getCircle(id: string) {
    return this.call("GET", `/circles/${encodeURIComponent(id)}`, CircleView);
  }

  openRound(id: string) {
    return this.call("POST", `/circles/${encodeURIComponent(id)}/cycles`, CircleView);
  }

  /** Signs this member's agreement to the circle's rules, on this device, for the public record. */
  recordJoin(view: CircleView) {
    const member = view.members.find((m) => m.isYou)?.pubkey;
    if (!member) throw new ApiError("not_a_member");
    const event = this.opts.sign(
      buildCircleEvent(
        {
          type: "circle_joined",
          circleId: view.id,
          member,
          contributionSat: view.contributionSat,
          memberCount: view.memberCount,
        },
        { coordinatorPubkey: view.coordinatorPubkey, nowS: Math.floor(this.nowMs() / 1000) },
      ),
    );
    return this.call("POST", `/circles/${encodeURIComponent(view.id)}/join-record`, CircleView, { event });
  }

  contribute(id: string) {
    return this.call("POST", `/circles/${encodeURIComponent(id)}/contribute`, ContributeResponse, undefined, {
      isPayment: true,
    });
  }

  private async call<S extends z.ZodTypeAny>(
    method: "GET" | "POST",
    path: string,
    schema: S,
    body?: unknown,
    { isPayment = false } = {},
  ): Promise<z.infer<S>> {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const event = this.opts.sign(
      httpAuthTemplate({
        url: this.base + path,
        method,
        nowS: Math.floor(this.nowMs() / 1000),
        ...(payload ? { payloadSha256Hex: bytesToHex(sha256(new TextEncoder().encode(payload))) } : {}),
      }),
    );
    const headers: Record<string, string> = { authorization: `Nostr ${btoa(JSON.stringify(event))}` };
    if (payload) headers["content-type"] = "application/json";

    let res: Response;
    try {
      res = await this.fetchFn(this.base + path, { method, headers, ...(payload ? { body: payload } : {}) });
    } catch {
      // The request may or may not have reached the server.
      throw new ApiError("network", isPayment ? null : undefined);
    }

    const json: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const parsed = ApiErrorBody.safeParse(json);
      if (!parsed.success) throw new ApiError("internal", isPayment ? null : undefined);
      throw new ApiError(parsed.data.error, parsed.data.moneyMoved);
    }
    const parsed = schema.safeParse(json);
    if (!parsed.success) throw new ApiError("internal", isPayment ? null : undefined);
    return parsed.data;
  }
}
