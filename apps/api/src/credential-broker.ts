/**
 * The credential broker: the only way an API 4 plugin reaches the network,
 * decided in The plugin security model (#229), API 4 (#219), the spec #381
 * and ADR 0010. A plugin names one of its own connections, a method, a path
 * relative to the connection's address, a query, headers and a body. It
 * never names a URL or carries a credential. The broker:
 *
 * - resolves the connection among the calling plugin's own connections only,
 *   so another plugin's id and an unknown one give the same error;
 * - checks the admitted manifest's endpoint allowlist, its request headers
 *   (the fixed denylist always wins), and the connection's access choices;
 * - builds the URL from the address the user saved, never above its path;
 * - attaches the credential from the vault;
 * - refuses private addresses unless the connection is on-premises, before
 *   the request and, where the transport can tell, for the address that
 *   answered;
 * - follows same-origin redirects with the credential, up to 3, and hands a
 *   cross-origin one back; a secret address follows https redirects to any
 *   host and never gives its final address away;
 * - removes every secret, in its common changed forms, from the answer;
 * - caps request and response size, rate, concurrency and time;
 * - emits a `plugin.request` event per request, with no header, body or
 *   query, and records the last request and blocked attempts for Access
 *   review.
 *
 * `CredentialBroker` is the in-process implementation of the port
 * (`broker-port.ts`, re-exported here); it sends, follows, scrubs, limits
 * and records, with the policy in `broker-policy.ts`, the per-plugin limits
 * in `broker-limits.ts` and the address checks in `broker-addresses.ts`. The
 * transport and the resolver are injected: Electron's `net.request` on a
 * dedicated session in the desktop app (`apps/desktop/electron/
 * broker-transport.cjs`), fakes in tests. Without a transport, as in the
 * standalone API, every request is refused: plugins need the desktop app.
 */

import {
  authSchemeHeaders,
  connectionAccessOn,
  isPublicDomainName,
  pluginHttpMethods,
  type PluginHttpMethod,
} from "../../../packages/shared/plugin-api-4.ts";
import type {
  AjourCatalog,
  PluginRequestAnswerAddress,
} from "../../../packages/wide-events/catalog.ts";
import type { Unit } from "../../../packages/wide-events/index.ts";
import {
  SecretBytesRedaction,
  secretEchoForms,
} from "../../../packages/wide-events/secret-redaction.ts";
import {
  isAddressLiteral,
  isPrivateAddress,
  sameAddress,
  unbracketed,
} from "./broker-addresses.ts";
import { abortError, RateBucket, Slots } from "./broker-limits.ts";
import {
  refused,
  requestHeaders,
  targetOf,
  type HostKind,
  type Target,
} from "./broker-policy.ts";
import {
  BROKER_LIMITS,
  BrokerRequestError,
  type BrokerCaller,
  type BrokerConnection,
  type BrokerHttpRequest,
  type BrokerLimits,
  type BrokerPublicFetchInit,
  type BrokerReason,
  type BrokerResolver,
  type BrokerResponse,
  type CredentialBrokerOptions,
  type CredentialBrokerPort,
  type OperationBroker,
} from "./broker-port.ts";

// The port, which the rest of the API imports from here.
export * from "./broker-port.ts";

/** The headers never handed back to a plugin. */
const STRIPPED_RESPONSE_HEADERS = new Set([
  "set-cookie",
  "set-cookie2",
  "www-authenticate",
  "proxy-authenticate",
  "authentication-info",
  "proxy-authentication-info",
  // The transport hands the body back decoded and whole.
  "content-encoding",
  "content-length",
  "transfer-encoding",
]);

/** Headers that would name a secret address's final address. */
const ADDRESS_HEADERS = new Set([
  "location",
  "content-location",
  "link",
  "refresh",
]);

/**
 * The refusals Access review counts as blocked attempts: the plugin asked
 * for something its access doesn't allow. A paused connection, a plugin
 * turned off or a limit isn't one.
 */
