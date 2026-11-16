import { describe, expect, it } from "vitest";
import { pluginApi4ManifestSchema } from "../plugin-api-4";
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
          commands: [{ ...processes.commands[0], mode, timeoutSeconds: 600 }],
        }).success,
      ).toBe(true);
  });
});
