import { describe, expect, it } from "vitest";
import {
  declaredCommandSchema,
  pluginApi4ManifestSchema,
} from "../plugin-api-4";
import {
  commandArgvShape,
  summarizePluginAccess,
  NO_PLUGIN_ACCESS,
  pluginAccessDifference,
  widensAccess,
} from "../plugin-access";
import {
  pluginAccessSummarySchema,
  pluginAccessDifferenceSchema,
} from "../plugin-access-schemas";
import { jiraManifest } from "./fixtures/api-4-manifests";

const processes = {
  executables: { t3: { names: ["t3"] } },
  commands: [
    {
      id: "thread-start",
      executable: "t3",
      args: [
        "thread",
        "start",
        "{folder:folder}",
        "-",
        "--title",
        "{title:text}",
        "--json",
        {
          if: "branch",
          args: ["--worktree", "{base:ref}", "--branch", "{branch:ref}"],
        },
      ],
      stdin: "text",
      mode: "capture",
      timeoutSeconds: 60,
    },
  ],
  openSchemes: ["codex"],
};
describe("manifest process declarations", () => {
  it("parses the T3 argv into typed slots and conditional groups for the broker", () => {
    const parsed = pluginApi4ManifestSchema.parse({
      ...jiraManifest(),
      processes,
    });
    expect(parsed.processes?.commands[0]?.args).toEqual([
      { kind: "literal", value: "thread" },
      { kind: "literal", value: "start" },
      { kind: "folder", name: "folder" },
      { kind: "literal", value: "-" },
      { kind: "literal", value: "--title" },
      { kind: "text", name: "title" },
      { kind: "literal", value: "--json" },
      {
        if: "branch",
        args: [
          { kind: "literal", value: "--worktree" },
          { kind: "ref", name: "base" },
          { kind: "literal", value: "--branch" },
          { kind: "ref", name: "branch" },
        ],
      },
    ]);
  });
});

describe("process declaration validation", () => {
  const parse = (value: unknown) =>
    pluginApi4ManifestSchema.safeParse({ ...jiraManifest(), processes: value });
  it.each(["text", "id", "ref", "number", "https-url", "folder"])(
    "accepts a %s slot",
    (kind) => {
      expect(
        parse({
          ...processes,
          commands: [{ ...processes.commands[0], args: [`{value:${kind}}`] }],
        }).success,
      ).toBe(true);
    },
  );
  it("accepts enums and explicit literals, including literal braces", () => {
    expect(
      parse({
        ...processes,
        commands: [
          {
            ...processes.commands[0],
            args: [
              { kind: "enum", name: "format", values: ["json", "text"] },
              { kind: "literal", value: "{literal}" },
            ],
          },
        ],
      }).success,
    ).toBe(true);
  });
  it.each([
    "http",
    "https",
    "file",
    "javascript",
    "data",
    "vbscript",
    "about",
    "blob",
    "ajour",
    "ajour-plugin",
    "app",
    "Codex",
    "1codex",
    "codex:",
    "co dex",
    "codex\n",
  ])("refuses the scheme %j", (scheme) => {
    expect(parse({ openSchemes: [scheme] }).success).toBe(false);
  });
  it("accepts lowercase RFC 3986 schemes", () =>
    expect(parse({ openSchemes: ["my-app.v2+local"] }).success).toBe(true));
  it("accepts a 64-character scheme through manifest, Access and consent schemas", () => {
    const manifest = pluginApi4ManifestSchema.parse({
      ...jiraManifest(),
      processes: { openSchemes: ["a".repeat(64)] },
    });
    const summary = summarizePluginAccess(manifest, { agentPrompts: {} });
    expect(summary.openSchemes).toEqual(["a".repeat(64)]);
    expect(pluginAccessSummarySchema.safeParse(summary).success).toBe(true);
    expect(
      pluginAccessDifferenceSchema.safeParse(
        pluginAccessDifference(undefined, summary),
      ).success,
    ).toBe(true);
  });
  it.each([65, 1001])(
    "refuses a %i-character scheme at admission and in Access",
    (length) => {
      const openSchemes = ["a".repeat(length)];
      expect(parse({ openSchemes }).success).toBe(false);
      const summary = { ...NO_PLUGIN_ACCESS, openSchemes };
      expect(pluginAccessSummarySchema.safeParse(summary).success).toBe(false);
      expect(
        pluginAccessDifferenceSchema.safeParse(
          pluginAccessDifference(undefined, summary),
        ).success,
      ).toBe(false);
    },
  );
  it.each([
    "/bin/t3",
    "C:\\tools\\t3.exe",
    "../t3",
    "t3/start",
    "t3 --help",
    "-t3",
    ".",
    "..",
  ])("refuses executable %j", (name) => {
    expect(
      parse({ ...processes, executables: { t3: { names: [name] } } }).success,
    ).toBe(false);
  });
  it.each([
    { args: ["{value:unknown}"] },
    { args: ["prefix-{value:text}"] },
    { args: [{ kind: "enum", name: "value", values: [] }] },
    { args: [{ kind: "enum", name: "value", values: ["--option"] }] },
    { args: [{ if: "missing", args: ["literal"] }] },
    { args: ["{value:text}", "{value:id}"] },
    { executable: "missing" },
    { timeoutSeconds: 601 },
    { timeoutSeconds: 0 },
    { timeoutSeconds: 1.5 },
    { mode: "shell" },
    { stdin: "binary" },
    { surprise: true },
  ])("refuses invalid command %j", (change) => {
    expect(
      parse({
        ...processes,
        commands: [{ ...processes.commands[0], ...change }],
      }).success,
    ).toBe(false);
  });
  it("refuses duplicate command ids", () => {
    expect(
      parse({
        ...processes,
        commands: [processes.commands[0], processes.commands[0]],
      }).success,
    ).toBe(false);
  });
  it("accepts the ten-minute bound and every execution mode", () => {
    for (const mode of ["capture", "detached", "terminal"])
      expect(
        parse({
          ...processes,
          commands: [
            {
              ...processes.commands[0],
              mode,
              stdin: mode === "capture" ? "text" : undefined,
              timeoutSeconds: mode === "capture" ? 600 : undefined,
            },
          ],
        }).success,
      ).toBe(true);
  });
});

