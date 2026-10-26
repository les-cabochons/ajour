import type {
  BacklogCommentOperations,
  BacklogSyncResult,
  BacklogSyncWorkItem,
  CalendarOperations,
  CodeHostOperations,
  DataShapeExportProject,
  DataShapeExportResult,
  DataShapeImportResult,
  DataShapeSheet,
  PluginConnection,
  PluginHttpMethod,
  ReadDescriptionRequest,
  ReadDescriptionResult,
  SettleStatesRequest,
  SettleStatesResult,
  SettleWriteRequest,
  SettleWriteResult,
  ValidationContext,
  ValidationResult,
  WriteDescriptionRequest,
  WriteDescriptionResult,
} from "./contract.js";

export type AjourQueryValue = string | number | boolean;

/**
 * A request Ajour's broker sends for the plugin. It names a connection and a
 * path relative to that connection's address, never a URL or a credential:
 * the broker builds the URL from the address the user saved and attaches
 * the credential itself.
 */
export interface AjourHttpRequest {
  /** One of the plugin's own connections. */
  connectionId: string;
  /** A derived host's id, such as `vssps`. Absent for the base address. */
  host?: string;
  method: PluginHttpMethod;
  /**
   * A path the manifest's endpoint allowlist holds for the host, such as
   * `/rest/api/3/issue/ENG-1`. Empty for a secret address.
   */
  path: string;
  query?: Readonly<
    Record<string, AjourQueryValue | readonly AjourQueryValue[]>
  >;
  /** Only headers the manifest lists. The broker sets the auth header. */
  headers?: Readonly<Record<string, string>>;
  body?: string | Uint8Array | ArrayBuffer;
  /** Cancels the request when it fires, as with `fetch`. */
  signal?: AbortSignal;
}

/** An answer, read whole. Header names are lowercase. */
export interface AjourResponse {
  readonly status: number;
  /** Whether the status is 200 to 299. */
  readonly ok: boolean;
  readonly headers: Readonly<Record<string, string>>;
  text(): Promise<string>;
  json<Value = unknown>(): Promise<Value>;
}

export interface AjourPublicFetchInit {
  method?: "GET" | "HEAD";
  headers?: Readonly<Record<string, string>>;
  signal?: AbortSignal;
}

export type AjourLogLevel = "debug" | "info" | "warn" | "error";
/** Log fields hold ids and counts, never content or secrets. */
export type AjourLogFields = Readonly<
  Record<string, string | number | boolean | null>
>;

/**
 * Why the broker didn't send a request: `refused` when the manifest or the
 * connection's access doesn't allow it, `limit` when it is too large or too
 * frequent, `timeout`, or `network` when the service couldn't be reached.
 */
export type AjourRequestErrorCode = "refused" | "limit" | "timeout" | "network";

/** How `ajour.http` and `ajour.publicFetch` reject, apart from an abort. */
export interface AjourRequestError extends Error {
  name: "AjourRequestError";
  code: AjourRequestErrorCode;
}

/**
 * The `ajour` global a plugin's code receives in its sandboxed worker. It
 * is the plugin's one way out: there is no `fetch` to the network, no Node
 * and no `Buffer`.
 */
export interface Ajour {
  /** Sends a request through one of the plugin's connections. */
  http(request: AjourHttpRequest): Promise<AjourResponse>;
  /**
   * Fetches an https URL on a public host the manifest declares, without
   * credentials, such as an avatar.
   */
  publicFetch(url: string, init?: AjourPublicFetchInit): Promise<AjourResponse>;
  /** Adds a line to Ajour's own log for the plugin. */
  log(level: AjourLogLevel, message: string, fields?: AjourLogFields): void;
}

type Awaitable<Value> = Value | Promise<Value>;

type OperationHandlers<
  Table extends Record<string, { request: unknown; result: unknown }>,
> = {
  [Name in keyof Table]?: (
    connection: PluginConnection,
    request: Table[Name]["request"],
  ) => Awaitable<Table[Name]["result"]>;
};

/**
 * What a plugin's entrypoint exports: one function per operation it serves.
 * Each receives the connection without its secrets. Unlike plugin API 3,
 * `validateConnection` receives the connection too, so it can call
 * `ajour.http` with its id.
 */
export type PluginModule = {
  validateConnection?: (
    connection: PluginConnection,
    context: ValidationContext,
  ) => Awaitable<ValidationResult>;
  syncConnection?: (
    connection: PluginConnection,
    workItems: BacklogSyncWorkItem[],
  ) => Awaitable<BacklogSyncResult>;
  listSettleStates?: (
    connection: PluginConnection,
    request: SettleStatesRequest,
  ) => Awaitable<SettleStatesResult>;
  writeSettle?: (
    connection: PluginConnection,
    request: SettleWriteRequest,
  ) => Awaitable<SettleWriteResult>;
  readDescription?: (
    connection: PluginConnection,
    request: ReadDescriptionRequest,
  ) => Awaitable<ReadDescriptionResult>;
  writeDescription?: (
    connection: PluginConnection,
    request: WriteDescriptionRequest,
  ) => Awaitable<WriteDescriptionResult>;
} & OperationHandlers<CodeHostOperations> &
  OperationHandlers<CalendarOperations> &
  OperationHandlers<BacklogCommentOperations>;

/**
 * What a project data shape plugin's entrypoint exports. `exportProjects` is
 * needed only when the manifest declares datasets, its export layout.
 */
export interface DataShapeModule {
  exportProjects?: (
    projects: DataShapeExportProject[],
  ) => Awaitable<DataShapeExportResult>;
  importProjects?: (
    sheets: DataShapeSheet[],
  ) => Awaitable<DataShapeImportResult>;
}
