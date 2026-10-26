import type { IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";

export type HttpMethod = "GET" | "POST" | "DELETE";

/**
 * Minimal LND REST transport. Swappable so LndRestWallet is unit-testable
 * without a node. Implementations must never include the macaroon in errors.
 */
export interface LndTransport {
  request(method: HttpMethod, path: string, body?: unknown): Promise<unknown>;
  /**
   * Opens a streaming endpoint (newline-delimited `{"result": …}` / `{"error": …}`).
   * Returns a function that closes the stream.
   */
  stream(
    method: HttpMethod,
    path: string,
    body: unknown,
    handlers: { onMessage: (msg: unknown) => void; onError: (err: Error) => void; onEnd: () => void },
  ): () => void;
}

export class LndError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "LndError";
  }
}

export interface HttpsLndTransportOptions {
  baseUrl: string;
  /** LND's self-signed TLS certificate (PEM). Pinned as the only trusted CA. */
  tlsCert: Buffer;
  macaroonHex: string;
  timeoutMs?: number;
}

export class HttpsLndTransport implements LndTransport {
  private readonly base: URL;

  constructor(private readonly opts: HttpsLndTransportOptions) {
    this.base = new URL(opts.baseUrl);
    if (this.base.protocol !== "https:") throw new Error("LND REST URL must use https");
  }

  request(method: HttpMethod, path: string, body?: unknown): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const req = this.open(method, path, (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (c: Buffer) => chunks.push(c));
        res.on("end", () => {
          const text = Buffer.concat(chunks).toString("utf8");
          const status = res.statusCode ?? 0;
          let json: unknown;
          try {
            json = text ? JSON.parse(text) : {};
          } catch {
            reject(new LndError(status, "LND returned invalid JSON"));
            return;
          }
          if (status < 200 || status >= 300) {
            reject(new LndError(status, lndMessage(json)));
            return;
          }
          resolve(json);
        });
        res.on("error", reject);
      });
      req.setTimeout(this.opts.timeoutMs ?? 30_000, () => req.destroy(new Error("LND request timed out")));
      req.on("error", reject);
      req.end(body === undefined ? undefined : JSON.stringify(body));
    });
  }

  stream(
    method: HttpMethod,
    path: string,
    body: unknown,
    handlers: { onMessage: (msg: unknown) => void; onError: (err: Error) => void; onEnd: () => void },
  ): () => void {
    let closed = false;
    const req = this.open(method, path, (res) => {
      let buffer = "";
      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (!line) continue;
          let msg: { result?: unknown; error?: unknown };
          try {
            msg = JSON.parse(line) as { result?: unknown; error?: unknown };
          } catch {
            handlers.onError(new LndError(res.statusCode ?? 0, "LND stream returned invalid JSON"));
            continue;
          }
          if (msg.error !== undefined) handlers.onError(new LndError(res.statusCode ?? 0, lndMessage(msg.error)));
          else handlers.onMessage(msg.result);
        }
      });
      res.on("end", () => {
        if (!closed) handlers.onEnd();
      });
      res.on("error", (err) => {
        if (!closed) handlers.onError(err);
      });
    });
    req.on("error", (err) => {
      if (!closed) handlers.onError(err);
    });
    req.end(body === undefined ? undefined : JSON.stringify(body));
    return () => {
      closed = true;
      req.destroy();
    };
  }

  private open(method: HttpMethod, path: string, onResponse: (res: IncomingMessage) => void) {
    const url = new URL(path, this.base);
    return httpsRequest(
      url,
      {
        method,
        ca: this.opts.tlsCert,
        headers: {
          "Grpc-Metadata-macaroon": this.opts.macaroonHex,
          "Content-Type": "application/json",
        },
      },
      onResponse,
    );
  }
}

function lndMessage(json: unknown): string {
  if (json && typeof json === "object" && "message" in json && typeof json.message === "string") {
    return json.message;
  }
  return "LND request failed";
}
