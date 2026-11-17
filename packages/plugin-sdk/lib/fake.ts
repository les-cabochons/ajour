import type { PluginHttpMethod, PluginManifest } from "./contract.js";
import type {
  Ajour,
  AjourHttpRequest,
  AjourProcessRequest,
  AjourProcessResult,
  AjourSessionOpenRequest,
  AjourSessionRead,
  AjourLogFields,
  AjourLogLevel,
  AjourPublicFetchInit,
  AjourQueryValue,
  AjourRequestError,
  AjourRequestErrorCode,
  AjourResponse,
} from "./runtime.js";
import {
  connectionAccessOn,
  endpointPatternMatches,
  isDeniedHeaderName,
} from "./request-rules.js";

/** An answer a route gives. `json` is sent as the body, with its content type. */
export interface FakeResponseInit {
  status?: number;
  headers?: Readonly<Record<string, string>>;
  body?: string | Uint8Array;
  json?: unknown;
}

/** A request as the fake received it. Header names are lowercase. */
export interface RecordedHttpRequest {
  connectionId: string;
  host?: string;
  method: PluginHttpMethod;
  path: string;
  query?: Readonly<
    Record<string, AjourQueryValue | readonly AjourQueryValue[]>
  >;
  headers: Record<string, string>;
  body?: string | Uint8Array | ArrayBuffer;
  /** The body decoded as UTF-8, for assertions. */
  bodyText?: string;
}

export interface RecordedPublicRequest {
  url: string;
  method: "GET" | "HEAD";
  headers: Record<string, string>;
}

export type FakeResponder<Request> =
  | FakeResponseInit
  | ((request: Request) => FakeResponseInit | Promise<FakeResponseInit>);

export interface FakeHttpRoute {
  /** Answers only this connection. Absent: every connection. */
  connectionId?: string;
  /** Answers only this derived host. Absent: the base address. */
  host?: string;
  method: PluginHttpMethod;
  /** A path pattern, as in the manifest: `*` is one segment, `**` the rest. */
  path: string;
  respond: FakeResponder<RecordedHttpRequest>;
}

export interface FakePublicRoute {
  /** The whole URL, query included. */
  url: string;
  method?: "GET" | "HEAD";
  respond: FakeResponder<RecordedPublicRequest>;
}

export interface FakeAjourOptions {
  routes?: readonly FakeHttpRoute[];
  openExternal?: (url: string) => Promise<void>;
  processRun?: (request: AjourProcessRequest) => Promise<AjourProcessResult>;
  /**
   * Starts the program behind a fake process session. Without it, every
   * `ajour.process.session.open` is refused with `undeclared`.
   */
  processSession?: (
    request: AjourSessionOpenRequest,
    program: FakeSessionProgram,
  ) => FakeSessionHandler | Promise<FakeSessionHandler>;
  publicRoutes?: readonly FakePublicRoute[];
  /**
   * The plugin's manifest. With it, the fake refuses what Ajour's broker
   * would: an endpoint, derived host, header or public host the manifest
   * doesn't declare.
   */
  manifest?: PluginManifest;
  /**
   * The access choices each connection turned on, by connection id. A choice
   * marked `always` is on for every connection, and every other choice is
   * off until listed here. With a manifest, an endpoint behind a choice
   * that is off is refused, as the broker refuses it.
   */
  access?: Readonly<Record<string, readonly string[]>>;
  /**
   * The base address of the connection the operation under test runs
   * through, for a declared command's `connection-url` slots. With a
   * manifest, the fake fills each such slot with it before `processRun`
   * sees the request, refuses a value the plugin passes for one, and
   * refuses the command when no address is supplied, as Ajour does in an
   * operation without a connection.
   */
  connectionUrl?: string;
  /**
   * The hook URL of the start under test (#726), for a declared command's
   * `hook-url` arguments. With a manifest, the fake fills each one with it,
   * or with its template holding it at each `{url}`, before `processRun`
   * sees the request, refuses a value the plugin passes for one, and refuses
   * the command with `hook_refused` when no hook URL is supplied, as Ajour
   * does outside a start.
   */
  hookUrl?: string;
}

/**
 * A declared command's `hook-url` arguments that apply to a request, by
 * name, with their template when they have one.
 */
