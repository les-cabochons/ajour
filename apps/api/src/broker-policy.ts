/**
 * The credential broker's policy: where a plugin's request may go, by the
 * admitted manifest and the connection. It builds the URL from the saved
 * address and never above its path, or from a derived host; matches the
 * path against the host's endpoints and their access choices; attaches the
 * auth scheme's credential; and checks the headers a plugin sets, where the
 * fixed denylist always wins. It decides; `credential-broker.ts` sends.
 */

import {
  deriveHostAddress,
  endpointPatternMatches,
  isDeniedRequestHeader,
  type PluginApi4Manifest,
  type PluginAuth,
  type PluginEndpoint,
  type PluginHttpMethod,
} from "../../../packages/shared/plugin-api-4.ts";
import type { PluginRequestHostKind } from "../../../packages/wide-events/catalog.ts";
import {
  BrokerRequestError,
  type BrokerConnection,
  type BrokerHttpRequest,
  type BrokerReason,
} from "./broker-port.ts";

export type HostKind = PluginRequestHostKind;

/** Where a request goes, once the policy allowed it. */
export interface Target {
  url: URL;
  hostKind: HostKind;
  /**
   * Whether the policy would allow a request with this method to this
   * same-origin address, as a redirect leads: under the base path, to an
   * endpoint of the host whose access choice is on.
   */
  allows(method: PluginHttpMethod, url: URL): boolean;
  pathTemplate?: string;
  /** Headers the broker attaches, lowercase. */
  authHeaders: Record<string, string>;
  /** Values built from the secret that a service may echo, such as Basic's. */
  credentials: string[];
  secretAddress: boolean;
}

export function refused(reason: BrokerReason, message: string) {
  return new BrokerRequestError("refused", reason, message);
}

function stringValue(value: unknown) {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return undefined;
}

/** A header value a request may carry: no line break or NUL. */
function isHeaderValue(value: unknown): value is string {
  return typeof value === "string" && !/[\r\n\0]/.test(value);
}

/**
 * What a secret address refuses that holds a user name or password, at
 * request time and at save time. It names no part of the address.
 */
export const SECRET_ADDRESS_USERINFO_MESSAGE =
  "The connection's secret address can't hold a user name or password. Enter it again in the connection's settings.";

