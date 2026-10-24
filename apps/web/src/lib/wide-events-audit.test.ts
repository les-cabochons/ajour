import { readdirSync, readFileSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { catalog, type AjourEvent } from "@ajour/wide-events/catalog.ts";
import { createEmitter, type Kind } from "@ajour/wide-events";
import { createRecordingSink } from "@ajour/wide-events/sinks.ts";
import { PLUGIN_OPERATION_EVENTS } from "../../../api/src/plugin-host.ts";
import { SCHEMA_OPERATION_EVENTS } from "../../../api/src/project-data-shape-host.ts";
import { ROUTES } from "../../../api/src/routes.ts";
import {
  fetchAsTheApp,
  startLocalApi,
  waitForEvent,
} from "@/test-support/local-api";

/*
 * The catalog audit (#311): the catalog and the code name the same units of
 * work. Each seam's typed table, and every unit a runtime starts by name,
 * must name an event of the catalog that allows the seam's kind. Every
 * catalog entry must be emitted by one of them, and asserted by a test: a
 * test that names it, or a driver here that runs every entry of a table and
 * reads the event each one emits. A new entry that nothing emits or tests,
 * or a unit the catalog lacks, fails here.
 */

type EventName = keyof typeof catalog.events;

const require = createRequire(import.meta.url);
const { IPC_CHANNELS } =
  require("../../../desktop/electron/ipc-channels.cjs") as {
    IPC_CHANNELS: Record<
      string,
      { event: EventName; mode: "invoke" | "message" | "sync" }
    >;
  };
const { createIpcListeners } =
  require("../../../desktop/electron/ipc-listeners.cjs") as {
    createIpcListeners: (
      ipcMain: unknown,
      options: { events: unknown },
    ) => Record<
      "handle" | "onMessage" | "answerSync",
      (channel: string, listener: () => unknown) => void
    >;
  };

const repoRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);
const AUDIT = "apps/web/src/lib/wide-events-audit.test.ts";

/** The files under `folder`, relative to the repository, with forward slashes. */
function filesUnder(folder: string): string[] {
  const absolute = path.join(repoRoot, folder);
  return readdirSync(absolute).flatMap((entry) => {
    if (entry === "node_modules" || entry.startsWith(".")) return [];
    const relative = `${folder}/${entry}`;
    return statSync(path.join(absolute, entry)).isDirectory()
      ? filesUnder(relative)
      : [relative];
  });
}

const isTest = (file: string) =>
  /\.test\.[cm]?[jt]sx?$/.test(file) || /\/(tests|test-support)\//.test(file);
const read = (file: string) => readFileSync(path.join(repoRoot, file), "utf8");

/** The runtime code that may start a unit of work by its name. */
const runtimeFiles = [
  ...filesUnder("apps/api/src"),
  ...filesUnder("apps/desktop/electron"),
  ...filesUnder("apps/web/src"),
].filter((file) => /\.(ts|tsx|cjs|mjs)$/.test(file) && !isTest(file));

/**
 * Every unit a runtime starts, runs or renames by a literal name, and where:
 * the jobs, lifecycle units, crashes and navigations that no table names.
 */
function namedUnits() {
  const units: { name: string; file: string }[] = [];
  for (const file of runtimeFiles) {
    const source = read(file);
    for (const match of source.matchAll(
      /(?:\.(?:start|run|rename)|\bunitFor)\(\s*"([a-z_]+\.[a-z_]+)"/g,
    )) {
      units.push({ name: match[1]!, file });
    }
  }
  return units;
}

/** Each route's request event names: its own, or those of its operations. */
const routeNames = Object.values(ROUTES).flatMap((route) =>
  typeof route.name === "string"
    ? [route.name as EventName]
    : (Object.values(route.name.names) as EventName[]),
);

let storeTable: typeof import("@/lib/local-store").STORE_COMMANDS;
let pullRequestCommands: typeof import("@/lib/local-store").PULL_REQUEST_COMMANDS;
let resolveCommandName: typeof import("@/lib/store-command-events").resolveCommandName;
let clientTable: typeof import("@/lib/app-api").APP_API_CLIENT;

function installWindow() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", {
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    setTimeout,
    clearTimeout,
    localStorage: {
      get length() {
        return values.size;
      },
      key: (index: number) => [...values.keys()][index] ?? null,
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => void values.set(key, value),
      removeItem: (key: string) => void values.delete(key),
      clear: () => values.clear(),
    },
  });
}