const BLOCKING_REASONS: ReadonlySet<BrokerReason> = new Set([
  "invalid_request",
  "connection_not_found",
  "not_allowed",
  "header_refused",
  "access_off",
  "private_address",
  "redirect_refused",
]);

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/**
 * The longest address a secret address may redirect to, as long as a
 * connection field may hold: each is scrubbed like the secret, and the
 * forms of a longer one would pass what one redaction may hold
 * (`MAX_FORM_BYTES`).
 */
const MAX_REDIRECT_ADDRESS = 4_096;

const NOT_FOUND_MESSAGE = "This plugin has no connection with that id.";
const NO_TRANSPORT_MESSAGE =
  "Plugins reach the network only in the Ajour desktop app.";

function bodyBytes(body: BrokerHttpRequest["body"]): Uint8Array | undefined {
  if (body === undefined) return undefined;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  return undefined;
}

/** The response headers a plugin may read: no cookie, challenge or echoed secret. */
function responseHeaders(
  headers: Record<string, string>,
  redaction: SecretBytesRedaction,
  secretAddress: boolean,
) {
  const kept: Record<string, string> = {};
  for (const [rawName, value] of Object.entries(headers)) {
    const name = rawName.toLowerCase();
    if (STRIPPED_RESPONSE_HEADERS.has(name)) continue;
    if (secretAddress && ADDRESS_HEADERS.has(name)) continue;
    // A header that holds a secret, or couldn't be checked, goes whole.
    if (redaction.holdsSecret(`${name}: ${value}`) !== false) continue;
    kept[name] = value;
  }
  return kept;
}

/** How the broker sends one plugin request, with what it has learned. */
interface Exchange {
  pluginId: string;
  connectionId?: string;
  hostKind?: HostKind;
  pathTemplate?: string;
  redirects: number;
  status?: number;
  requestBytes: number;
  responseBytes: number;
  onPremises: boolean;
  pending: boolean;
  /** How far the address that answered could be judged; absent on-premises. */
  answerAddress?: PluginRequestAnswerAddress;
}

export class CredentialBroker implements CredentialBrokerPort {
  private readonly options: CredentialBrokerOptions;
  private readonly limits: BrokerLimits;
  private readonly now: () => number;
  private readonly rates = new Map<string, RateBucket>();
  private readonly slots = new Map<string, Slots>();

  constructor(options: CredentialBrokerOptions) {
    this.options = options;
    this.limits = { ...BROKER_LIMITS, ...options.limits };
    this.now = options.now ?? Date.now;
  }

  forOperation(caller: BrokerCaller): OperationBroker {
    const ended = new AbortController();
    return {
      http: (request) => this.request(caller, request, ended.signal),
      publicFetch: (url, init) =>
        this.publicFetch(caller, url, init, ended.signal),
      close: () =>
        ended.abort(
          refused(
            "operation_ended",
            "The plugin operation that sent this request has ended.",
          ),
        ),
    };
  }

  private slotsOf(pluginId: string) {
    let slots = this.slots.get(pluginId);
    if (!slots) {
      slots = new Slots(this.limits);
      this.slots.set(pluginId, slots);
    }
    return slots;
  }

  private takeRate(pluginId: string) {
    let bucket = this.rates.get(pluginId);
    if (!bucket) {
      bucket = new RateBucket(this.limits, this.now());
      this.rates.set(pluginId, bucket);
    }
    if (!bucket.take(this.now())) {
      throw new BrokerRequestError(
        "limit",
        "rate_limited",
        "The plugin sent too many requests. Try again in a moment.",
      );
    }
  }

