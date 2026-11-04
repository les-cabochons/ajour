#!/usr/bin/env node
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { connect } from "./commands/connect.ts";
import { continueEntry } from "./commands/continue.ts";
import { discard } from "./commands/discard.ts";
import { edit } from "./commands/edit.ts";
import { log } from "./commands/log.ts";
import { start } from "./commands/start.ts";
import { status } from "./commands/status.ts";
import { stop } from "./commands/stop.ts";
import { undo } from "./commands/undo.ts";
import { add } from "./commands/add.ts";
import { dup } from "./commands/dup.ts";
import { move } from "./commands/move.ts";
import { rm } from "./commands/rm.ts";
import { createContext, type Context } from "./context.ts";
import { CliError, EXIT, UsageError } from "./errors.ts";
import { painter, shouldColor, type ColorMode } from "./format/style.ts";
import { processIo, type CliIo } from "./io.ts";

type Options = NonNullable<ParseArgsConfig["options"]>;
type Values = Record<string, string | boolean | undefined>;

interface Command {
  options: Options;
  /** How many arguments it takes after its name. */
  arguments: number;
  run(ctx: Context, values: Values, positionals: string[]): Promise<number>;
}

const GLOBAL_OPTIONS = {
  json: { type: "boolean" },
  color: { type: "string" },
  quiet: { type: "boolean", short: "q" },
  version: { type: "boolean", short: "V" },
  help: { type: "boolean", short: "h" },
} satisfies Options;

/** -m NOTE and -d DURATION, for the commands that write an entry. */
const ENTRY_OPTIONS = {
  note: { type: "string", short: "m" },
  duration: { type: "string", short: "d" },
} satisfies Options;