function hookUrlSlots(
  args: readonly unknown[],
  given: Readonly<Record<string, unknown>>,
): Array<{ name: string; template?: string }> {
  return args.flatMap((arg): Array<{ name: string; template?: string }> => {
    if (typeof arg === "string") {
      const match = /^{([a-zA-Z][a-zA-Z0-9_-]{0,79}):hook-url}$/.exec(arg);
      return match ? [{ name: match[1]! }] : [];
    }
    if (arg && typeof arg === "object" && "args" in arg) {
      const group = arg as { if?: string; args: readonly unknown[] };
      return group.if !== undefined && Object.hasOwn(given, group.if)
        ? hookUrlSlots(group.args, given)
        : [];
    }
    if (
      arg &&
      typeof arg === "object" &&
      (arg as { kind?: unknown }).kind === "hook-url"
    ) {
      const { name, template } = arg as { name: string; template?: string };
      return [{ name, ...(template !== undefined ? { template } : {}) }];
    }
    return [];
  });
}

/**
 * The names of a declared command's `{name:connection-url}` slots that
 * apply to a request: those outside conditional groups, and those in a
 * group whose slot the request passes.
 */
function connectionUrlSlots(
  args: readonly unknown[],
  given: Readonly<Record<string, unknown>>,
): string[] {
  return args.flatMap((arg) => {
    if (typeof arg === "string") {
      const match = /^\{([a-zA-Z][a-zA-Z0-9_-]{0,79}):connection-url\}$/.exec(
        arg,
      );
      return match ? [match[1]!] : [];
    }
    if (arg && typeof arg === "object" && "args" in arg) {
      const group = arg as { if?: string; args: readonly unknown[] };
      return group.if !== undefined && Object.hasOwn(given, group.if)
        ? connectionUrlSlots(group.args, given)
        : [];
    }
    return [];
  });
}

export interface FakeLogLine {
  level: AjourLogLevel;
  message: string;
  fields?: AjourLogFields;
}

/** What a fake session's program can do on its own, at any time. */
export interface FakeSessionProgram {
  /** Writes one line to the session's stdout. */
  write(line: string): void;
  /** Writes text to the session's stderr. */
  writeStderr(text: string): void;
  /** Ends the program, as if it exited by itself. */
  exit(code?: number): void;
}

/** Answers what the plugin sends to a fake session. */
export interface FakeSessionHandler {
  /** Receives one line the plugin sent; the lines it returns go to stdout. */
  receive?(
    line: string,
  ): void | readonly string[] | Promise<void | readonly string[]>;
  /** Called when the plugin closes the session. */
  close?(): void;
}

/** A fake session as the plugin used it, for assertions. */
export interface RecordedSession {
  id: string;
  command: string;
  args: Readonly<Record<string, string | number>>;
  /** The lines the plugin sent, without the newline Ajour adds. */
  sent: string[];
  state: "open" | "exited" | "closed";
}

/** An `ajour` that answers from fixtures and records every call. */
export interface FakeAjour extends Ajour {
  readonly requests: RecordedHttpRequest[];
  readonly publicRequests: RecordedPublicRequest[];
  readonly sessions: RecordedSession[];
  readonly logs: FakeLogLine[];
}

/**
 * Whether a request path matches a path pattern, as Ajour's broker decides
 * it: `*` matches one segment, `**` the rest, and a path with an empty, `.`
 * or `..` segment, a `;`, a control character, or an encoded slash, matches
 * nothing.
 */
export function routeMatches(pattern: string, path: string) {
  return endpointPatternMatches(pattern, path);
}

function requestError(
  code: AjourRequestErrorCode,
  message: string,
): AjourRequestError {
  return Object.assign(new Error(message), {
    name: "AjourRequestError" as const,
    code,
  });
}

function abortError(signal: AbortSignal) {
  return signal.reason instanceof Error
    ? signal.reason
    : new DOMException("The operation was aborted.", "AbortError");
}

function lowercaseHeaders(headers: Readonly<Record<string, string>> = {}) {
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]),
  );
}

function decodeBody(body: string | Uint8Array | ArrayBuffer | undefined) {
  if (body === undefined) return undefined;
  return typeof body === "string" ? body : new TextDecoder().decode(body);
}

