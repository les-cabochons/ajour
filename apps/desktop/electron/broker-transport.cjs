/**
 * The network stack of the local API's credential broker
 * (`apps/api/src/credential-broker.ts`): its transport and its resolver, on
 * Electron's `net.request`, as decided in #219 and the spec #381. Main passes
 * both to `startAppApiServer`, after `ready`.
 *
 * - **A session of its own,** `ajour-broker`, in memory (no `persist:`) and
 *   without an HTTP cache, used by nothing else. Every request omits
 *   credentials, so no cookie is sent or kept and no sign-in prompt
 *   appears, and `cache: "no-store"` keeps answers out of memory too. The
 *   session follows the system proxy and PAC, and the OS trust store, as
 *   any Chromium session does.
 * - **Manual redirects.** The transport never follows one: it answers with
 *   the 3xx and its `Location`, and the broker decides.
 * - **The address that answered.** `net` doesn't expose it, but the
 *   session's `webRequest` events carry `ip` once a response started. Each
 *   request carries a one-time marker header, which `onBeforeSendHeaders`
 *   takes off before it leaves, to tie the events to it. When no event
 *   names an address, the broker has only its check before the request: the
 *   DNS-rebinding window ADR 0010 states, and the request's event says
 *   `answer_address: "unknown"`.
 * - **The resolver** asks the session itself (`session.resolveHost`), so the
 *   check uses the resolver and cache the request will. When the system
 *   proxy carries the request, the proxy connects and may resolve names
 *   this computer can't: then an empty answer is allowed, and the address
 *   that answers is the proxy's, which the broker doesn't judge. The
 *   resolver also names the proxies' own addresses from the PAC answer, so
 *   an answer from any other address, as when the PAC falls back to
 *   `DIRECT`, is judged as an unproxied one. When a proxy's name doesn't
 *   resolve, no proxied answer is judged.
 *
 * Integrated Windows sign-in (NTLM and Negotiate) for on-premises
 * connections needs credentials included and the session's server
 * allowlist (`ses.allowNTLMCredentialsForDomains`), which is app-wide; it
 * isn't turned on yet.
 */

const { isIP } = require("node:net");

const BROKER_PARTITION = "ajour-broker";
const MARKER_HEADER = "x-ajour-broker-request";

/**
 * The proxy hosts a PAC answer lists, such as `PROXY a:8080; SOCKS5
 * [fd00::5]:1080; DIRECT`, in order, without their ports or brackets.
 */
function proxyHosts(proxy) {
  const hosts = [];
  for (const entry of proxy.split(";")) {
    const match = /^(?:PROXY|HTTPS|HTTP|SOCKS[45]?|QUIC)\s+(\S+)$/i.exec(
      entry.trim(),
    );
    if (!match) continue;
    const hostPort = match[1];
    const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(hostPort);
    if (bracketed) {
      hosts.push(bracketed[1]);
    } else if (hostPort.split(":").length <= 2) {
      hosts.push(hostPort.split(":")[0]);
    } else {
      hosts.push(hostPort);
    }
  }
  return [...new Set(hosts)];
}

/** Response headers as the broker reads them: lowercase, repeated ones joined. */
function flattenHeaders(headers) {
  const flat = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    if (value === undefined || value === null) continue;
    flat[name.toLowerCase()] = Array.isArray(value)
      ? value.join(", ")
      : String(value);
  }
  return flat;
}

function tooLarge() {
  return Object.assign(new Error("The service's answer is too large."), {
    code: "response_too_large",
  });
}

function aborted(signal) {
  return signal.reason instanceof Error
    ? signal.reason
    : Object.assign(new Error("The request was aborted."), {
        name: "AbortError",
      });
}

/**
 * @param {{
 *   net: Pick<import("electron").Net, "request">,
 *   session: Pick<typeof import("electron").session, "fromPartition">,
 *   randomUUID: () => string,
 * }} electron
 */
