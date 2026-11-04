import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
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
  options: {
    tty?: boolean;
    columns?: number;
    env?: Record<string, string>;
    stdin?: string;
  } = {},
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
      stdout: {
        write: (text) => void (out += text),
        isTTY: tty,
        columns: options.columns ?? 100,
      },
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
      releaseInput: () => undefined,
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
          ? {
              entries: state.entries,
              ...(state.targets ? { targets: state.targets } : {}),
              running:
                state.listedRunning === undefined
                  ? state.running
                  : state.listedRunning,
            }
          : call.tool === "get_last_saved_entry"
            ? { entry: state.lastSaved ?? null }
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
  /** What list_time_entries says runs, when it differs from get_running_timer. */
  listedRunning?: AgentRunningTimer | null;
  /** What get_last_saved_entry answers. */
  lastSaved?: AgentTimeEntry | null;
  /** Each day's target, as list_time_entries returns it. */
  targets?: { date: string; hours: number }[];
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

  it("shows today's total of its target", async () => {
    const targets = [
      { date: "2026-11-03", hours: 8 },
      { date: TODAY, hours: 7.5 },
    ];
    const busy = await connectedTerminal({
      running,
      entries: todayEntries,
      targets,
    });
    expect(await run(["status"], busy.io)).toBe(0);
    expect(busy.out()).toContain(" · today 6:39 of 7:30\n");

    const idle = await connectedTerminal({
      running: null,
      entries: todayEntries,
      targets,
    });
    expect(await run(["status"], idle.io)).toBe(0);
    expect(idle.out()).toBe("○ Nothing running · today 5:15 of 7:30\n");
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

describe("tokens", () => {
  it("never prints a malformed token, from the environment or the file", async () => {
    const started = await api();
    const term = await terminal({
      env: {
        AJOUR_URL: started.baseUrl,
        AJOUR_TOKEN: "ajour_abc\nSECRET-TAIL",
      },
    });

    expect(await run(["status"], term.io)).toBe(3);
    expect(term.err()).toBe(
      "error: AJOUR_TOKEN isn't a token Ajour created. Run: ajour connect\n",
    );
    expect(term.out() + term.err()).not.toContain("SECRET-TAIL");

    const fromFile = await terminal({ env: { AJOUR_URL: started.baseUrl } });
    await mkdir(path.join(fromFile.home, "config", "ajour"), {
      recursive: true,
    });
    await writeFile(
      path.join(fromFile.home, "config", "ajour", "token"),
      "ajour_abc SECRET-TAIL\n",
    );
    expect(await run(["status"], fromFile.io)).toBe(3);
    expect(fromFile.err()).toBe(
      "error: The saved token isn't a token Ajour created. Run: ajour connect\n",
    );
  });

  it("refuses to save a malformed token without echoing it", async () => {
    const { api } = await connectedApi();
    const term = await terminal({
      stdin: "ajour_abc\u0007SECRET",
      env: { AJOUR_URL: api.baseUrl },
    });

    expect(await run(["connect", "--token-stdin"], term.io)).toBe(2);
    expect(term.err()).toBe("usage: That isn't a token Ajour created.\n");
  });

  it.skipIf(process.platform === "win32")(
    "replaces an existing token file without ever widening its rights",
    async () => {
      const { api, token } = await connectedApi();
      const term = await terminal({
        stdin: token,
        env: { AJOUR_URL: api.baseUrl },
      });
      const dir = path.join(term.home, "config", "ajour");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "token"), "ajour_old\n", { mode: 0o644 });

      expect(await run(["connect", "--token-stdin"], term.io)).toBe(0);

      expect((await stat(path.join(dir, "token"))).mode & 0o777).toBe(0o600);
      expect((await readFile(path.join(dir, "token"), "utf8")).trim()).toBe(
        token,
      );
      expect(await readdir(dir)).toEqual(["token"]);
    },
  );

  it("saves a working token with no window, and says to open Ajour", async () => {
    const started = await api();
    const { token } = await enableMcpWithClient(started);
    const term = await terminal({
      stdin: token,
      env: { AJOUR_URL: started.baseUrl },
    });

    expect(await run(["connect", "--token-stdin"], term.io)).toBe(0);
    expect(term.err()).toContain(
      "Ajour's window isn't open, so commands can't read your entries yet. Open Ajour to use them.",
    );
    const saved = path.join(term.home, "config", "ajour", "token");
    expect((await readFile(saved, "utf8")).trim()).toBe(token);
  });
});

