import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";
import type {
  AgentRunningTimer,
  AgentTimeEntry,
  BridgeToolCall,
  BridgeToolResult,
} from "../../../packages/shared/agent-tools.ts";
import {
  enableMcpWithClient,
  openFakeWindow,
  startTestApi,
  type TestApi,
} from "../../api/src/test-support/mcp-harness.ts";
import type { CliIo } from "./io.ts";
import { run } from "./main.ts";

// Wednesday 4 November 2026, 14:44:07 local time.
const NOW = new Date(2026, 10, 4, 14, 44, 7).getTime();
const TODAY = "2026-11-04";
const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface FakeTerminal {
  io: CliIo;
  out(): string;
  err(): string;
  home: string;
}

async function terminal(
  options: { tty?: boolean; env?: Record<string, string>; stdin?: string } = {},
): Promise<FakeTerminal> {
  const home = await mkdtemp(path.join(os.tmpdir(), "ajour-cli-home-"));
  cleanups.push(() => rm(home, { recursive: true, force: true }));
  let out = "";
  let err = "";
  const tty = options.tty ?? false;
  return {
    home,
    out: () => out,
    err: () => err,
    io: {
      stdout: { write: (text) => void (out += text), isTTY: tty, columns: 100 },
      stderr: { write: (text) => void (err += text), isTTY: tty },
      env: {
        XDG_CONFIG_HOME: path.join(home, "config"),
        XDG_STATE_HOME: path.join(home, "state"),
        ...options.env,
      },
      platform: process.platform,
      homedir: home,
      now: () => NOW,
      readSecret: async () => options.stdin ?? "",
      readStdin: async () => options.stdin ?? "",
      wait: async () => false,
    },
  };
}

async function api(): Promise<TestApi> {
  const started = await startTestApi();
  cleanups.push(() => started.stop());
  return started;
}

const running: AgentRunningTimer = {
  timerId: "timer-1",
  date: TODAY,
  countedMinutes: 84,
  countedSeconds: 84 * 60 + 7,
  runningSince: new Date(2026, 10, 4, 13, 20, 0).toISOString(),
  note: "Fix export rounding",
  projectId: "p-ajr",
  projectName: "Ajour Desktop",
  projectCode: "AJR",
  taskId: "t-export",
  taskName: "07 Export",
};

const todayEntries: AgentTimeEntry[] = [
  {
    entryId: "e1",
    date: TODAY,
    state: "saved",
    minutes: 120,
    taskName: "04 Review",
  },
  {
    entryId: "e2",
    date: TODAY,
    state: "committed",
    minutes: 45,
    taskName: "03 Meetings",
  },
  {
    entryId: "e3",
    date: TODAY,
    state: "committed",
    minutes: 150,
    taskName: "05 Backend",
  },
];

/** A fake Ajour window that answers the read tools from fixtures. */
function window(state: WindowState) {
  return (call: BridgeToolCall): BridgeToolResult => {
    const output =
      call.tool === "get_running_timer"
        ? { running: state.running }
        : call.tool === "list_time_entries"
          ? { entries: state.entries, running: state.running }
          : undefined;
    return output
      ? { requestId: call.requestId, ok: true, output }
      : {
          requestId: call.requestId,
          ok: false,
          error: `No fixture for ${call.tool}.`,
        };
  };
}

/** An API with MCP on, a client, and a fake window. Returns the token. */
interface WindowState {
  running: AgentRunningTimer | null;
  entries: AgentTimeEntry[];
}

async function connectedApi(
  state: WindowState = { running, entries: todayEntries },
) {
  const started = await api();
  const { token } = await enableMcpWithClient(started);
  const fake = await openFakeWindow(started, window(state));
  cleanups.push(() => fake.close());
  return { api: started, token, fake };
}

