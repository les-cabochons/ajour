import type {
  StartHandoffRequest,
  StartHandoffResult,
  ReadHandoffStatesRequest,
  ReadHandoffStatesResult,
  ListThreadsRequest,
  ListThreadsResult,
  CloseThreadRequest,
  CloseThreadResult,
  DetectToolsResult,
  BacklogCommentOperations,
  BacklogSyncResult,
  BacklogSyncWorkItem,
  CalendarOperations,
  CodeHostOperations,
  DataShapeExportProject,
  DataShapeExportResult,
  DataShapeImportResult,
  DataShapeSheet,
  DescribeItemTypesRequest,
  DescribeItemTypesResult,
  PluginConnection,
  PluginHttpMethod,
  ProjectSourceSyncRequest,
  ProjectSourceSyncResult,
  ReadDescriptionRequest,
  ReadDescriptionResult,
  SearchAssigneesRequest,
  SearchAssigneesResult,
  SettleStatesRequest,
  SettleStatesResult,
  SettleWriteRequest,
  SettleWriteResult,
  TimeSyncAnswer,
  TimeSyncRequest,
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

export interface AjourProcessError extends Error {
  name: "AjourProcessError";
  code: string;
}
export type AjourProcessRequest =
  | { executable: string; argv: readonly string[]; cwdFolder?: string }
  | {
      command: string;
      args: Readonly<Record<string, string | number>>;
      stdin?: string;
    };

export type AjourProcessResult =
  | { started: true; exitCode?: never; stdout?: never; stderr?: never }
  | AjourCaptureResult;
export interface AjourCaptureResult {
  started?: never;

  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/** Opens a declared `session` command: its id and argument slots. */
export interface AjourSessionOpenRequest {
  command: string;
  args: Readonly<Record<string, string | number>>;
}

export interface AjourSessionReadOptions {
  /** Lines to return at most, 1 to 1000. Defaults to 100. */
  max?: number;
  /**
   * How long to wait for a line when none is waiting, 0 to 30000 ms, and
   * never past the operation's own time. Defaults to 0.
   */
  waitMs?: number;
}

/** The stdout lines the program wrote since the last read, oldest first. */
export interface AjourSessionRead {
  lines: string[];
  /** Lines were dropped since the last read: too many waiting, or one over 1 MB. */
  dropped: boolean;
  /** Stderr since the last read, its newest 64 KB. */
  stderr: string;
  /** The program ended and every line it wrote was read: the id is gone. */
  exited: boolean;
  exitCode: number | null;
}

/**
 * A program a declared `session` command keeps running, which the plugin
 * talks to one line at a time, such as a JSON-RPC server on stdio. A session
 * belongs to the plugin, not to the operation that opened it: a later
 * operation reaches it by its id. A plugin keeps at most 2.
 */
export interface AjourProcessSessions {
  /** Starts the program and returns the session's id. */
  open(request: AjourSessionOpenRequest): Promise<string>;
  /** Writes one line to its stdin, with a newline added: at most 1 MB, no NUL or line break. */
  send(id: string, line: string): Promise<void>;
  read(
    id: string,
    options?: AjourSessionReadOptions,
  ): Promise<AjourSessionRead>;
  /** Ends the program and everything it started. */
  close(id: string): Promise<void>;
}
/**
 * The `ajour` global a plugin's code receives in its sandboxed worker. It
 * is the plugin's one way out: there is no `fetch` to the network, no Node
 * and no `Buffer`.
 */
export interface Ajour {
  open(url: string): Promise<void>;
  process: {
    run(request: AjourProcessRequest): Promise<AjourProcessResult>;
    session: AjourProcessSessions;
  };
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

/**
 * What a handoff operation receives: the request alone for a tool that
 * uses no connection, the tool's connection and then the request for one
 * that does.
 */
export type HandoffArguments<Request> =
  [request: Request] | [connection: PluginConnection, request: Request];

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
 * `ajour.http` with its id, and the capabilities that are on, so it checks
 * only their access. `syncProjects` serves the `projectSource` capability:
 * it answers the user's projects as a snapshot, or that nothing changed
 * since the cursor it received. `syncTimeEntries` serves `timeSync`: it
 * runs one round, applying the changes in order, then listing the remote
 * entries in the window.
 */
export type PluginModule = {
  validateConnection?: (
    connection: PluginConnection,
    context: ValidationContext,
  ) => Awaitable<ValidationResult>;
  syncConnection?: (
    connection: PluginConnection,
    workItems: BacklogSyncWorkItem[],
    options?: { sourceIds?: string[] },
  ) => Awaitable<BacklogSyncResult>;
  listSettleStates?: (
    connection: PluginConnection,
    request: SettleStatesRequest,
  ) => Awaitable<SettleStatesResult>;
  writeSettle?: (
    connection: PluginConnection,
    request: SettleWriteRequest,
  ) => Awaitable<SettleWriteResult>;
  searchAssignees?: (
    connection: PluginConnection,
    request: SearchAssigneesRequest,
  ) => Awaitable<SearchAssigneesResult>;
  readDescription?: (
    connection: PluginConnection,
    request: ReadDescriptionRequest,
  ) => Awaitable<ReadDescriptionResult>;
  writeDescription?: (
    connection: PluginConnection,
    request: WriteDescriptionRequest,
  ) => Awaitable<WriteDescriptionResult>;
  /**
   * The item types the connection form shows, for `connector.itemTypes`:
   * each type's icon, its fields, and the fields it would use for a
   * `typeOverrides` field's columns. Answer other types too, for Add a type.
   */
  describeItemTypes?: (
    connection: PluginConnection,
    request: DescribeItemTypesRequest,
  ) => Awaitable<DescribeItemTypesResult>;
  syncProjects?: (
    connection: PluginConnection,
    request: ProjectSourceSyncRequest,
  ) => Awaitable<ProjectSourceSyncResult>;
  /**
   * Called without arguments for the tools that use no connection, and
   * once with each connection the other tools' settings picked, for those.
   */
  detectTools?(connection?: PluginConnection): Awaitable<DetectToolsResult>;
  /**
   * A tool with `connection: "required"` receives its connection first,
   * as every networked operation does; a tool without one receives only
   * the request. A plugin with both kinds reads `args.length`.
   */
  startHandoff?(
    ...args: HandoffArguments<StartHandoffRequest>
  ): Awaitable<StartHandoffResult>;
  /**
   * Ajour never calls it for a tool with `followsState: false`, so a plugin
   * whose tools all set it may leave it out.
   */
  readHandoffStates?(
    ...args: HandoffArguments<ReadHandoffStatesRequest>
  ): Awaitable<ReadHandoffStatesResult>;
  /**
   * A tool's recent threads in one repository folder, with their titles,
   * for a tool that declares `listsThreads`. Ajour offers to link a thread
   * whose title names an item's key in brackets, as `[PAY-12] …`.
   */
  listThreads?(
    ...args: HandoffArguments<ListThreadsRequest>
  ): Awaitable<ListThreadsResult>;
  /**
   * Closes one handoff's thread in its tool, for a tool that declares
   * `closesThreads`: stop its work when it runs, then archive or delete it,
   * as the manifest says. Answer `{}` once it is closed, or when the tool no
   * longer has it; throw to refuse, in words the user reads.
   */
  closeThread?(
    ...args: HandoffArguments<CloseThreadRequest>
  ): Awaitable<CloseThreadResult>;
  syncTimeEntries?: (
    connection: PluginConnection,
    request: TimeSyncRequest,
  ) => Awaitable<TimeSyncAnswer>;
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