  /**
   * Runs one request: its event, its limits, its slot and its records, with
   * `send` doing the policy and the exchanges.
   */
  private async run(
    caller: BrokerCaller,
    exchange: Exchange,
    method: string,
    signals: (AbortSignal | undefined)[],
    body: Uint8Array | undefined,
    send: (signal: AbortSignal, exchange: Exchange) => Promise<BrokerResponse>,
  ): Promise<BrokerResponse> {
    const unit = this.options.events?.start("plugin.request", {
      kind: "job",
      trigger: "system",
      detached: true,
      ...(caller.traceparent ? { parent: caller.traceparent } : {}),
    });
    const timeout = new AbortController();
    const timer = setTimeout(
      () =>
        timeout.abort(
          new BrokerRequestError(
            "timeout",
            "timeout",
            "The service took too long to answer.",
          ),
        ),
      this.limits.timeoutMs,
    );
    const signal = AbortSignal.any(
      [timeout.signal, ...signals].filter(
        (candidate): candidate is AbortSignal => candidate !== undefined,
      ),
    );
    let release: (() => void) | undefined;
    let failure: unknown;
    const queuedAt = this.now();
    try {
      if (signal.aborted) throw abortError(signal);
      if (body && body.byteLength > this.limits.requestBodyBytes) {
        throw new BrokerRequestError(
          "limit",
          "request_too_large",
          `A request body may hold up to ${this.limits.requestBodyBytes / (1024 * 1024)} MB.`,
        );
      }
      this.takeRate(caller.pluginId);
      release = await this.slotsOf(caller.pluginId).acquire(signal);
      unit?.set({ broker: { queued_ms: this.now() - queuedAt } });
      if (!this.options.transport) {
        throw refused("no_transport", NO_TRANSPORT_MESSAGE);
      }
      const refusal = await this.options.connections.operationRefusal?.(
        caller.pluginId,
        caller.method,
      );
      if (refusal) throw refused(refusal.reason, refusal.message);
      const response = await send(signal, exchange);
      exchange.status = response.status;
      exchange.responseBytes = response.body.byteLength;
      return response;
    } catch (error) {
      failure = error;
      throw this.settleError(error, signal);
    } finally {
      clearTimeout(timer);
      release?.();
      await this.finish(unit, exchange, method, failure, signal);
    }
  }

  /** What a request rejects with: a broker error, the abort, or a network failure. */
  private settleError(error: unknown, signal: AbortSignal): unknown {
    if (error instanceof BrokerRequestError) return error;
    if (signal.aborted) {
      const reason = signal.reason;
      return reason instanceof BrokerRequestError ? reason : abortError(signal);
    }
    if (
      (error as { code?: unknown } | undefined)?.code === "response_too_large"
    ) {
      return new BrokerRequestError(
        "limit",
        "response_too_large",
        `The service's answer is larger than ${this.limits.responseBodyBytes / (1024 * 1024)} MB.`,
      );
    }
    // The transport's own message can name the address, so it stays out.
    return new BrokerRequestError(
      "network",
      "network",
      "The service couldn't be reached.",
    );
  }

  /** Emits the request's event, and records it for Access review. */
  private async finish(
    unit: Unit<AjourCatalog, "plugin.request"> | undefined,
    exchange: Exchange,
    method: string,
    failure: unknown,
    signal: AbortSignal,
  ) {
    const at = this.now();
    const error =
      failure === undefined ? undefined : this.settleError(failure, signal);
    const blocked =
      error instanceof BrokerRequestError && BLOCKING_REASONS.has(error.reason);
    this.emit(unit, exchange, method, error);
    const activity = this.options.activity;
    if (!activity) return;
    try {
      await (blocked
        ? activity.recordBlocked(exchange.pluginId, exchange.connectionId, at)
        : activity.recordRequest(exchange.pluginId, exchange.connectionId, at));
    } catch {
      // Access review's records never fail a request.
    }
  }

  private emit(
    unit: Unit<AjourCatalog, "plugin.request"> | undefined,
    exchange: Exchange,
    method: string,
    error: unknown,
  ) {
    if (!unit) return;
    unit.set({
      plugin: { id: exchange.pluginId },
      ...(exchange.connectionId
        ? { connection: { id: exchange.connectionId } }
        : {}),
      broker: {
        method: (pluginHttpMethods as readonly string[]).includes(method)
          ? (method as PluginHttpMethod)
          : "other",
        ...(exchange.hostKind ? { host_kind: exchange.hostKind } : {}),
        ...(exchange.pathTemplate
          ? { path_template: exchange.pathTemplate }
          : {}),
        ...(exchange.status !== undefined
          ? { status_code: exchange.status }
          : {}),
        redirects: exchange.redirects,
        request_bytes: exchange.requestBytes,
        response_bytes: exchange.responseBytes,
        on_premises: exchange.onPremises,
        pending: exchange.pending,
        ...(exchange.answerAddress
          ? { answer_address: exchange.answerAddress }
          : {}),
      },
    });
    if (error instanceof BrokerRequestError) {
      if (error.code === "timeout")
        unit.fail(error, { outcome: "timeout", reason: "timeout" });
      else if (error.code === "network")
        unit.fail(error, { reason: "network" });
      else if (error.reason === "operation_ended")
        unit.cancel("operation_ended");
      else unit.refuse(error.reason);
    } else if (error !== undefined) {
      unit.cancel("aborted");
    }
    unit.end();
  }

