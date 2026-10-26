import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { TEST_WINDOW_ORIGIN, windowRequestHeaders } from "./window-token.ts";

/**
 * Sends one request to a server built from options, without listening: the
 * request and response are stand-ins the server's handler can drive. It
 * carries the window token and origin of `window-token.ts`, so start the
 * server with `windowServerOptions`. Resolves with the status and the
 * parsed JSON body.
 */
export async function dispatchJsonRequest(
  server: Server,
  options: {
    method: string;
    path: string;
    headers?: Record<string, string>;
    body?: Uint8Array | string;
    /** Holds the body back: `reached` runs when the route asks for it, and the body arrives once `release` settles. */
    bodyGate?: { reached: () => void; release: Promise<void> };
  },
) {
  return await new Promise<{ status: number; body: unknown }>((resolve) => {
    const requestBody =
      options.body === undefined
        ? []
        : [
            typeof options.body === "string"
              ? Buffer.from(options.body)
              : Buffer.from(options.body),
          ];
    const request = {
      method: options.method,
      url: options.path,
      // As Ajour's window sends it, unless the test says otherwise.
      headers: Object.fromEntries(
        Object.entries({
          ...windowRequestHeaders,
          origin: TEST_WINDOW_ORIGIN,
          ...options.headers,
        }).map(([key, value]) => [key.toLowerCase(), value]),
      ),
      // The body, as `request.iterator()` reads it.
      async *iterator() {
        options.bodyGate?.reached();
        await options.bodyGate?.release;
        yield* requestBody;
      },
    } as unknown as IncomingMessage;
    let status = 0;
    const response = {
      statusCode: 200,
      headersSent: false,
      writableEnded: false,
      writableFinished: false,
      setHeader() {
        return response;
      },
      getHeader() {
        return undefined;
      },
      once() {
        return response;
      },
      writeHead(statusCode: number) {
        status = statusCode;
        response.statusCode = statusCode;
        response.headersSent = true;
        return response;
      },
      end(payload?: string) {
        response.writableEnded = true;
        response.writableFinished = true;
        // The request's event ends once its handler returns, just after.
        setImmediate(() =>
          resolve({
            status,
            body: payload ? JSON.parse(payload) : undefined,
          }),
        );
        return response;
      },
    };

    server.emit("request", request, response as unknown as ServerResponse);
  });
}