describe("arguments", () => {
  it("gives exit 2 for a global option missing its value", async () => {
    const term = await terminal();

    expect(await run(["--color"], term.io)).toBe(2);
    expect(term.err()).toMatch(/^usage: Option '--color <value>'/);
  });

  it("refuses arguments a command doesn't take", async () => {
    const term = await terminal();

    expect(await run(["status", "nonsense"], term.io)).toBe(2);
    expect(await run(["status", "--", "--bogus"], term.io)).toBe(2);
    expect(term.err()).toBe(
      'usage: status takes no arguments, not "nonsense"\n' +
        'usage: status takes no arguments, not "--bogus"\n',
    );
  });
});

describe("ajour status, more cases", () => {
  async function terminalFor(state: WindowState, options = {}) {
    const { api, token } = await connectedApi(state);
    return terminal({
      ...options,
      env: { AJOUR_URL: api.baseUrl, AJOUR_TOKEN: token, NO_COLOR: "1" },
    });
  }

  it("counts today from one read, even when the entry stops between reads", async () => {
    const term = await terminalFor({
      running: { ...running, countedMinutes: 150, countedSeconds: 9000 },
      listedRunning: null,
      entries: [
        {
          entryId: "e1",
          date: TODAY,
          state: "saved",
          minutes: 150,
          taskName: "07 Export",
        },
      ],
    });

    await run(["status"], term.io);

    expect(term.out()).toBe("○ Nothing running · today 2:30\n");
  });

  it("shows an entry still running from yesterday, without adding it to today", async () => {
    const term = await terminalFor({
      running: { ...running, date: "2026-11-03" },
      listedRunning: null,
      entries: todayEntries,
    });

    await run(["status"], term.io);

    expect(term.out()).toContain("started 2026-11-03 · today 5:15");
  });

  it("names the last saved entry when nothing runs", async () => {
    const reviewed = {
      ...todayEntries[0]!,
      savedAt: new Date(NOW - 45 * 60_000).toISOString(),
    };
    const term = await terminalFor({
      running: null,
      entries: [
        reviewed,
        {
          ...todayEntries[1]!,
          savedAt: new Date(NOW - 3 * 3_600_000).toISOString(),
        },
      ],
      lastSaved: reviewed,
    });

    await run(["status"], term.io);

    expect(term.out()).toBe(
      "○ Nothing running · today 2:45 · last: 04 Review, 45m ago\n",
    );
  });

  it("fits each line to the terminal and keeps a note on one line", async () => {
    const term = await terminalFor(
      {
        running: {
          ...running,
          note: "Fix export rounding\nfor the Workday file",
        },
        entries: todayEntries,
      },
      { tty: true, columns: 30 },
    );

    await run(["status"], term.io);

    expect(term.out()).toBe(
      "● 1:24:07  Fix export roundi…\n" + "  AJR · 07 Export · since 13…\n",
    );
  });

  it("streams one line per second with --short --watch", async () => {
    const term = await terminalFor({ running, entries: todayEntries });
    let clock = NOW;
    let waits = 0;
    const io: CliIo = {
      ...term.io,
      now: () => clock,
      async wait(ms) {
        clock += ms;
        waits += 1;
        return waits < 3;
      },
    };

    expect(await run(["status", "-s", "--watch"], io)).toBe(0);

    expect(term.out()).toBe(
      "● 1:24 Fix export rounding\n" +
        "● 1:24 Fix export rounding\n" +
        "● 1:24 Fix export rounding\n",
    );
  });

  it("lets go of the terminal when watching fails", async () => {
    const started = await api();
    const { token } = await enableMcpWithClient(started);
    const fake = await openFakeWindow(
      started,
      window({ running, entries: todayEntries }),
    );
    const term = await terminal({
      tty: true,
      env: { AJOUR_URL: started.baseUrl, AJOUR_TOKEN: token },
    });
    let clock = NOW;
    let released = 0;
    const io: CliIo = {
      ...term.io,
      now: () => clock,
      async wait(ms) {
        clock += ms * 10;
        await fake.close();
        return true;
      },
      releaseInput: () => void (released += 1),
    };

    expect(await run(["status", "--watch"], io)).toBe(3);
    expect(released).toBe(1);
  });
});