  private async request(
    caller: BrokerCaller,
    request: BrokerHttpRequest,
    ended: AbortSignal,
  ): Promise<BrokerResponse> {
    const body = bodyBytes(request?.body);
    const exchange: Exchange = {
      pluginId: caller.pluginId,
      redirects: 0,
      requestBytes: body?.byteLength ?? 0,
      responseBytes: 0,
      onPremises: false,
      pending: false,
    };
    return await this.run(
      caller,
      exchange,
      String(request?.method),
      [request?.signal, ended],
      body,
      async (signal) => {
        if (
          typeof request !== "object" ||
          request === null ||
          typeof request.connectionId !== "string" ||
          !(pluginHttpMethods as readonly string[]).includes(request.method)
        ) {
          throw refused(
            "invalid_request",
            "A request names a connection and a method.",
          );
        }
        if (request.body !== undefined && body === undefined) {
          throw refused("invalid_request", "A body is a string or bytes.");
        }
        const connection = await this.connectionOf(
          caller,
          request.connectionId,
        );
        exchange.connectionId =
          caller.pending?.id === connection.id ? undefined : connection.id;
        exchange.pending = caller.pending?.id === connection.id;
        exchange.onPremises = connection.onPremises;
        const auth = caller.manifest.network?.auth;
        const target = targetOf(caller.manifest, connection, request);
        exchange.hostKind = target.hostKind;
        exchange.pathTemplate = target.pathTemplate;
        const headers = requestHeaders(caller.manifest, request.headers, auth);
        // Already refused above; the auth scheme's own header, too.
        for (const name of authSchemeHeaders(auth)) delete headers[name];
        return await this.exchange(
          {
            target,
            method: request.method,
            headers,
            body,
            onPremises: connection.onPremises,
            secrets: connection.secrets,
          },
          signal,
          exchange,
        );
      },
    );
  }

  /**
   * The caller's own connection: the pending one, or one it saved. The
   * same rules hold for both: on-premises counts only while the manifest
   * allows it, and only the access choices that are on stay, those always on
   * included and those the manifest no longer declares dropped.
   */
  private async connectionOf(
    caller: BrokerCaller,
    connectionId: string,
  ): Promise<BrokerConnection> {
    const connection =
      caller.pending && caller.pending.id === connectionId
        ? caller.pending
        : await this.options.connections.connection(
            caller.pluginId,
            connectionId,
            caller.manifest,
          );
    if (!connection) throw refused("connection_not_found", NOT_FOUND_MESSAGE);
    return {
      ...connection,
      onPremises:
        connection.onPremises &&
        caller.manifest.network?.baseAddress?.allowOnPremises === true,
      access: connectionAccessOn(
        caller.manifest.connectionAccess,
        connection.access,
      ),
    };
  }

  /** Refuses an address the connection may not reach. */
  private async checkAddress(
    url: URL,
    onPremises: boolean,
  ): Promise<{ proxied: boolean; proxyAddresses?: readonly string[] }> {
    if (onPremises) return { proxied: false };
    const hostname = unbracketed(url.hostname);
    if (isAddressLiteral(url.hostname)) {
      if (isPrivateAddress(hostname)) throw this.privateAddress();
      return { proxied: false };
    }
    const resolver = this.options.resolver ?? nodeResolver;
    let resolved: Awaited<ReturnType<BrokerResolver["resolve"]>>;
    try {
      resolved = await resolver.resolve(hostname, url.href);
    } catch {
      throw new BrokerRequestError(
        "network",
        "network",
        "The service's address couldn't be found.",
      );
    }
    if (resolved.addresses.some(isPrivateAddress)) throw this.privateAddress();
    if (resolved.addresses.length === 0 && !resolved.proxied) {
      throw new BrokerRequestError(
        "network",
        "network",
        "The service's address couldn't be found.",
      );
    }
    // A proxy that answers for any name gives no local address to judge, so
    // a name that is no public domain name, such as `intranet` or
    // `wiki.corp.local`, could reach the internal network through it.
    if (
      resolved.proxied === true &&
      resolved.addresses.length === 0 &&
      !isPublicDomainName(hostname)
    ) {
      throw this.privateAddress();
    }
    return resolved.proxied === true
      ? {
          proxied: true,
          ...(resolved.proxyAddresses
            ? { proxyAddresses: resolved.proxyAddresses }
            : {}),
        }
      : { proxied: false };
  }

