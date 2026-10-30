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
      const status = res.statusCode ?? 0;
      const ok = status >= 200 && status < 300;
      let failed = false;
      let buffer = "";

      const fail = (err: Error) => {
        if (closed || failed) return;
        failed = true;
        handlers.onError(err);
      };
      const handleLine = (line: string) => {
        if (!line || failed) return;
        let msg: unknown;
        try {
          msg = JSON.parse(line);
        } catch {
          fail(new LndError(status, "LND stream returned invalid JSON"));
          return;
        }
        // Non-2xx responses carry a bare `{code, message}` body, not a stream frame.
        if (!ok) return fail(new LndError(status, lndMessage(msg)));
        const frame = msg as { result?: unknown; error?: unknown };
        if (frame.error !== undefined) fail(new LndError(status, lndMessage(frame.error)));
        else if (!closed) handlers.onMessage(frame.result);
      };

      res.setEncoding("utf8");
      res.on("data", (chunk: string) => {
        buffer += chunk;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) !== -1) {
          handleLine(buffer.slice(0, newline).trim());
          buffer = buffer.slice(newline + 1);
        }
      });
      res.on("end", () => {
        // The last frame (or an error body) may not end with a newline.
        handleLine(buffer.trim());
        if (closed || failed) return;
        // An error status must never look like a clean end: callers read "ended" as "no result".
        if (!ok) fail(new LndError(status, "LND request failed"));
        else handlers.onEnd();
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

/** LND errors are `{code, message}`, sometimes wrapped as `{error: {code, message}}`. */
function lndMessage(json: unknown): string {
  if (json && typeof json === "object") {
    if ("message" in json && typeof json.message === "string") return json.message;
    if ("error" in json) return lndMessage(json.error);
  }
  return "LND request failed";
}