beforeAll(async () => {
  installWindow();
  vi.resetModules();
  const store = await import("@/lib/local-store");
  storeTable = store.STORE_COMMANDS;
  pullRequestCommands = store.PULL_REQUEST_COMMANDS;
  resolveCommandName = (await import("@/lib/store-command-events"))
    .resolveCommandName;
  clientTable = (await import("@/lib/app-api")).APP_API_CLIENT;
});

afterAll(() => {
  vi.unstubAllGlobals();
});

type AnySpec = Parameters<typeof resolveCommandName>[0];

/** The names a store command can take, with the arguments that pick each. */
function storeCommandCalls(): {
  key: string;
  args: unknown[];
  name: EventName;
}[] {
  const pickInputs: Record<string, unknown[][]> = {
    changePullRequest: Object.keys(pullRequestCommands).map((type) => [
      "pull-request-1",
      { type },
    ]),
    relocateTimesheetEntries: [
      [[], "copy"],
      [[], "cut"],
    ],
  };
  return Object.entries(storeTable).flatMap(([key, spec]) => {
    const picks = typeof spec === "object" && "pick" in spec;
    // A call it can't read takes the fallback name.
    const inputs = picks ? [...(pickInputs[key] ?? []), []] : [[]];
    if (picks && !pickInputs[key]) {
      throw new Error(
        `The store command ${key} picks its name: list the arguments that pick each of its names in the audit's pickInputs.`,
      );
    }
    return inputs.map((args) => ({
      key,
      args,
      name: resolveCommandName(spec as AnySpec, args) as EventName,
    }));
  });
}

/** Each seam's unit names, with the kind its seam opens them as. */
function seams(): {
  seam: string;
  key: string;
  name: EventName;
  kinds: Kind[];
}[] {
  return [
    ...Object.entries(ROUTES).flatMap(([key, route]) =>
      (typeof route.name === "string"
        ? [route.name as EventName]
        : (Object.values(route.name.names) as EventName[])
      ).map((name) => ({
        seam: "route",
        key,
        name,
        kinds: ["request"] as Kind[],
      })),
    ),
    ...Object.entries({
      ...PLUGIN_OPERATION_EVENTS,
      ...SCHEMA_OPERATION_EVENTS,
    }).map(([key, name]) => ({
      seam: "plugin method",
      key,
      name: name as EventName,
      kinds: ["plugin_operation"] as Kind[],
    })),
    ...Object.entries(IPC_CHANNELS).map(([key, { event }]) => ({
      seam: "IPC channel",
      key,
      name: event,
      kinds: ["ipc"] as Kind[],
    })),
    ...storeCommandCalls().map(({ key, name }) => ({
      seam: "store command",
      key,
      name,
      kinds: ["command"] as Kind[],
    })),
    ...Object.entries(clientTable).map(([key, name]) => ({
      seam: "client call",
      key,
      name: name as EventName,
      kinds: (catalog.events[name as EventName].kinds as readonly Kind[]).some(
        (kind) => kind === "command",
      )
        ? (["command"] as Kind[])
        : (["job"] as Kind[]),
    })),
  ];
}

/** What may emit an event, in the order the doc's catalog lists them. */
const EMITTERS = [
  "route",
  "plugin method",
  "IPC channel",
  "store command",
  "client call",
  "local API",
  "main process",
  "renderer",
] as const;

/** The runtime whose code starts a unit by name. */
const runtimeOf = (file: string) =>
  file.startsWith("apps/api/")
    ? "local API"
    : file.startsWith("apps/desktop/")
      ? "main process"
      : "renderer";