describe("ajour as a process", () => {
  const main = fileURLToPath(new URL("./main.ts", import.meta.url));

  function ajour(args: string[], env: Record<string, string>, stdin = "") {
    return new Promise<{ code: number; stdout: string; stderr: string }>(
      (resolve) => {
        const child = execFile(
          process.execPath,
          ["--experimental-strip-types", "--no-warnings", main, ...args],
          { env: { ...process.env, AJOUR_TOKEN: "", ...env } },
          (error, stdout, stderr) =>
            resolve({
              code: error ? Number((error as { code?: number }).code ?? 1) : 0,
              stdout,
              stderr,
            }),
        );
        child.stdin?.end(stdin);
      },
    );
  }

  it("connects, then reads status with the saved token alone", async () => {
    const { api, token } = await connectedApi();
    const home = await mkdtemp(path.join(os.tmpdir(), "ajour-cli-flow-"));
    cleanups.push(() => rm(home, { recursive: true, force: true }));
    const env = {
      AJOUR_URL: api.baseUrl,
      XDG_CONFIG_HOME: path.join(home, "config"),
      XDG_STATE_HOME: path.join(home, "state"),
      NO_COLOR: "1",
    };

    const connected = await ajour(["connect", "--token-stdin"], env, token);
    expect(connected.code).toBe(0);

    const shown = await ajour(["status"], env);
    expect(shown).toMatchObject({ code: 0, stderr: "" });
    expect(shown.stdout).toContain("Fix export rounding");
  });
});

describe("review round 2", () => {
  it("starts streaming the entry once Ajour starts, with --short --watch", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "ajour-cli-restart-"));
    cleanups.push(() => rm(dir, { recursive: true, force: true }));
    const statePath = path.join(dir, "state.json");
    const first = await startTestApi({ statePath });
    const { token } = await enableMcpWithClient(first);
    const url = first.baseUrl;
    await first.stop();

    const term = await terminal({
      env: { AJOUR_URL: url, AJOUR_TOKEN: token },
    });
    let clock = NOW;
    let waits = 0;
    const io: CliIo = {
      ...term.io,
      now: () => clock,
      async wait(ms) {
        clock += ms * 10;
        waits += 1;
        if (waits === 1) {
          const second = await startTestApi({
            port: Number(new URL(url).port),
            statePath,
          });
          cleanups.push(() => second.stop());
          const fake = await openFakeWindow(
            second,
            window({ running, entries: todayEntries }),
          );
          cleanups.push(() => fake.close());
        }
        return waits < 2;
      },
    };

    expect(await run(["status", "-s", "--watch"], io)).toBe(0);

    expect(term.out()).toBe("\n" + "● 1:24 Fix export rounding\n");
  });

  it("names the last entry saved on any earlier day, and counts only today", async () => {
    const { api, token, fake } = await connectedApi({
      running: null,
      entries: [],
      lastSaved: {
        entryId: "e9",
        date: "2026-10-09",
        state: "saved",
        minutes: 90,
        taskName: "05 Backend",
        savedAt: new Date(NOW - 26 * 24 * 3_600_000).toISOString(),
      },
    });
    const term = await terminal({
      env: { AJOUR_URL: api.baseUrl, AJOUR_TOKEN: token },
    });

    await run(["status"], term.io);

    expect(term.out()).toBe(
      "○ Nothing running · today 0:00 · last: 05 Backend, 26d ago\n",
    );
    expect(
      fake.calls.find((call) => call.tool === "list_time_entries")?.input,
    ).toEqual({ from: TODAY, to: TODAY });
  });
});
