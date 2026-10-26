/**
 * Nostr event kinds used by Kola. Defined once here; web and api both import them.
 *
 * TODO(nostr milestone): check these against the NIP registry
 * (https://github.com/nostr-protocol/nips#event-kinds) for collisions before
 * the first public relay deployment.
 */
export const KIND = {
  /** Addressable (30000–39999): replaceable circle definition keyed by `d` = circle id. */
  CIRCLE_DEFINITION: 33_501,
  /** Regular (1000–9999). */
  CIRCLE_JOIN: 3501,
  CYCLE_OPENED: 3502,
  CONTRIBUTION_HELD: 3503,
  CONTRIBUTION_SETTLED: 3504,
  PAYOUT_SENT: 3505,
  CYCLE_CANCELLED: 3506,
} as const;

export type KolaKind = (typeof KIND)[keyof typeof KIND];

/** Standard kinds from other NIPs that Kola uses. */
export const NIP_KIND = {
  /** NIP-98 HTTP Auth. */
  HTTP_AUTH: 27_235,
} as const;
