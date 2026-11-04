#!/usr/bin/env node
import { readFile, realpath } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseArgs, type ParseArgsConfig } from "node:util";
import { connect } from "./commands/connect.ts";
import { status } from "./commands/status.ts";
import { createContext, type Context } from "./context.ts";
import { CliError, EXIT, UsageError } from "./errors.ts";
import { painter, shouldColor, type ColorMode } from "./format/style.ts";
import { processIo, type CliIo } from "./io.ts";

type Options = NonNullable<ParseArgsConfig["options"]>;
type Values = Record<string, string | boolean | undefined>;

interface Command {
  options: Options;
  run(ctx: Context, values: Values, positionals: string[]): Promise<number>;
}

const GLOBAL_OPTIONS = {
  json: { type: "boolean" },
  color: { type: "string" },
  quiet: { type: "boolean", short: "q" },
  version: { type: "boolean", short: "V" },
  help: { type: "boolean", short: "h" },
} satisfies Options;

const COMMANDS: Record<string, Command> = {
  connect: {
    options: { "token-stdin": { type: "boolean" } },
    run: (ctx, values) =>
      connect(ctx, { tokenStdin: values["token-stdin"] === true }),
  },
  status: {
    options: {
      short: { type: "boolean", short: "s" },
      idle: { type: "string" },
      watch: { type: "boolean", short: "w" },
    },
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
    return await command.run(ctx, values, positionals.slice(1));
  } catch (error) {
    return report(error, io);
  } finally {
    await ctx?.close().catch(() => undefined);
  }
}

/** The first argument that is not an option, or an option's value. */
function commandName(argv: readonly string[]): string | undefined {
  const { tokens } = parseArgs({
    args: [...argv],
    options: GLOBAL_OPTIONS,
    strict: false,
    allowPositionals: true,
    tokens: true,
  });
  const first = tokens.find((token) => token.kind === "positional");
  return first?.kind === "positional" ? first.value : undefined;
}

function parse(argv: readonly string[], options: Options) {
  try {
    return parseArgs({
      args: [...argv],
      options: { ...GLOBAL_OPTIONS, ...options },
      strict: true,
      allowPositionals: true,
    }) as { values: Values; positionals: string[] };
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
    io.stderr.write(`${paint.error(`${error.label}:`)} ${error.message}\n`);
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