function text(value: string | boolean | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** Saved-entry commands. Edit shares its registration with running entries. */
const SAVED_ENTRY_COMMANDS: Record<string, Command> = {
  add: {
    options: { ...ENTRY_OPTIONS, on: { type: "string" } },
    arguments: 1,
    run: (ctx, values, [task]) =>
      add(ctx, {
        task,
        note: text(values.note),
        duration: text(values.duration),
        on: text(values.on),
      }),
  },
  move: {
    options: { to: { type: "string" } },
    arguments: 1,
    run: (ctx, values, [entry]) => move(ctx, { entry, to: text(values.to) }),
  },
  dup: {
    options: { to: { type: "string" } },
    arguments: 1,
    run: (ctx, values, [entry]) => dup(ctx, { entry, to: text(values.to) }),
  },
  rm: {
    options: {},
    arguments: Infinity,
    run: (ctx, _values, entries) => rm(ctx, { entries }),
  },
};

const COMMANDS: Record<string, Command> = {
  ...SAVED_ENTRY_COMMANDS,
  start: {
    options: ENTRY_OPTIONS,
    arguments: 1,
    run: (ctx, values, [task]) =>
      start(ctx, {
        task,
        note: text(values.note),
        duration: text(values.duration),
      }),
  },
  stop: { options: {}, arguments: 0, run: (ctx) => stop(ctx) },
  continue: {
    options: {},
    arguments: 1,
    run: (ctx, _values, [entry]) => continueEntry(ctx, { entry }),
  },
  edit: {
    options: ENTRY_OPTIONS,
    arguments: 2,
    run: (ctx, values, [entry, task]) =>
      edit(ctx, {
        entry,
        task,
        note: text(values.note),
        duration: text(values.duration),
      }),
  },
  discard: { options: {}, arguments: 0, run: (ctx) => discard(ctx) },
  undo: { options: {}, arguments: 0, run: (ctx) => undo(ctx) },
  connect: {
    options: { "token-stdin": { type: "boolean" } },
    arguments: 0,
    run: (ctx, values) =>
      connect(ctx, { tokenStdin: values["token-stdin"] === true }),
  },
  log: {
    options: {
      format: { type: "string" },
      by: { type: "string" },
      summary: { type: "boolean", short: "s" },
      project: { type: "string" },
      task: { type: "string" },
      committed: { type: "boolean" },
      uncommitted: { type: "boolean" },
    },
    arguments: 1,
    run: (ctx, values, [range]) =>
      log(ctx, {
        range,
        format: text(values.format),
        by: text(values.by),
        summary: values.summary === true,
        project: text(values.project),
        task: text(values.task),
        committed: values.committed === true,
        uncommitted: values.uncommitted === true,
      }),
  },
  status: {
    options: {
      short: { type: "boolean", short: "s" },
      idle: { type: "string" },
      watch: { type: "boolean", short: "w" },
    },
    arguments: 0,
    run: (ctx, values) =>
      status(ctx, {
        short: values.short === true,
        idle: typeof values.idle === "string" ? values.idle : "",
        watch: values.watch === true,
      }),
  },
};

/** Runs one invocation and returns its exit code. Never throws. */
export async function run(argv: readonly string[], io: CliIo): Promise<number> {
  let ctx: Context | undefined;
  try {
    const name = commandName(argv);
    const command = name === undefined ? undefined : COMMANDS[name];
    if (name !== undefined && name !== "help" && !command) {
      throw new UsageError(`Unknown command "${name}". Run: ajour --help`);
    }
    const { values, positionals } = parse(argv, command?.options ?? {});
    if (values.version) {
      io.stdout.write(`ajour ${await version()}\n`);
      return EXIT.ok;
    }
    if (!command || values.help) {
      const page =
        name === "help" ? (positionals[1] ?? "ajour") : (name ?? "ajour");
      io.stdout.write(await manualPage(page));
      return EXIT.ok;
    }
    ctx = createContext(io, {
      color: colorMode(values.color),
      json: values.json === true,
      quiet: values.quiet === true,
    });
    const args = positionals.slice(1);
    if (args.length > command.arguments) {
      throw new UsageError(
        command.arguments === 0
          ? `${name} takes no arguments, not "${args[0]}"`
          : `${name} takes at most ${command.arguments} arguments`,
      );
    }
    return await command.run(ctx, values, args);
  } catch (error) {
    return report(error, io);
  } finally {
    await ctx?.close().catch(() => undefined);
  }
}

/** The first argument that is not an option, or an option's value. */
function commandName(argv: readonly string[]): string | undefined {
  const { tokens } = usage(() =>
    parseArgs({
      args: [...argv],
      options: GLOBAL_OPTIONS,
      strict: false,
      allowPositionals: true,
      tokens: true,
    }),
  );
  const first = tokens.find((token) => token.kind === "positional");
  return first?.kind === "positional" ? first.value : undefined;
}

function parse(argv: readonly string[], options: Options) {
  return usage(
    () =>
      parseArgs({
        args: [...argv],
        options: { ...GLOBAL_OPTIONS, ...options },
        strict: true,
        allowPositionals: true,
      }) as { values: Values; positionals: string[] },
  );
}

/** Runs a parse, turning Node's parse errors into exit 2. */
function usage<T>(parse: () => T): T {
  try {
    return parse();
  } catch (error) {
    // Node's message adds a hint about "--" that reads as noise here.
    const message = error instanceof Error ? error.message : String(error);
    throw new UsageError(message.split(". ")[0]!.replace(/\.$/, ""));
  }
}

function colorMode(value: unknown): ColorMode {
  if (value === undefined) return "auto";
  if (value === "auto" || value === "always" || value === "never") return value;
  throw new UsageError(
    `--color takes auto, always or never, not "${String(value)}"`,
  );
}

function report(error: unknown, io: CliIo): number {
  const paint = painter(
    shouldColor("auto", { isTTY: io.stderr.isTTY, env: io.env }),
  );
  if (error instanceof CliError) {
    const label = error.label ? `${paint.error(`${error.label}:`)} ` : "";
    io.stderr.write(`${label}${error.message}\n`);
    return error.exitCode;
  }
  const message = error instanceof Error ? error.message : String(error);
  io.stderr.write(`${paint.error("error:")} ${message}\n`);
  return EXIT.refused;
}

async function version(): Promise<string> {
  const manifest = JSON.parse(
    await readFile(new URL("../package.json", import.meta.url), "utf8"),
  ) as { version: string };
  return manifest.version;
}

/** For now the page's Markdown source; the manual ticket renders it. */
async function manualPage(name: string): Promise<string> {
  if (!/^[a-z-]+$/.test(name))
    throw new UsageError(`No manual page for "${name}".`);
  try {
    return await readFile(
      new URL(`../docs/${name}.md`, import.meta.url),
      "utf8",
    );
  } catch {
    throw new UsageError(`No manual page for "${name}".`);
  }
}

async function isEntryPoint(): Promise<boolean> {
  const script = process.argv[1];
  if (!script) return false;
  try {
    return (
      (await realpath(script)) ===
      (await realpath(fileURLToPath(import.meta.url)))
    );
  } catch {
    return false;
  }
}

if (await isEntryPoint()) {
  process.exitCode = await run(process.argv.slice(2), processIo());
}
