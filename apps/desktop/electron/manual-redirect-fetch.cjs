const { Readable } = require("node:stream");

/**
 * A `fetch` over Electron's `net.request` that answers a redirect instead of
 * following it: a 3xx response with its `location`, and no body. The caller
 * follows it after checking where it leads (cli-command.cjs).
 *
 * `net.fetch` can't serve here: it follows redirects without reporting them
 * (its response's `url` is empty and `redirected` false), and with
 * `redirect: "manual"` it rejects instead of returning the 3xx. `net.request`
 * still uses Chromium's network stack, with the system's proxy and
 * certificates, as `net.fetch` does.
 *
 * @param {{ request: (options: any) => any }} net Electron's `net`.
 */
function createManualRedirectFetch(net) {
  /**
   * @param {string} url
   * @param {{ headers?: Record<string, string>, signal?: AbortSignal }} [init]
   */
  return (url, { headers = {}, signal } = {}) =>
    new Promise((resolve, reject) => {
      const request = net.request({
        url,
        redirect: "manual",
        useSessionCookies: false,
      });
      for (const [name, value] of Object.entries(headers)) {
        request.setHeader(name, value);
      }
      const abort = () => {
        request.abort();
        reject(signal?.reason ?? new Error("The request was aborted."));
      };
      if (signal?.aborted) {
        abort();
        return;
      }
      signal?.addEventListener("abort", abort, { once: true });
      request.on("redirect", (statusCode, _method, redirectUrl) => {
        resolve(responseOf(statusCode, url, { location: redirectUrl }, null));
        request.abort();
      });
      request.on("response", (message) => {
        resolve(responseOf(message.statusCode, url, message.headers, message));
      });
      request.on("error", reject);
      request.end();
    });
}

/** A fetch Response's shape, from a status, headers and a Node stream. */
function responseOf(status, url, headers, message) {
  const header = (name) => {
    const value = headers?.[name.toLowerCase()];
    return Array.isArray(value) ? value.join(", ") : (value ?? null);
  };
  const body = message
    ? /** @type {ReadableStream<Uint8Array>} */ (Readable.toWeb(message))
    : new ReadableStream({ start: (controller) => controller.close() });
  const text = async () => {
    const reader = body.getReader();
    const chunks = [];
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString("utf8");
  };
  return {
    ok: status >= 200 && status < 300,
    status,
    url,
    headers: { get: header },
    body,
    json: async () => JSON.parse(await text()),
  };
}

module.exports = { createManualRedirectFetch };