function createBrokerNetwork({ net, session, randomUUID }) {
  const ses = session.fromPartition(BROKER_PARTITION, { cache: false });
  /** Each request in flight, by its marker: the address that answered it. */
  const answered = new Map();
  /** webRequest ids, to the marker of the request they belong to. */
  const markers = new Map();

  ses.webRequest.onBeforeSendHeaders((details, callback) => {
    const requestHeaders = { ...details.requestHeaders };
    for (const name of Object.keys(requestHeaders)) {
      if (name.toLowerCase() !== MARKER_HEADER) continue;
      const marker = requestHeaders[name];
      delete requestHeaders[name];
      if (answered.has(marker)) markers.set(details.id, marker);
    }
    callback({ requestHeaders });
  });
  const remember = (details) => {
    const marker = markers.get(details.id);
    if (marker !== undefined && details.ip && answered.has(marker)) {
      answered.get(marker).ip = details.ip;
    }
  };
  ses.webRequest.onResponseStarted(remember);
  ses.webRequest.onBeforeRedirect(remember);
  ses.webRequest.onCompleted((details) => {
    remember(details);
    markers.delete(details.id);
  });
  ses.webRequest.onErrorOccurred((details) => markers.delete(details.id));

  const transport = {
    /**
     * One exchange, as `BrokerTransportRequest` in the API's broker types it.
     *
     * @param {{
     *   url: string,
     *   method: string,
     *   headers: Record<string, string>,
     *   body?: Uint8Array,
     *   signal: AbortSignal,
     *   maxResponseBytes: number,
     * }} request
     */
    send(request) {
      return new Promise((resolve, reject) => {
        if (request.signal.aborted) {
          reject(aborted(request.signal));
          return;
        }
        const marker = randomUUID();
        answered.set(marker, {});
        let settled = false;
        const clientRequest = net.request({
          method: request.method,
          url: request.url,
          session: ses,
          redirect: "manual",
          credentials: "omit",
          cache: "no-store",
          referrerPolicy: "no-referrer",
        });
        const settle = (outcome) => {
          if (settled) return;
          settled = true;
          request.signal.removeEventListener("abort", onAbort);
          const remoteAddress = answered.get(marker)?.ip;
          answered.delete(marker);
          if (outcome instanceof Error) {
            reject(outcome);
          } else {
            resolve(remoteAddress ? { ...outcome, remoteAddress } : outcome);
          }
        };
        // Each outcome settles before it aborts, which emits `abort`.
        const onAbort = () => {
          settle(aborted(request.signal));
          clientRequest.abort();
        };
        request.signal.addEventListener("abort", onAbort, { once: true });

        clientRequest.on(
          "redirect",
          (statusCode, _method, redirectUrl, headers) => {
            // Not following it cancels it: the broker decides what to follow.
            settle({
              status: statusCode,
              headers: { ...flattenHeaders(headers), location: redirectUrl },
              body: new Uint8Array(),
            });
            clientRequest.abort();
          },
        );
        clientRequest.on("response", (response) => {
          const chunks = [];
          let size = 0;
          response.on("data", (chunk) => {
            if (settled) return;
            size += chunk.length;
            if (size > request.maxResponseBytes) {
              settle(tooLarge());
              clientRequest.abort();
              return;
            }
            chunks.push(Buffer.from(chunk));
          });
          response.on("end", () => {
            settle({
              status: response.statusCode,
              headers: flattenHeaders(response.headers),
              body: new Uint8Array(Buffer.concat(chunks)),
            });
          });
          response.on("error", (error) => settle(error));
          response.on("aborted", () =>
            settle(new Error("The service ended its answer early.")),
          );
        });
        clientRequest.on("error", (error) => settle(error));
        clientRequest.on("abort", () =>
          settle(new Error("The request was cancelled.")),
        );

        for (const [name, value] of Object.entries(request.headers)) {
          clientRequest.setHeader(name, value);
        }
        clientRequest.setHeader(MARKER_HEADER, marker);
        if (request.body) clientRequest.write(Buffer.from(request.body));
        clientRequest.end();
      });
    },
  };

  /**
   * Every address of the proxies a PAC answer lists, or undefined when one
   * of their names doesn't resolve: then no proxied answer is judged.
   */
  const proxyAddresses = async (proxy) => {
    const addresses = [];
    for (const host of proxyHosts(proxy)) {
      if (isIP(host) !== 0) {
        addresses.push(host);
        continue;
      }
      try {
        const { endpoints } = await ses.resolveHost(host);
        addresses.push(...endpoints.map((endpoint) => endpoint.address));
      } catch {
        return undefined;
      }
    }
    return [...new Set(addresses)];
  };

  const resolver = {
    /**
     * @param {string} hostname
     * @param {string} url
     */
    async resolve(hostname, url) {
      const proxy = String(await ses.resolveProxy(url)).trim();
      const proxied = !/^DIRECT\b/i.test(proxy);
      let addresses = [];
      try {
        const { endpoints } = await ses.resolveHost(hostname);
        addresses = endpoints.map((endpoint) => endpoint.address);
      } catch (error) {
        if (!proxied) throw error;
      }
      if (!proxied) return { addresses, proxied };
      const proxies = await proxyAddresses(proxy);
      return {
        addresses,
        proxied,
        ...(proxies ? { proxyAddresses: proxies } : {}),
      };
    },
  };

  return { transport, resolver };
}

module.exports = { BROKER_PARTITION, MARKER_HEADER, createBrokerNetwork };