it("shows PATH names instead of executable keys, enums and named group slots", () => {
  const command = declaredCommandSchema.parse({
    id: "run",
    executable: "alias",
    mode: "capture",
    args: [
      "start",
      { kind: "enum", name: "format", values: ["json", "text"] },
      { if: "branch", args: ["--branch", "{branch:ref}"] },
    ],
  });
  expect(commandArgvShape(command, ["t3", "t3.cmd"])).toBe(
    "t3|t3.cmd start <json|text> [--branch <branch:ref> if branch]",
  );
  expect(commandArgvShape(command, ["actual"])).toMatch(/^actual start/);
});
it("quotes ambiguous literals and enum choices in review shapes", () => {
  expect(
    commandArgvShape(
      {
        id: "run",
        executable: "alias",
        mode: "capture",
        args: [
          { kind: "literal", value: "a b" },
          { kind: "enum", name: "value", values: ["x> --delete <y", "a|b"] },
        ],
      },
      ["git"],
    ),
  ).toBe('git "a b" <"x> --delete <y"|"a|b">');
});

describe("review declaration boundaries", () => {
  const parse = (value: unknown) =>
    pluginApi4ManifestSchema.safeParse({ ...jiraManifest(), processes: value });
  const command = (change: object) => ({
    ...processes,
    commands: [{ ...processes.commands[0], ...change }],
  });
  it.each([
    "x> --delete <y",
    "a|b",
    "a b",
    "a\tb",
    "<x>",
    'a"b',
    "a'b",
    "-x",
    "x\ud800",
  ])("refuses unsafe enum %j", (value) => {
    expect(
      parse(
        command({ args: [{ kind: "enum", name: "value", values: [value] }] }),
      ).success,
    ).toBe(false);
  });
  it("refuses duplicate enum values", () =>
    expect(
      parse(
        command({ args: [{ kind: "enum", name: "v", values: ["a", "a"] }] }),
      ).success,
    ).toBe(false));
  it.each(["\ud800", "\udfff"])(
    "refuses lone surrogate literal %j",
    (value) => {
      expect(parse(command({ args: [value] })).success).toBe(false);
      expect(
        parse(command({ args: [{ kind: "literal", value }] })).success,
      ).toBe(false);
    },
  );
  it("accepts paired surrogates in literals", () =>
    expect(parse(command({ args: ["😀"] })).success).toBe(true));
  it.each([
    "cmd",
    "command",
    "powershell",
    "pwsh",
    "sh",
    "bash",
    "zsh",
    "fish",
    "dash",
    "ksh",
    "csh",
    "tcsh",
    "wsl",
    "wscript",
    "cscript",
    "mshta",
    "rundll32",
    "regsvr32",
    "conhost",
    "start",
    "explorer",
  ])("refuses shell or host %s with every executable suffix", (name) => {
    for (const suffix of [
      "",
      ".exe",
      ".cmd",
      ".bat",
      ".com",
      ".ps1",
      ".vbs",
      ".js",
      ".wsf",
      ".msc",
      ".cpl",
      ".scr",
      ".pif",
      ".hta",
    ]) {
      expect(
        parse({
          ...processes,
          executables: { t3: { names: [(name + suffix).toUpperCase()] } },
        }).success,
      ).toBe(false);
    }
  });
  it.each([
    "cmd.exe.",
    "cmd.exe..",
    "cmd.",
    "tool.",
    "tool ",
    "cmd.exe ",
    "tool:stream",
    "CMD~1",
    "tool~2.exe",
    "tool$",
    "tool@",
    "tool\u00e9",
    "tool\n",
    "tool\t",
    "tool name",
  ])("refuses ambiguous or nonconservative executable name %j", (name) => {
    expect(parse({ executables: { tool: { names: [name] } } }).success).toBe(
      false,
    );
  });
  it.each([
    ".ps1",
    ".vbs",
    ".js",
    ".wsf",
    ".hta",
    ".msc",
    ".cpl",
    ".scr",
    ".pif",
  ])(
    "refuses arbitrary script-host executable suffix %s case-insensitively",
    (suffix) => {
      for (const name of ["tool" + suffix, "TOOL" + suffix.toUpperCase()]) {
        expect(
          parse({ executables: { tool: { names: [name] } } }).success,
        ).toBe(false);
      }
    },
  );
  it.each([
    "t3",
    "t3.cmd",
    "tool.bat",
    "tool.com",
    "tool.exe",
    "tool_v2-1+local",
  ])("accepts conservative executable name %s", (name) =>
    expect(parse({ executables: { tool: { names: [name] } } }).success).toBe(
      true,
    ),
  );
  it.each([
    "ms-settings",
    "ms-custom",
    "search",
    "search-ms",
    "shell",
    "view-source",
    "devtools",
    "filesystem",
    "chrome",
    "chrome-extension",
    "edge",
    "res",
    "its",
    "mk",
    "ftp",
    "smb",
    "nfs",
    "jar",
    "ldap",
    "telnet",
    "ssh",
  ])("refuses system scheme %s", (scheme) =>
    expect(parse({ openSchemes: [scheme] }).success).toBe(false),
  );
  it.each(["detached", "terminal"])("refuses a timeout for %s", (mode) => {
    expect(
      parse(command({ mode, timeoutSeconds: undefined, stdin: undefined }))
        .success,
    ).toBe(true);
    expect(parse(command({ mode, stdin: undefined })).success).toBe(false);
  });
  it("accepts stdin text on a detached command", () => {
    expect(
      parse(command({ mode: "detached", timeoutSeconds: undefined })).success,
    ).toBe(true);
  });
  it("refuses stdin on a terminal command", () => {
    expect(
      parse(command({ mode: "terminal", timeoutSeconds: undefined })).success,
    ).toBe(false);
  });
  it("bounds each command and the whole processes block", () => {
    expect(
      parse(command({ args: Array(30).fill("x".repeat(1000)) })).success,
    ).toBe(false);
    expect(
      parse({
        ...processes,
        executables: Object.fromEntries(
          Array.from({ length: 10000 }, (_, i) => [
            `tool${i}`,
            { names: ["x".repeat(100)] },
          ]),
        ),
      }).success,
    ).toBe(false);
  });
});
it("caps review argv and policies at 16 KB and command counts at 256", () => {
  const command = { id: "run", argv: "git", policy: "{}" };
  const summary = {
    ...NO_PLUGIN_ACCESS,
    commands: Array.from({ length: 256 }, (_, i) => ({
      ...command,
      id: `run${i}`,
    })),
  };
  expect(pluginAccessSummarySchema.safeParse(summary).success).toBe(true);
  expect(
    pluginAccessSummarySchema.safeParse({
      ...summary,
      commands: [...summary.commands, command],
    }).success,
  ).toBe(false);
  for (const key of ["argv", "policy"]) {
    const oversized = {
      ...NO_PLUGIN_ACCESS,
      commands: [{ ...command, [key]: "x".repeat(16385) }],
    };
    expect(pluginAccessSummarySchema.safeParse(oversized).success).toBe(false);
    expect(
      pluginAccessDifferenceSchema.safeParse(
        pluginAccessDifference(undefined, oversized),
      ).success,
    ).toBe(false);
  }
});
it.each([
  "node",
  "python",
  "python3",
  "py",
  "ruby",
  "perl",
  "php",
  "deno",
  "bun",
  "java",
  "osascript",
  "python3.12",
  "python3.11",
  "node22",
  "ruby3.3",
  "perl5.38",
  "php8.3",
  "pypy3",
])("allows %s but warns about code execution in Access", (name) => {
  for (const executable of [name, name.toUpperCase() + ".EXE"]) {
    const manifest = pluginApi4ManifestSchema.parse({
      ...jiraManifest(),
      processes: {
        ...processes,
        executables: { t3: { names: [executable] } },
      },
    });
    expect(
      summarizePluginAccess(manifest, { agentPrompts: {} }).commands?.[0]
        ?.description,
    ).toContain("runs code it is given: as wide as Accept everything");
  }
});