/** Each event of the catalog, as the doc's catalog lists it: name, kinds and emitters. */
function catalogRows(): string[][] {
  const emitters = new Map<string, Set<string>>();
  const add = (name: string, emitter: string) =>
    emitters.set(name, (emitters.get(name) ?? new Set()).add(emitter));
  for (const { seam, name } of seams()) add(name, seam);
  for (const { name, file } of namedUnits()) add(name, runtimeOf(file));
  return (Object.keys(catalog.events) as EventName[])
    .sort()
    .map((name) => [
      `\`${name}\``,
      catalog.events[name].kinds.join(", "),
      EMITTERS.filter((emitter) => emitters.get(name)?.has(emitter)).join(", "),
    ]);
}

/** The rows of the catalog table in docs/logging-strategy.md, as their cells. */
function documentedRows(): string[][] {
  const doc = read("docs/logging-strategy.md").replace(/\r\n/g, "\n");
  const start = doc.indexOf("\n## The catalog\n");
  expect(start, "docs/logging-strategy.md has a catalog").toBeGreaterThan(0);
  const end = doc.indexOf("\n## ", start + 1);
  return doc
    .slice(start, end === -1 ? undefined : end)
    .split(/\r?\n/)
    .filter((line) => line.startsWith("| `"))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim()),
    );
}