  /**
   * Refuses an answer from a private address the connection may not reach,
   * which the host's name pointed to after it was checked (ADR 0010's
   * rebinding window), and records how far the address could be judged.
   * Through a proxy the proxy answers, and its address isn't judged; one
   * that answers from an address no proxy has, as when a PAC file falls
   * back to `DIRECT`, is. With no address from the transport, the request
   * stays allowed, and its event says so.
   */
  private checkAnswer(
    remoteAddress: string | undefined,
    route: { proxied: boolean; proxyAddresses?: readonly string[] },
    exchange: Exchange,
  ) {
    let judged: PluginRequestAnswerAddress;
    if (remoteAddress === undefined) {
      judged = "unknown";
    } else if (
      route.proxied &&
      (route.proxyAddresses === undefined ||
        route.proxyAddresses.some((proxy) => sameAddress(proxy, remoteAddress)))
    ) {
      judged = "proxy";
    } else {
      if (isPrivateAddress(remoteAddress)) throw this.privateAddress();
      judged = "checked";
    }
    // A request is as judged as its least judged exchange.
    const order: PluginRequestAnswerAddress[] = ["checked", "proxy", "unknown"];
    if (
      exchange.answerAddress === undefined ||
      order.indexOf(judged) > order.indexOf(exchange.answerAddress)
    ) {
      exchange.answerAddress = judged;
    }
  }

  private privateAddress() {
    return refused(
      "private_address",
      "The service's address is on this computer or a private network. Mark the connection as on-premises to reach it.",
    );
  }