function response(init: FakeResponseInit): AjourResponse {
  const headers = lowercaseHeaders(init.headers);
  let text = decodeBody(init.body) ?? "";
  if (init.json !== undefined) {
    text = JSON.stringify(init.json);
    headers["content-type"] ??= "application/json";
  }
  const status = init.status ?? 200;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers,
    text: async () => text,
    json: async () => JSON.parse(text),
  };
}

/** Waits for the responder, unless the signal fires first. */
async function answer<Request>(
  responder: FakeResponder<Request>,
  request: Request,
  signal: AbortSignal | undefined,
) {
  if (signal?.aborted) throw abortError(signal);
  const init = typeof responder === "function" ? responder(request) : responder;
  if (!signal) return response(await init);
  return await new Promise<AjourResponse>((resolve, reject) => {
    const onAbort = () => reject(abortError(signal));
    signal.addEventListener("abort", onAbort, { once: true });
    Promise.resolve(init).then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(response(value));
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function authHeaders(manifest: PluginManifest) {
  const auth = manifest.network?.auth;
  if (!auth) return [];
  if (auth.scheme === "headerTemplate") return [auth.header.toLowerCase()];
  return auth.scheme === "secretAddress" ? [] : ["authorization"];
}

/** What the broker would refuse about the request, if anything. */
function refusal(
  manifest: PluginManifest,
  request: AjourHttpRequest,
  turnedOn: readonly string[],
) {
  const network = manifest.network;
  const where = request.host ? `host "${request.host}"` : "the base address";
  const describe = `${request.method} ${request.path}`;
  if (network?.auth?.scheme === "secretAddress") {
    if (
      request.host ||
      request.method !== "GET" ||
      request.path !== "" ||
      request.query !== undefined
    ) {
      return "A secret address takes only a GET with an empty path and no query.";
    }
  } else {
    const endpoints = request.host
      ? network?.derivedHosts?.find((host) => host.id === request.host)
          ?.endpoints
      : network?.endpoints;
    if (request.host && endpoints === undefined) {
      return `The manifest derives no host "${request.host}".`;
    }
    const matching = (endpoints ?? []).filter(
      (endpoint) =>
        endpoint.method === request.method &&
        endpointPatternMatches(endpoint.path, request.path),
    );
    if (matching.length === 0) {
      return `The manifest allows no ${describe} on ${where}.`;
    }
    const on = new Set(
      connectionAccessOn(manifest.connectionAccess ?? [], turnedOn),
    );
    const open = matching.find(
      (endpoint) => endpoint.access === undefined || on.has(endpoint.access),
    );
    if (!open) {
      return `Connection ${request.connectionId} hasn't turned on the access choice "${matching[0]!.access}".`;
    }
  }
  return headerRefusal(manifest, request.headers, authHeaders(manifest));
}

/** A header the broker would refuse: the denylist wins, then the manifest's list. */
function headerRefusal(
  manifest: PluginManifest,
  headers: Readonly<Record<string, string>> | undefined,
  denied: readonly string[],
) {
  const listed = new Set(
    (manifest.network?.requestHeaders ?? []).map((header) =>
      header.toLowerCase(),
    ),
  );
  for (const name of Object.keys(headers ?? {})) {
    const header = name.toLowerCase();
    if (isDeniedHeaderName(header, denied)) {
      return `A plugin may not set the ${name} header.`;
    }
    if (!listed.has(header)) {
      return `The manifest doesn't list the ${name} header.`;
    }
  }
  return undefined;
}

function publicRefusal(
  manifest: PluginManifest,
  url: string,
  init: AjourPublicFetchInit,
) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return `${url} is not an address.`;
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.port !== "" ||
    parsed.username !== "" ||
    parsed.password !== ""
  ) {
    return "ajour.publicFetch reaches https addresses on their default port, without a user name.";
  }
  if (!(manifest.network?.publicHosts ?? []).includes(parsed.hostname)) {
    return `The manifest declares no public host ${parsed.hostname}.`;
  }
  return headerRefusal(manifest, init.headers, []);
}

/**
 * An `ajour` for plugin tests: `http` and `publicFetch` answer from route
 * fixtures instead of the network, and every call is recorded. Install it as
 * the global the plugin reads, such as with `vi.stubGlobal("ajour", fake)`.
 */
export function createFakeAjour(options: FakeAjourOptions = {}): FakeAjour {
  const requests: RecordedHttpRequest[] = [];
  const publicRequests: RecordedPublicRequest[] = [];
  const logs: FakeLogLine[] = [];
  const { manifest } = options;
  const sessions = createFakeSessions(options);

  return {
    open: async (url) => {
      let scheme: string;
      try {
        scheme = new URL(url).protocol.slice(0, -1);
      } catch {
        throw Object.assign(new Error("Invalid link URL."), {
          name: "AjourProcessError",
          code: "invalid_request",
        });
      }
      if (
        !options.openExternal ||
        (scheme !== "https" &&
          !manifest?.processes?.openSchemes?.includes(scheme))
      ) {
        throw Object.assign(new Error("No allowed link fixture supplied."), {
          name: "AjourProcessError",
          code: "undeclared",
        });
      }
      await options.openExternal(url);
    },
    process: {
      run: async (request) => {
        if (
          !options.processRun ||
          (manifest &&
            ("command" in request
              ? !manifest.processes?.commands?.some(
                  (command) => command.id === request.command,
                )
              : manifest.processes?.undeclaredCommands !== true))
        )
          throw Object.assign(new Error("No process fixture supplied."), {
            name: "AjourProcessError",
            code: "undeclared",
          });
        if ("command" in request && manifest) {
          const command = manifest.processes?.commands?.find(
            (candidate) => candidate.id === request.command,
          );
          const slots = connectionUrlSlots(command?.args ?? [], request.args);
          const hooks = hookUrlSlots(command?.args ?? [], request.args);
          if (
            [...slots, ...hooks.map((hook) => hook.name)].some((slot) =>
              Object.hasOwn(request.args, slot),
            )
          )
            throw Object.assign(
              new Error(
                "Ajour fills connection-url and hook-url arguments itself.",
              ),
              { name: "AjourProcessError", code: "invalid_request" },
            );
          if (hooks.length && options.hookUrl === undefined)
            throw Object.assign(new Error("No hook URL fixture supplied."), {
              name: "AjourProcessError",
              code: "hook_refused",
            });
          const args = {
            ...request.args,
            ...Object.fromEntries(
              hooks.map((hook) => [
                hook.name,
                hook.template === undefined
                  ? options.hookUrl!
                  : hook.template.replaceAll("{url}", () => options.hookUrl!),
              ]),
            ),
          };
          if (slots.length && options.connectionUrl === undefined)
            throw Object.assign(
              new Error("No connection address fixture supplied."),
              { name: "AjourProcessError", code: "connection_refused" },
            );
          if (slots.length || hooks.length)
            return options.processRun({
              ...request,
              args: {
                ...args,
                ...Object.fromEntries(
                  slots.map((slot) => [slot, options.connectionUrl!]),
                ),
              },
            });
        }
        return options.processRun(request);
      },
      session: sessions.api,
    },
    requests,
    publicRequests,
    sessions: sessions.recorded,
    logs,

    async http(request) {
      const recorded: RecordedHttpRequest = {
        connectionId: request.connectionId,
        ...(request.host !== undefined ? { host: request.host } : {}),
        method: request.method,
        path: request.path,
        ...(request.query !== undefined ? { query: request.query } : {}),
        headers: lowercaseHeaders(request.headers),
        ...(request.body !== undefined
          ? { body: request.body, bodyText: decodeBody(request.body) }
          : {}),
      };
      requests.push(recorded);
      if (request.signal?.aborted) throw abortError(request.signal);
      const refused =
        manifest &&
        refusal(
          manifest,
          request,
          options.access?.[request.connectionId] ?? [],
        );
      if (refused) throw requestError("refused", refused);
      const route = (options.routes ?? []).find(
        (candidate) =>
          (candidate.connectionId === undefined ||
            candidate.connectionId === request.connectionId) &&
          candidate.host === request.host &&
          candidate.method === request.method &&
          (candidate.path === request.path ||
            routeMatches(candidate.path, request.path)),
      );
      if (!route) {
        const where = request.host ? ` host "${request.host}" of` : "";
        throw new Error(
          `No fake route answers ${request.method} ${request.path} on${where} connection ${request.connectionId}.`,
        );
      }
      return await answer(route.respond, recorded, request.signal);
    },

    async publicFetch(url: string, init: AjourPublicFetchInit = {}) {
      const recorded: RecordedPublicRequest = {
        url,
        method: init.method ?? "GET",
        headers: lowercaseHeaders(init.headers),
      };
      publicRequests.push(recorded);
      if (init.signal?.aborted) throw abortError(init.signal);
      const refused = manifest && publicRefusal(manifest, url, init);
      if (refused) throw requestError("refused", refused);
      const route = (options.publicRoutes ?? []).find(
        (candidate) =>
          candidate.url === url &&
          (candidate.method ?? "GET") === recorded.method,
      );
      if (!route) {
        throw new Error(
          `No fake public route answers ${recorded.method} ${url}.`,
        );
      }
      return await answer(route.respond, recorded, init.signal);
    },

    log(level, message, fields) {
      logs.push({ level, message, ...(fields ? { fields } : {}) });
    },
  };
}

function processError(code: string, message: string) {
  return Object.assign(new Error(message), {
    name: "AjourProcessError" as const,
    code,
  });
}

/**
 * Process sessions as Ajour's broker keeps them: declared `session`
 * commands only, at most 2 open, lines checked as the broker checks them.
 * It doesn't bound the buffer, wait for lines or end idle sessions.
 */
function createFakeSessions(options: FakeAjourOptions) {
  interface Live {
    record: RecordedSession;
    handler: FakeSessionHandler;
    lines: string[];
    stderr: string;
    exitCode: number | null;
  }
  const recorded: RecordedSession[] = [];
  const live = new Map<string, Live>();
  let next = 1;
  const find = (id: string) => {
    const session = live.get(id);
    if (!session)
      throw processError("session_ended", "This process session has ended.");
    return session;
  };
  const api: Ajour["process"]["session"] = {
    async open(request) {
      const declared = options.manifest?.processes?.commands?.find(
        (command) => command.id === request.command,
      );
      if (!options.processSession || (options.manifest && !declared))
        throw processError(
          "undeclared",
          "No process session fixture supplied.",
        );
      if (declared && declared.mode !== "session")
        throw processError("invalid_request", "Not a session command.");
      if (
        [...live.values()].filter((s) => s.record.state === "open").length >= 2
      )
        throw processError(
          "session_limit",
          "A plugin keeps at most 2 process sessions.",
        );
      const id = `fake-session-${next++}`;
      const record: RecordedSession = {
        id,
        command: request.command,
        args: { ...request.args },
        sent: [],
        state: "open",
      };
      const session: Live = {
        record,
        handler: {},
        lines: [],
        stderr: "",
        exitCode: null,
      };
      live.set(id, session);
      recorded.push(record);
      session.handler = await options.processSession(request, {
        write: (line) => {
          if (record.state === "open") session.lines.push(line);
        },
        writeStderr: (text) => {
          if (record.state === "open") session.stderr += text;
        },
        exit: (code = 0) => {
          if (record.state !== "open") return;
          record.state = "exited";
          session.exitCode = code;
        },
      });
      return id;
    },
    async send(id, line) {
      const session = find(id);
      if (
        typeof line !== "string" ||
        /[\0\r\n]/.test(line) ||
        new TextEncoder().encode(line).length > 1024 * 1024
      )
        throw processError("invalid_request", "Send one line of at most 1 MB.");
      if (session.record.state !== "open")
        throw processError("session_ended", "This process session has ended.");
      session.record.sent.push(line);
      const answer = await session.handler.receive?.(line);
      if (answer && session.record.state === "open")
        session.lines.push(...answer);
    },
    async read(id, readOptions = {}): Promise<AjourSessionRead> {
      const session = find(id);
      const { max = 100, waitMs = 0 } = readOptions;
      if (
        !Number.isInteger(max) ||
        max < 1 ||
        max > 1000 ||
        !Number.isInteger(waitMs) ||
        waitMs < 0 ||
        waitMs > 30_000
      )
        throw processError("invalid_request", "Invalid read options.");
      const lines = session.lines.splice(0, max);
      const result: AjourSessionRead = {
        lines,
        dropped: false,
        stderr: session.stderr,
        exited: session.record.state === "exited" && session.lines.length === 0,
        exitCode: session.exitCode,
      };
      session.stderr = "";
      if (result.exited) live.delete(id);
      return result;
    },
    async close(id) {
      const session = find(id);
      live.delete(id);
      if (session.record.state === "open") {
        session.record.state = "closed";
        session.handler.close?.();
      }
    },
  };
  return { api, recorded };
}