it.each(["python-tools", "node22-helper", "rubygems", "perldoc", "phpunit"])(
  "does not label the unrelated tool %s as a code interpreter",
  (name) => {
    const manifest = pluginApi4ManifestSchema.parse({
      ...jiraManifest(),
      processes: { ...processes, executables: { t3: { names: [name] } } },
    });
    expect(
      summarizePluginAccess(manifest, { agentPrompts: {} }).commands?.[0]
        ?.description,
    ).not.toContain("runs code it is given");
  },
);

it("keeps manifest count and aggregate size limits consistent with Access", () => {
  const commands = Array.from({ length: 256 }, (_, i) => ({
    id: `run${i}`,
    executable: "tool",
    args: [],
    mode: "capture",
  }));
  const manifest = {
    ...jiraManifest(),
    processes: { executables: { tool: { names: ["real-tool"] } }, commands },
  };
  const parsed = pluginApi4ManifestSchema.parse(manifest);
  const summary = summarizePluginAccess(parsed, { agentPrompts: {} });
  expect(summary.commands?.[0]?.argv).toBe("real-tool");
  expect(pluginAccessSummarySchema.safeParse(summary).success).toBe(true);
  expect(
    pluginApi4ManifestSchema.safeParse({
      ...manifest,
      processes: {
        ...manifest.processes,
        commands: [...commands, { ...commands[0], id: "extra" }],
      },
    }).success,
  ).toBe(false);
  expect(
    pluginApi4ManifestSchema.safeParse({
      ...manifest,
      processes: {
        ...manifest.processes,
        commands: commands
          .slice(0, 40)
          .map((c) => ({ ...c, args: Array(8).fill("x".repeat(1000)) })),
      },
    }).success,
  ).toBe(false);
});