  /** Sends the request and follows what the rules let it follow. */
  private async exchange(
    plan: {
      target: Target;
      method: PluginHttpMethod;
      headers: Record<string, string>;
      body: Uint8Array | undefined;
      onPremises: boolean;
      /** The connection's secret values, scrubbed from the answer. */
      secrets: readonly string[];
    },
    signal: AbortSignal,
    exchange: Exchange,
  ): Promise<BrokerResponse> {
    const transport = this.options.transport!;
    const { target } = plan;
    /**
     * The addresses a secret address redirected to: they often carry a
     * signed token of their own, so they are scrubbed like the secret.
     */
    const visited: string[] = [];
    let url = target.url;
    let method = plan.method;
    let body = plan.body;
    const origin = url.origin;
    for (;;) {
      const route = await this.checkAddress(url, plan.onPremises);
      if (signal.aborted) throw abortError(signal);
      const response = await transport.send({
        url: url.href,
        method,
        headers: {
          ...plan.headers,
          ...(url.origin === origin ? target.authHeaders : {}),
        },
        ...(body !== undefined ? { body } : {}),
        signal,
        maxResponseBytes: this.limits.responseBodyBytes,
      });
      if (!plan.onPremises) {
        this.checkAnswer(response.remoteAddress, route, exchange);
      }
      if (response.body.byteLength > this.limits.responseBodyBytes) {
        throw Object.assign(new Error("too large"), {
          code: "response_too_large",
        });
      }
      const location = response.headers.location;
      if (REDIRECT_STATUSES.has(response.status) && location !== undefined) {
        let next: URL | undefined;
        try {
          next = new URL(location, url);
        } catch {
          next = undefined;
        }
        // A 303, or a 301 or 302 after a POST, turns into a GET.
        const nextMethod: PluginHttpMethod =
          response.status === 303 ||
          ((response.status === 301 || response.status === 302) &&
            method === "POST")
            ? method === "HEAD"
              ? "HEAD"
              : "GET"
            : method;
        // A same-origin redirect is followed only where the policy would
        // let the plugin send the request itself.
        const follow = target.secretAddress
          ? next?.protocol === "https:" &&
            next.href.length <= MAX_REDIRECT_ADDRESS
          : next !== undefined &&
            next.origin === origin &&
            target.allows(nextMethod, next);
        if (follow && exchange.redirects < this.limits.redirects) {
          exchange.redirects += 1;
          if (response.status === 303 || nextMethod !== method) {
            method = nextMethod;
            body = undefined;
          }
          next!.hash = "";
          url = next!;
          if (target.secretAddress) visited.push(url.href);
          continue;
        }
        if (target.secretAddress) {
          // Handing the 3xx back would give the address away.
          throw refused(
            "redirect_refused",
            follow
              ? "The connection's secret address redirected more than 3 times."
              : next !== undefined && next.href.length > MAX_REDIRECT_ADDRESS
                ? "The connection's secret address redirected to an address too long to check."
                : "The connection's secret address redirected to an address that isn't https.",
          );
        }
      }
      // The values built from a secret, such as a Basic credential, may be
      // echoed too, and so may the addresses a secret address led to.
      const redaction = new SecretBytesRedaction(
        [...plan.secrets, ...visited, ...target.credentials].flatMap(
          secretEchoForms,
        ),
      );
      const scrubbed = redaction.bytes(response.body);
      if (scrubbed === undefined) {
        throw new BrokerRequestError(
          "limit",
          "unchecked_response",
          "The service's answer couldn't be checked for secrets, so it was dropped.",
        );
      }
      return {
        status: response.status,
        headers: responseHeaders(
          response.headers,
          redaction,
          target.secretAddress,
        ),
        body: scrubbed,
      };
    }
  }

  private async publicFetch(
    caller: BrokerCaller,
    rawUrl: string,
    init: BrokerPublicFetchInit = {},
    ended: AbortSignal,
  ): Promise<BrokerResponse> {
    const method = init?.method ?? "GET";
    const exchange: Exchange = {
      pluginId: caller.pluginId,
      hostKind: "public",
      redirects: 0,
      requestBytes: 0,
      responseBytes: 0,
      onPremises: false,
      pending: false,
    };
    return await this.run(
      caller,
      exchange,
      String(method),
      [init?.signal, ended],
      undefined,
      async (signal) => {
        if (method !== "GET" && method !== "HEAD") {
          throw refused(
            "invalid_request",
            "ajour.publicFetch sends GET or HEAD only.",
          );
        }
        let url: URL;
        try {
          url = new URL(String(rawUrl));
        } catch {
          throw refused(
            "invalid_request",
            "ajour.publicFetch takes an absolute https address.",
          );
        }
        if (
          url.protocol !== "https:" ||
          url.username ||
          url.password ||
          url.port
        ) {
          throw refused(
            "not_allowed",
            "ajour.publicFetch reaches https addresses on their default port, without a user name.",
          );
        }
        const publicHosts = caller.manifest.network?.publicHosts ?? [];
        if (!publicHosts.includes(url.hostname)) {
          throw refused(
            "not_allowed",
            "The plugin's manifest declares no public host by that name.",
          );
        }
        url.hash = "";
        const headers = requestHeaders(
          caller.manifest,
          init?.headers,
          undefined,
        );
        return await this.exchange(
          {
            target: {
              url,
              hostKind: "public",
              // Any path of a declared public host: it has no endpoints.
              allows: () => true,
              authHeaders: {},
              credentials: [],
              secretAddress: false,
            },
            method,
            headers,
            body: undefined,
            onPremises: false,
            secrets: [],
          },
          signal,
          exchange,
        );
      },
    );
  }
}

/** Node's resolver, every address of the host. The desktop app passes its session's. */
const nodeResolver: BrokerResolver = {
  async resolve(hostname) {
    const { lookup } = await import("node:dns/promises");
    const answers = await lookup(hostname, { all: true, verbatim: true });
    return { addresses: answers.map((answer) => answer.address) };
  },
};