describe("ajour connect", () => {
  it("checks the token, saves it for the user alone, and never prints it", async () => {
    const { api, token } = await connectedApi();
    const term = await terminal({
      stdin: `${token}\n`,
      env: { AJOUR_URL: api.baseUrl },
    });

    const code = await run(["connect", "--token-stdin"], term.io);

    expect(code).toBe(0);
    expect(term.err()).toContain(`Connected to Ajour on ${api.baseUrl}.`);
    expect(term.out() + term.err()).not.toContain(token);
    const file = path.join(term.home, "config", "ajour", "token");
    expect((await readFile(file, "utf8")).trim()).toBe(token);
    if (process.platform !== "win32") {
      expect((await stat(file)).mode & 0o777).toBe(0o600);
    }
  });

  it("saves nothing when Ajour refuses the token", async () => {
    const { api } = await connectedApi();
    const term = await terminal({
      stdin: "ajour_wrong",
      env: { AJOUR_URL: api.baseUrl },
    });

    const code = await run(["connect", "--token-stdin"], term.io);

    expect(code).toBe(3);
    expect(term.err()).toContain("Ajour doesn't accept this token.");
    await expect(
      stat(path.join(term.home, "config", "ajour", "token")),
    ).rejects.toThrow();
  });
});

describe("ajour status", () => {
  async function connectedTerminal(
    state?: Parameters<typeof connectedApi>[0],
    options: { tty?: boolean } = {},
  ) {
    const { api, token } = await connectedApi(state);
    return terminal({
      ...options,
      env: { AJOUR_URL: api.baseUrl, AJOUR_TOKEN: token },
    });
  }

  it("shows the running entry with seconds, since when, and today's total", async () => {
    const term = await connectedTerminal();

    expect(await run(["status"], term.io)).toBe(0);

    // 2:00 + 0:45 + 2:30 saved, plus 1:24 running.
    expect(term.out()).toBe(
      "● 1:24:07  Fix export rounding\n" +
        "  AJR · 07 Export · since 13:20 · today 6:39\n",
    );
  });

  it("colors it on a terminal", async () => {
    const term = await connectedTerminal(undefined, { tty: true });

    await run(["status"], term.io);

    expect(term.out()).toContain("\x1b[32m●\x1b[0m");
    expect(term.out()).toContain("\x1b[1m1:24:07\x1b[0m");
  });

  it("says nothing runs, with today's total", async () => {
    const term = await connectedTerminal({
      running: null,
      entries: todayEntries,
    });

    expect(await run(["status"], term.io)).toBe(0);

    expect(term.out()).toBe("○ Nothing running · today 5:15\n");
  });

  it("counts a continued entry once", async () => {
    const term = await connectedTerminal({
      running: { ...running, countedMinutes: 150, countedSeconds: 9000 },
      entries: [
        {
          entryId: "e1",
          date: TODAY,
          state: "running",
          minutes: 120,
          taskName: "07 Export",
        },
        {
          entryId: "e2",
          date: TODAY,
          state: "saved",
          minutes: 30,
          taskName: "04 Review",
        },
      ],
    });

    await run(["status"], term.io);

    expect(term.out()).toContain("today 3:00");
  });

  it("prints one line for a status bar, or the idle text", async () => {
    const busy = await connectedTerminal(undefined, { tty: true });
    expect(await run(["status", "-s"], busy.io)).toBe(0);
    expect(busy.out()).toBe("● 1:24 Fix export rounding\n");

    const idle = await connectedTerminal({ running: null, entries: [] });
    expect(await run(["status", "-s"], idle.io)).toBe(0);
    expect(idle.out()).toBe("");

    const idleText = await connectedTerminal({ running: null, entries: [] });
    expect(await run(["status", "-s", "--idle", "idle"], idleText.io)).toBe(0);
    expect(idleText.out()).toBe("idle\n");
  });

  it("redraws each second with --watch, ticking between asks", async () => {
    const term = await connectedTerminal(undefined, { tty: true });
    let clock = NOW;
    let waits = 0;
    const io: CliIo = {
      ...term.io,
      now: () => clock,
      async wait(ms) {
        clock += ms;
        waits += 1;
        return waits < 2;
      },
    };

    expect(await run(["status", "--watch", "--color", "never"], io)).toBe(0);

    expect(term.out()).toBe(
      "● 1:24:07  Fix export rounding\n" +
        "  AJR · 07 Export · since 13:20 · today 6:39\n" +
        "\x1b[2F\x1b[J" +
        "● 1:24:08  Fix export rounding\n" +
        "  AJR · 07 Export · since 13:20 · today 6:39\n",
    );
  });

  it("prints the tool output with --json", async () => {
    const term = await connectedTerminal();

    await run(["status", "--json"], term.io);

    expect(JSON.parse(term.out())).toEqual({ running });
  });
});