it("names enum slots inside conditional groups", () => {
  const command = declaredCommandSchema.parse({
    id: "run",
    executable: "tool",
    mode: "capture",
    args: [
      {
        if: "format",
        args: [{ kind: "enum", name: "format", values: ["json", "text"] }],
      },
    ],
  });
  expect(commandArgvShape(command, ["git"])).toBe(
    "git [<format:json|text> if format]",
  );
});

describe("session commands (#743)", () => {
  const session = (change: Record<string, unknown> = {}) => ({
    ...processes,
    commands: [
      {
        id: "app-server",
        executable: "t3",
        args: ["app-server"],
        mode: "session",
        idleTimeoutSeconds: 600,
        ...change,
      },
    ],
  });
  const parse = (value: unknown) =>
    pluginApi4ManifestSchema.safeParse({ ...jiraManifest(), processes: value });

  it("declares an idle timeout of at most an hour", () => {
    expect(parse(session()).success).toBe(true);
    expect(parse(session({ idleTimeoutSeconds: 3600 })).success).toBe(true);
    for (const idleTimeoutSeconds of [undefined, 0, 3601, 1.5])
      expect(parse(session({ idleTimeoutSeconds })).success).toBe(false);
  });

  it("takes no stdin or capture timeout, and no other mode takes an idle timeout", () => {
    expect(parse(session({ stdin: "text" })).success).toBe(false);
    expect(parse(session({ timeoutSeconds: 60 })).success).toBe(false);
    for (const mode of ["capture", "detached", "terminal"])
      expect(parse(session({ mode })).success).toBe(false);
  });

  it("reads in Access review as a program kept running", () => {
    const manifest = pluginApi4ManifestSchema.parse({
      ...jiraManifest(),
      processes: session(),
    });
    const [command] = summarizePluginAccess(manifest, {
      agentPrompts: {},
    }).commands!;
    expect(command!.argv).toBe("t3 app-server");
    expect(command!.description).toContain(
      "Keeps a program running and talks to it.",
    );
    expect(command!.description).toContain("Ends after 10 minutes unused");
    expect(command!.description).not.toMatch(/stdin|timeout/i);
  });

  it.each([
    [60, "1 minute"],
    [90, "90 seconds"],
    [1, "1 second"],
    [3600, "60 minutes"],
  ])("says %i seconds unused as %s", (idleTimeoutSeconds, words) => {
    const manifest = pluginApi4ManifestSchema.parse({
      ...jiraManifest(),
      processes: session({ idleTimeoutSeconds }),
    });
    const [command] = summarizePluginAccess(manifest, {
      agentPrompts: {},
    }).commands!;
    expect(command!.description).toContain(`Ends after ${words} unused,`);
  });
});

