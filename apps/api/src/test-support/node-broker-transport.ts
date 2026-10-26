import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import type {
  BrokerTransport,
  BrokerTransportRequest,
  BrokerTransportResponse,
} from "../credential-broker.ts";

/**
 * A broker transport for plain Node tests, on `node:http`: it sends one
 * exchange to a fixture service, never follows a redirect, stops reading
 * past the limit, and reports the address that answered. The desktop app's
 * is Electron's `net.request` (`apps/desktop/electron/broker-transport.cjs`).
 */
export function nodeBrokerTransport(): BrokerTransport {
  return {
    send: (request) => send(request),
  };
}

function send(
  request: BrokerTransportRequest,
): Promise<BrokerTransportResponse> {
  return new Promise((resolve, reject) => {
    const url = new URL(request.url);
    const outgoing = (url.protocol === "https:" ? httpsRequest : httpRequest)(
      url,
      {
        method: request.method,
        headers: request.headers,
        signal: request.signal,
      },
      (response) => {
        const remoteAddress = response.socket?.remoteAddress;
        const chunks: Buffer[] = [];
        let size = 0;
        response.on("data", (chunk: Buffer) => {
          size += chunk.byteLength;
          if (size > request.maxResponseBytes) {
            response.destroy();
            reject(
              Object.assign(new Error("The answer is too large."), {
                code: "response_too_large",
              }),
            );
            return;
          }
          chunks.push(chunk);
        });
        response.on("error", reject);
        response.on("end", () => {
          const headers: Record<string, string> = {};
          for (const [name, value] of Object.entries(response.headers)) {
            if (value === undefined) continue;
            headers[name] = Array.isArray(value) ? value.join(", ") : value;
          }
          resolve({
            status: response.statusCode ?? 0,
            headers,
            body: new Uint8Array(Buffer.concat(chunks)),
            ...(remoteAddress ? { remoteAddress } : {}),
          });
        });
      },
    );
    outgoing.on("error", reject);
    outgoing.end(request.body ? Buffer.from(request.body) : undefined);
  });
}