/** A secret address as the broker reads it: `webcal://` and `webcals://` are https. */
function secretAddressUrl(text: string): URL {
  return new URL(text.trim().replace(/^webcals?:\/\//i, "https://"));
}

/**
 * Whether a secret address holds a user name or password, read as the broker
 * reads it, so `webcal://me:pw@host/feed.ics` counts. An address that isn't
 * one holds none: the broker refuses that later, with its own reason.
 */
export function secretAddressHoldsUserinfo(text: string): boolean {
  try {
    const url = secretAddressUrl(text);
    return url.username !== "" || url.password !== "";
  } catch {
    return false;
  }
}

/** The base address without a trailing slash, query or fragment. */
function parseBaseAddress(value: unknown, onPremises: boolean): URL {
  const text = stringValue(value)?.trim();
  let url: URL;
  try {
    url = new URL(text ?? "");
  } catch {
    throw refused(
      "invalid_address",
      "The connection's address isn't an address. Check it in the connection's settings.",
    );
  }
  if (url.username || url.password) {
    throw refused(
      "invalid_address",
      "The connection's address can't hold a user name or password.",
    );
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && onPremises)) {
    throw refused(
      "invalid_address",
      onPremises
        ? "The connection's address must start with https:// or http://."
        : "The connection's address must start with https://. Only an on-premises connection may use http://.",
    );
  }
  url.search = "";
  url.hash = "";
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url;
}

/** Whether `path` is `basePath` or below it. */
function isUnder(path: string, basePath: string) {
  return (
    basePath === "" || path === basePath || path.startsWith(`${basePath}/`)
  );
}

function appendQuery(url: URL, query: BrokerHttpRequest["query"]) {
  if (query === undefined) return;
  if (typeof query !== "object" || query === null) {
    throw refused("invalid_request", "A query is an object of values.");
  }
  for (const [key, raw] of Object.entries(query)) {
    for (const value of Array.isArray(raw) ? raw : [raw]) {
      const text = stringValue(value);
      if (text === undefined) {
        throw refused(
          "invalid_request",
          "A query value is a string, a number or a boolean.",
        );
      }
      url.searchParams.append(key, text);
    }
  }
}

function base64(text: string) {
  return Buffer.from(text, "utf8").toString("base64");
}

/** The secret field's value as text, or a refusal when it is missing. */
function secretValue(connection: BrokerConnection, field: string): string {
  const value = stringValue(connection.values[field]);
  if (value === undefined || value.length === 0) {
    throw refused(
      "secret_unavailable",
      "This connection has no saved credential. Enter it in the connection's settings.",
    );
  }
  return value;
}

/** The headers the auth scheme attaches, and the values a service may echo. */
function authOf(
  auth: PluginAuth | undefined,
  connection: BrokerConnection,
): { headers: Record<string, string>; credentials: string[] } {
  switch (auth?.scheme) {
    case undefined:
    case "secretAddress":
      return { headers: {}, credentials: [] };
    case "bearer": {
      const secret = secretValue(connection, auth.secretField);
      return {
        headers: { authorization: `Bearer ${secret}` },
        credentials: [],
      };
    }
    case "basic": {
      const user = stringValue(connection.values[auth.userField]) ?? "";
      const pair = `${user}:${secretValue(connection, auth.secretField)}`;
      return {
        headers: { authorization: `Basic ${base64(pair)}` },
        credentials: [pair],
      };
    }
    case "patBasic": {
      const pair = `:${secretValue(connection, auth.secretField)}`;
      return {
        headers: { authorization: `Basic ${base64(pair)}` },
        credentials: [pair],
      };
    }
    case "headerTemplate": {
      const secret = secretValue(connection, auth.secretField);
      // A function, so a `$&` in the secret stays as it is.
      const value = auth.template.replace("{secret}", () => secret);
      return {
        headers: { [auth.header.toLowerCase()]: value },
        credentials: [value],
      };
    }
    default:
      throw refused(
        "not_allowed",
        "This version of Ajour doesn't support the plugin's auth scheme.",
      );
  }
}

/**
 * The endpoints of `endpoints` the request's method and path match, and the
 * first of them the connection's access choices open. `connection.access`
 * holds the choices that are on (see `connectionOf`).
 */
function endpointsFor(
  endpoints: readonly PluginEndpoint[],
  connection: BrokerConnection,
  method: PluginHttpMethod,
  path: string,
) {
  const matching = endpoints.filter(
    (endpoint) =>
      endpoint.method === method && endpointPatternMatches(endpoint.path, path),
  );
  const on = new Set(connection.access);
  const open = matching.find(
    (endpoint) => endpoint.access === undefined || on.has(endpoint.access),
  );
  return { matching, open };
}

/** The endpoint of `endpoints` that allows the request, or a refusal. */
function matchEndpoint(
  endpoints: readonly PluginEndpoint[],
  manifest: PluginApi4Manifest,
  connection: BrokerConnection,
  method: PluginHttpMethod,
  path: string,
  where: string,
): PluginEndpoint {
  const { matching, open } = endpointsFor(endpoints, connection, method, path);
  if (matching.length === 0) {
    throw refused(
      "not_allowed",
      `The plugin's manifest allows no ${method} request to that path on ${where}.`,
    );
  }
  if (!open) {
    const choice = manifest.connectionAccess.find(
      (candidate) => candidate.id === matching[0]!.access,
    );
    throw refused(
      "access_off",
      `This connection's access doesn't include "${choice?.label ?? matching[0]!.access}". Turn it on in the connection's settings.`,
    );
  }
  return open;
}

/** Where a plugin's request goes, by the manifest and the connection. */
export function targetOf(
  manifest: PluginApi4Manifest,
  connection: BrokerConnection,
  request: BrokerHttpRequest,
): Target {
  const network = manifest.network;
  const auth = network?.auth;
  if (auth?.scheme === "secretAddress") {
    if (
      request.host !== undefined ||
      request.method !== "GET" ||
      request.path !== "" ||
      request.query !== undefined
    ) {
      throw refused(
        "not_allowed",
        "A secret address takes only a GET with an empty path and no query.",
      );
    }
    const text = secretValue(connection, auth.secretField);
    let url: URL;
    try {
      url = secretAddressUrl(text);
    } catch {
      throw refused(
        "invalid_address",
        "The connection's secret address isn't an address. Enter it again in the connection's settings.",
      );
    }
    if (url.protocol !== "https:") {
      throw refused(
        "invalid_address",
        "The connection's secret address must start with https:// or webcal://.",
      );
    }
    // The user name and password would ride along on the request, which a
    // secret address was never meant to carry.
    if (url.username || url.password) {
      throw refused("invalid_address", SECRET_ADDRESS_USERINFO_MESSAGE);
    }
    url.hash = "";
    return {
      url,
      hostKind: "secret_address",
      // A secret address follows https redirects to any host, by its own rule.
      allows: () => false,
      authHeaders: {},
      credentials: [],
      secretAddress: true,
    };
  }

  if (!network?.baseAddress) {
    throw refused(
      "not_allowed",
      "The plugin's manifest declares no address its connections reach.",
    );
  }
  if (typeof request.path !== "string" || !request.path.startsWith("/")) {
    throw refused(
      "not_allowed",
      "A request path is relative to the connection's address and starts with /.",
    );
  }
  const base = parseBaseAddress(
    connection.values[network.baseAddress.field],
    connection.onPremises,
  );
  let address = base;
  let hostKind: HostKind = "base";
  let endpoints = network.endpoints;
  let where = "the connection's address";
  if (request.host !== undefined) {
    const derived = network.derivedHosts.find(
      (candidate) => candidate.id === request.host,
    );
    if (!derived) {
      throw refused(
        "not_allowed",
        "The plugin's manifest derives no host with that id.",
      );
    }
    const derivedAddress = deriveHostAddress(derived, base.href);
    if (!derivedAddress) {
      throw refused(
        "not_allowed",
        `The plugin's ${derived.label ?? derived.id} host doesn't apply to this connection's address.`,
      );
    }
    address = new URL(derivedAddress);
    hostKind = "derived";
    endpoints = derived.endpoints;
    where = `its ${derived.id} host`;
  }
  const endpoint = matchEndpoint(
    endpoints,
    manifest,
    connection,
    request.method,
    request.path,
    where,
  );
  const basePath = address.pathname.replace(/\/+$/, "");
  const url = new URL(address.origin);
  url.pathname = `${basePath}${request.path}`;
  // The path is made of literal segments, so the URL keeps it as it is,
  // under the base path. Anything else is refused rather than sent.
  if (
    url.pathname !== `${basePath}${request.path}` ||
    !isUnder(url.pathname, basePath)
  ) {
    throw refused(
      "not_allowed",
      "The request path climbs above the connection's address.",
    );
  }
  appendQuery(url, request.query);
  const { headers, credentials } = authOf(network.auth, connection);
  return {
    url,
    hostKind,
    allows: (method, next) =>
      isUnder(next.pathname, basePath) &&
      endpointsFor(
        endpoints,
        connection,
        method,
        next.pathname.slice(basePath.length),
      ).open !== undefined,
    pathTemplate: endpoint.path,
    authHeaders: headers,
    credentials,
    secretAddress: false,
  };
}

/** The headers a plugin set, checked against the manifest, lowercase. */
export function requestHeaders(
  manifest: PluginApi4Manifest,
  headers: BrokerHttpRequest["headers"],
  auth: PluginAuth | undefined,
): Record<string, string> {
  if (headers === undefined) return {};
  if (typeof headers !== "object" || headers === null) {
    throw refused("invalid_request", "Headers are an object of strings.");
  }
  const listed = new Set(
    (manifest.network?.requestHeaders ?? []).map((name) => name.toLowerCase()),
  );
  const checked: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const header = name.toLowerCase();
    if (isDeniedRequestHeader(header, auth)) {
      throw refused(
        "header_refused",
        `A plugin may not set the ${name} header.`,
      );
    }
    if (!listed.has(header)) {
      throw refused(
        "header_refused",
        `The plugin's manifest doesn't list the ${name} header.`,
      );
    }
    if (!isHeaderValue(value)) {
      throw refused("invalid_request", `The ${name} header's value isn't one.`);
    }
    checked[header] = value;
  }
  return checked;
}