describe("a command's working folder (#761)", () => {
  const threadShow = (change: Record<string, unknown> = {}) => ({
    ...processes,
    commands: [
      {
        id: "thread-show",
        executable: "t3",
        args: ["thread", "show", "{thread:id}", "--json"],
        cwd: "{repo:folder}",
        mode: "capture",
        ...change,
      },
    ],
  });
  const parse = (value: unknown) =>
    pluginApi4ManifestSchema.safeParse({ ...jiraManifest(), processes: value });
  const summaryOf = (value: unknown) =>
    summarizePluginAccess(
      pluginApi4ManifestSchema.parse({ ...jiraManifest(), processes: value }),
      { agentPrompts: {} },
    );

  it("names a folder slot that sets the working folder and stays out of argv", () => {
    const parsed = parse(threadShow());
    expect(parsed.success).toBe(true);
    const command = parsed.data!.processes!.commands[0]!;
    expect(command.cwd).toEqual({ kind: "folder", name: "repo" });
    expect(command.args).toEqual([
      { kind: "literal", value: "thread" },
      { kind: "literal", value: "show" },
      { kind: "id", name: "thread" },
      { kind: "literal", value: "--json" },
    ]);
  });

  it("may reuse a folder argument's slot", () => {
    expect(
      parse(threadShow({ args: ["thread", "show", "{repo:folder}"] })).success,
    ).toBe(true);
  });

  it.each(["detached", "terminal"])("works for a %s command", (mode) => {
    expect(parse(threadShow({ mode })).success).toBe(true);
  });

  it("works for a session command", () => {
    expect(
      parse(threadShow({ mode: "session", idleTimeoutSeconds: 60 })).success,
    ).toBe(true);
  });

  it.each([
    ["a text slot", "{repo:text}"],
    ["a host-filled slot", "{repo:connection-url}"],
    ["a bare name", "repo"],
    ["a path", "C:\repo"],
    ["an object", { kind: "folder", name: "repo" }],
  ])("refuses %s", (_, cwd) => {
    expect(parse(threadShow({ cwd })).success).toBe(false);
  });

  it("refuses a slot the arguments use as another kind", () => {
    const result = parse(
      threadShow({ args: ["thread", "show", "{repo:text}"] }),
    );
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/folder slot/);
  });

  it("refuses a slot inside a conditional group, which the working folder always needs", () => {
    const result = parse(
      threadShow({
        args: ["thread", "show", { if: "repo", args: ["{repo:folder}"] }],
      }),
    );
    expect(result.success).toBe(false);
    expect(result.error!.issues[0]!.message).toMatch(/conditional group/);
  });

  it("reads in Access review as running in the repository folder", () => {
    const [command] = summaryOf(threadShow()).commands!;
    expect(command!.argv).toBe("t3 thread show <id> --json");
    expect(command!.description).toContain("Runs in the repository folder.");
    const [plain] = summaryOf(processes).commands!;
    expect(plain!.description).not.toContain("repository folder");
  });

  it.each([
    ["adding a working folder", threadShow({ cwd: undefined }), threadShow()],
    [
      "changing its slot",
      threadShow({ args: ["{other:folder}"] }),
      threadShow({ args: ["{other:folder}"], cwd: "{other:folder}" }),
    ],
  ])("asks for consent again after %s", (_, before, after) => {
    const difference = pluginAccessDifference(
      summaryOf(before),
      summaryOf(after),
    );
    expect(difference.commands).toEqual([
      expect.objectContaining({ id: "thread-show" }),
    ]);
    expect(widensAccess(difference)).toBe(true);
  });
});