describe("when Ajour is out of reach", () => {
  it("says Ajour isn't running when nothing listens", async () => {
    const started = await startTestApi();
    const url = started.baseUrl;
    await started.stop();
    const term = await terminal({
      env: { AJOUR_URL: url, AJOUR_TOKEN: "ajour_x" },
    });

    expect(await run(["status"], term.io)).toBe(3);
    expect(term.err()).toBe(
      "error: Ajour isn't running. Start Ajour, then try again.\n",
    );
  });

  it("says MCP is off", async () => {
    const started = await api();
    const term = await terminal({
      env: { AJOUR_URL: started.baseUrl, AJOUR_TOKEN: "ajour_x" },
    });

    expect(await run(["status"], term.io)).toBe(3);
    expect(term.err()).toBe(
      "error: MCP is off. Turn it on in Ajour under Settings › MCP.\n",
    );
  });

  it("says the token no longer works once it is revoked", async () => {
    const { api, token } = await connectedApi();
    const clients = await api.windowRequest("/api/mcp/settings");
    await api.windowRequest(
      `/api/mcp/clients/${clients.body.clients[0].id}/revoke`,
      {},
    );
    const term = await terminal({
      env: { AJOUR_URL: api.baseUrl, AJOUR_TOKEN: token },
    });

    expect(await run(["status"], term.io)).toBe(3);
    expect(term.err()).toBe(
      "error: Ajour doesn't accept this token. It may have been revoked. Run: ajour connect\n",
    );
  });

  it("says to connect when no token is saved", async () => {
    const started = await api();
    const term = await terminal({ env: { AJOUR_URL: started.baseUrl } });

    expect(await run(["status"], term.io)).toBe(3);
    expect(term.err()).toBe(
      "error: Not connected to Ajour. Run: ajour connect\n",
    );
  });

  it("says to open Ajour when no window holds the bridge", async () => {
    const started = await api();
    const { token } = await enableMcpWithClient(started);
    const term = await terminal({
      env: { AJOUR_URL: started.baseUrl, AJOUR_TOKEN: token },
    });

    expect(await run(["status"], term.io)).toBe(3);
    expect(term.err()).toBe("error: Open the Ajour window to use this tool.\n");
  });

  it("keeps a status bar quiet", async () => {
    const started = await api();
    const term = await terminal({
      env: { AJOUR_URL: started.baseUrl, AJOUR_TOKEN: "ajour_x" },
    });

    expect(await run(["status", "-s"], term.io)).toBe(0);
    expect(term.out() + term.err()).toBe("");
  });
});

describe("usage", () => {
  it("refuses an unknown command with exit 2", async () => {
    const term = await terminal();

    expect(await run(["strat"], term.io)).toBe(2);
    expect(term.err()).toBe(
      'usage: Unknown command "strat". Run: ajour --help\n',
    );
  });

  it("refuses an unknown option with exit 2", async () => {
    const term = await terminal();

    expect(await run(["status", "--bogus"], term.io)).toBe(2);
    expect(term.err()).toMatch(/^usage: Unknown option '--bogus'/);
  });
});

describe("the ajour process", () => {
  const main = fileURLToPath(new URL("./main.ts", import.meta.url));
  const execFileAsync = promisify(execFile);

  it("prints its version and exits 0", async () => {
    const { stdout } = await execFileAsync(process.execPath, [
      "--experimental-strip-types",
      "--no-warnings",
      main,
      "--version",
    ]);
    expect(stdout).toMatch(/^ajour \d+\.\d+\.\d+\n$/);
  });

  it("exits 3 with its sentence on stderr when it isn't connected", async () => {
    const home = await mkdtemp(path.join(os.tmpdir(), "ajour-cli-proc-"));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    const result = await execFileAsync(
      process.execPath,
      ["--experimental-strip-types", "--no-warnings", main, "status"],
      {
        env: {
          ...process.env,
          AJOUR_TOKEN: "",
          XDG_CONFIG_HOME: home,
          XDG_STATE_HOME: home,
          AJOUR_URL: "http://127.0.0.1:9",
        },
      },
    ).catch((error: { code: number; stdout: string; stderr: string }) => error);
    expect(result).toMatchObject({
      code: 3,
      stdout: "",
      stderr: "error: Not connected to Ajour. Run: ajour connect\n",
    });
  });
});