describe("every unit of work in code is in the catalog", () => {
  it("names each table's entries with a catalog event its seam's kind allows", () => {
    const wrong = seams().filter(
      ({ name, kinds }) =>
        !Object.hasOwn(catalog.events, name) ||
        !kinds.every((kind) =>
          (catalog.events[name].kinds as readonly Kind[]).includes(kind),
        ),
    );
    expect(wrong).toEqual([]);
  });

  it("names every unit a runtime starts by name in the catalog", () => {
    const units = namedUnits();
    // The scan finds them: the jobs, crashes and lifecycle units of each runtime.
    expect(units.map(({ name }) => name)).toEqual(
      expect.arrayContaining([
        "api.request",
        "agent.run",
        "app.launch",
        "calendar.fetch",
        "route.change",
        "update.check",
      ]),
    );
    expect(
      units.filter(({ name }) => !Object.hasOwn(catalog.events, name)),
    ).toEqual([]);
  });

  it("calls the local API only through a client function the client table names", () => {
    const source = read("apps/web/src/lib/app-api.ts");
    const called = new Set(
      [...source.matchAll(/appApiRequest\(\s*"([A-Za-z]+)"/g)].map(
        ([, key]) => key,
      ),
    );
    // A table entry nothing calls is a unit of work that no longer exists.
    expect(Object.keys(clientTable).filter((key) => !called.has(key))).toEqual(
      [],
    );
    expect(
      [...called].filter((key) => !key || !Object.hasOwn(clientTable, key)),
    ).toEqual([]);
  });
});

/** The names each driver below saw emitted, once per table entry. */
const driven = new Set<EventName>();

describe("each table's entries emit their events", () => {
  it("runs every store command, and each emits the event its table entry names", async () => {
    vi.resetModules();
    installWindow();
    const sink = createRecordingSink<AjourEvent>();
    (await import("@/lib/wide-events")).replaceEventSink(sink);
    const { localStore } = await import("@/lib/local-store");
    const commands = localStore as unknown as Record<
      string,
      (...args: unknown[]) => unknown
    >;
    const missing: string[] = [];
    for (const { key, args, name } of storeCommandCalls()) {
      sink.events.length = 0;
      try {
        // Arguments it can't use still emit its event, ending in an error.
        await commands[key]!(...args);
      } catch {
        // The event is what this checks.
      }
      if (sink.events.some((event) => event.name === name)) driven.add(name);
      else missing.push(`${key} → ${name}`);
    }
    expect(missing).toEqual([]);
  });

  it("calls every route, and each request's event takes its route's name and pattern", async () => {
    const api = await startLocalApi();
    const missing: string[] = [];
    try {
      for (const route of Object.values(ROUTES)) {
        const operations =
          typeof route.name === "string"
            ? [{ path: route.path, name: route.name as EventName }]
            : Object.entries(route.name.names).map(([operation, name]) => ({
                path: route.path.replace(`:${route.name.param}`, operation),
                name: name as EventName,
              }));
        for (const operation of operations) {
          const url = operation.path
            .replace(":pluginId", "jira")
            .replace(/:[A-Za-z]+/g, "audit-1");
          await fetchAsTheApp(`${api.baseUrl}${url}`, {
            method: route.method,
            ...(route.method === "GET"
              ? {}
              : {
                  body: "{}",
                  headers: { "Content-Type": "application/json" },
                }),
            signal: AbortSignal.timeout(10_000),
          }).then((response) => response.text());
          try {
            await waitForEvent(
              api.events,
              (event) =>
                event.name === operation.name &&
                event.http?.route === route.path,
            );
            driven.add(operation.name);
          } catch {
            missing.push(`${route.method} ${route.path} → ${operation.name}`);
          }
        }
      }
      // MCP's own route, outside the table.
      await fetch(`${api.baseUrl}/mcp/ajour`, { method: "POST", body: "{}" });
      await waitForEvent(api.events, (event) => event.name === "mcp.request");
      driven.add("mcp.request");
    } finally {
      await api.stop();
    }
    expect(missing).toEqual([]);
  });

  it("registers every IPC channel through the wrapper, and each call emits its channel's event", async () => {
    const sink = createRecordingSink<AjourEvent>();
    const events = createEmitter({
      catalog,
      context: {
        runtime: "main",
        launch_id: "launch-1",
        app: { version: "1.0.0", channel: "dev", packaged: false },
        device: { platform: "win32" },
      },
      sink,
    });
    const listeners = new Map<string, (...args: unknown[]) => unknown>();
    const ipcMain = {
      handle: (channel: string, listener: (...args: unknown[]) => unknown) =>
        listeners.set(channel, listener),
      on: (channel: string, listener: (...args: unknown[]) => unknown) =>
        listeners.set(channel, listener),
    };
    const ipc = createIpcListeners(ipcMain, { events });
    const register = {
      invoke: ipc.handle,
      message: ipc.onMessage,
      sync: ipc.answerSync,
    };
    const missing: string[] = [];
    for (const [channel, { event, mode }] of Object.entries(IPC_CHANNELS)) {
      register[mode](channel, () => null);
      sink.events.length = 0;
      await listeners.get(channel)!({ sender: "window" });
      if (
        sink.events.some(
          (recorded) =>
            recorded.name === event && recorded.ipc?.channel === channel,
        )
      ) {
        driven.add(event);
      } else {
        missing.push(`${channel} → ${event}`);
      }
    }
    expect(missing).toEqual([]);
  });
});

describe("every catalog entry is emitted by code and asserted by a test", () => {
  it("emits every catalog entry from a table or a unit a runtime starts by name", () => {
    const emitted = new Set<string>([
      ...seams().map(({ name }) => name),
      ...namedUnits().map(({ name }) => name),
    ]);
    expect(
      Object.keys(catalog.events).filter((name) => !emitted.has(name)),
    ).toEqual([]);
  });

  it("asserts every catalog entry in a test that names it, or in a driver above", () => {
    const tests = [...filesUnder("apps"), ...filesUnder("packages")].filter(
      (file) =>
        isTest(file) &&
        /\.[cm]?[jt]sx?$/.test(file) &&
        file !== AUDIT &&
        !file.endsWith("packages/wide-events/tests/catalog.test.ts"),
    );
    const texts = tests.map(read);
    const named = (name: string) => {
      const pattern = new RegExp(
        `(?<![\\w.])${name.replace(".", "\\.")}(?![\\w.])`,
      );
      return texts.some((text) => pattern.test(text));
    };
    expect(driven.size).toBeGreaterThan(0);
    expect(
      Object.keys(catalog.events).filter(
        (name) => !named(name) && !driven.has(name as EventName),
      ),
    ).toEqual([]);
  });

  it("lists every catalog entry in the logging strategy, with its kinds and what emits it", () => {
    expect(documentedRows()).toEqual(catalogRows());
  });

  it("covers the route table, whose names the client calls", () => {
    expect(new Set(routeNames)).toEqual(
      new Set(routeNames.filter((name) => driven.has(name))),
    );
  });
});
