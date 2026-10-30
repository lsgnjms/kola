import { readFile } from "node:fs/promises";
import { LndRestWallet } from "./LndRestWallet.js";
import { HttpsLndTransport } from "./transport.js";

export interface LndFiles {
  restUrl: string;
  tlsCertPath: string;
  invoiceMacaroonPath: string;
  payoutMacaroonPath: string;
}

/** Builds an LndRestWallet from the cert and macaroons the seed script writes. */
export async function lndWalletFromFiles(files: LndFiles): Promise<LndRestWallet> {
  const [tlsCert, invoiceMacaroon, payoutMacaroon] = await Promise.all([
    readFile(files.tlsCertPath),
    readFile(files.invoiceMacaroonPath),
    readFile(files.payoutMacaroonPath),
  ]);
  const transport = (macaroon: Buffer) =>
    new HttpsLndTransport({ baseUrl: files.restUrl, tlsCert, macaroonHex: macaroon.toString("hex") });
  return new LndRestWallet(transport(invoiceMacaroon), transport(payoutMacaroon));
}
