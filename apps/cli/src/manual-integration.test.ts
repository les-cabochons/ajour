import { afterEach, expect, it } from "vitest";
import { readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { run } from "./main.ts";
import { ajour, closeTerminals, projects } from "./test-support/terminal.ts";
import { cachePath } from "./completion.ts";

afterEach(closeTerminals);
it("preserves newlines in live and cached completion records", async () => {
  const term = await ajour({
    list_projects: () => ({
      projects: [
        {
          ...projects.projects[0]!,
          tasks: [{ taskId: "newline", name: "line\nbreak" }],
        },
      ],
    }),
  });
  await run(["__complete", "tasks"], term.io);
  expect(term.out()).toBe("ACME/line\nbreak\0");
  term.clear();
  await run(["__complete", "tasks"], term.io);
  expect(term.out()).toBe("ACME/line\nbreak\0");
});
it.each(["table", "tsv", "csv", "json"])(
  "lists projects through the real API as %s",
  async (format) => {
    const data = {
      projects: [
        {
          ...projects.projects[0]!,
          tasks: [
            {
              taskId: "t",
              name: "Backend, API",
              pinnedSlot: 10,
              commitsAs: { kind: "task", name: "05 Backend" },
            },
          ],
        },
      ],
    };
    const term = await ajour({ list_projects: () => data });
    term.io.stdout.isTTY = format === "table";
    expect(await run(["projects", "--format", format], term.io)).toBe(0);
    expect(term.err()).toBe("");
    if (format === "json") expect(JSON.parse(term.out())).toEqual(data);
    else {
      expect(term.out()).toContain(
        format === "csv" ? '"Backend, API"' : "Backend, API",
      );
      expect(term.out()).toContain("05 Backend");
      expect(term.out()).toContain("0");
      if (format === "tsv")
        expect(term.out()).toBe(
          "project\ttask\tkey\tcommits_as\nACME\tBackend, API\t0\t05 Backend\n",
        );
    }
  },
);
it("completes live task names, uses a one-minute private cache, and stays silent on failure", async () => {
  const term = await ajour({ list_projects: () => projects });
  expect(await run(["__complete", "tasks"], term.io)).toBe(0);
  expect(term.out()).toContain("ACME/05 Backend\0");
  expect(term.err()).toBe("");
  const file = cachePath(term.io);
  expect(await readFile(file, "utf8")).toContain("ACME/05 Backend");
  if (process.platform !== "win32")
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  term.clear();
  await run(["__complete", "tasks"], term.io);
  expect(
    term.calls.filter((call) => call.tool === "list_projects"),
  ).toHaveLength(1);
  term.io.now = () => Date.now() + 120_000;
  term.clear();
  await run(["__complete", "tasks"], term.io);
  expect(
    term.calls.filter((call) => call.tool === "list_projects"),
  ).toHaveLength(2);
  await writeFile(file, "invalid");
  const offline = {
    ...term.io,
    env: { XDG_CACHE_HOME: path.join(term.home, "offline") },
  };
  term.clear();
  expect(await run(["__complete", "tasks"], offline)).toBe(0);
  expect(term.out() + term.err()).toBe("");
});
it.each(["bash", "zsh", "fish"])(
  "prints a %s script with static and live candidates",
  async (shell) => {
    const term = await ajour({});
    expect(await run(["completion", shell], term.io)).toBe(0);
    for (const word of [
      "__complete tasks",
      "start",
      "--duration",
      "today",
      "last-week",
      "running",
      "last",
    ])
      expect(term.out()).toContain(word);
  },
);
it("prints short help and the full manual in a pipe without invoking external readers", async () => {
  const term = await ajour({});
  term.io.env = { ...term.io.env, PAGER: "missing-pager" };
  expect(await run(["log", "--help"], term.io)).toBe(0);
  expect(term.out()).not.toContain("EXIT STATUS");
  term.clear();
  expect(await run(["help", "log"], term.io)).toBe(0);
  expect(term.out()).toContain("EXIT STATUS");
});

it("includes projects with no active tasks and honors --json and --quiet", async () => {
  const data = {
    projects: [{ projectId: "empty", name: "Empty project", tasks: [] }],
  };
  const term = await ajour({ list_projects: () => data });
  expect(await run(["projects"], term.io)).toBe(0);
  expect(term.out()).toBe(
    "project\ttask\tkey\tcommits_as\nEmpty project\t\t\t\n",
  );
  term.clear();
  expect(await run(["projects", "--json"], term.io)).toBe(0);
  expect(JSON.parse(term.out())).toEqual(data);
  term.clear();
  expect(await run(["projects", "--quiet"], term.io)).toBe(0);
  expect(term.out() + term.err()).toBe("");
});

it("bounds an unresponsive API lookup to about a second without diagnostics", async () => {
  const { createServer } = await import("node:http");
  const server = createServer(() => undefined);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const term = await ajour({});
    const address = server.address();
    if (!address || typeof address === "string")
      throw new Error("Expected a TCP address");
    term.io.env = {
      AJOUR_URL: `http://127.0.0.1:${address.port}`,
      AJOUR_TOKEN: "valid-token",
    };
    // This test is about the terminal's bound, not the test terminal's.
    term.io.completionTimeoutMs = 900;
    const started = performance.now();
    expect(await run(["__complete", "tasks"], term.io)).toBe(0);
    expect(performance.now() - started).toBeLessThan(1600);
    expect(term.out() + term.err()).toBe("");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it("locates completion caches on XDG and Windows", async () => {
  const term = await ajour({});
  expect(cachePath({ ...term.io, env: { XDG_CACHE_HOME: "cache" } })).toBe(
    path.join("cache", "ajour", "tasks.json"),
  );
  expect(
    cachePath({
      ...term.io,
      platform: "win32",
      env: { LOCALAPPDATA: "local" },
    }),
  ).toBe(path.join("local", "ajour", "cache", "tasks.json"));
});
