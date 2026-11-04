import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import type { CliIo } from "./io.ts";
import { UsageError } from "./errors.ts";

export function cachePath(io: CliIo): string {
  const base = io.env.XDG_CACHE_HOME;
  return base
    ? path.join(base, "ajour", "tasks.json")
    : io.platform === "win32" && io.env.LOCALAPPDATA
      ? path.join(io.env.LOCALAPPDATA, "ajour", "cache", "tasks.json")
      : path.join(io.homedir, ".cache", "ajour", "tasks.json");
}

/** The subprocess bounds connection, handshake, call and cleanup together. */
export async function completeTasks(io: CliIo): Promise<number> {
  const file = cachePath(io);
  try {
    try {
      const cached: unknown = JSON.parse(await readFile(file, "utf8"));
      if (
        typeof cached === "object" &&
        cached !== null &&
        "at" in cached &&
        typeof cached.at === "number" &&
        io.now() >= cached.at &&
        io.now() - cached.at < 60_000 &&
        "tasks" in cached &&
        Array.isArray(cached.tasks) &&
        cached.tasks.every(
          (task: unknown) =>
            typeof task === "string" && !/[\x00-\x09\x0b-\x1f\x7f]/.test(task),
        )
      ) {
        io.stdout.write(
          cached.tasks.join("\0") + (cached.tasks.length ? "\0" : ""),
        );
        return 0;
      }
    } catch {
      /* A missing or invalid cache is a miss. */
    }
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        "--experimental-strip-types",
        "--no-warnings",
        fileURLToPath(new URL("./task-candidates.ts", import.meta.url)),
      ],
      {
        env: { ...io.env, AJOUR_COMPLETION_HOME: io.homedir },
        timeout: 900,
        windowsHide: true,
        maxBuffer: 1024 * 1024,
      },
    );
    const tasks = stdout
      .split("\0")
      .filter((task) => task && !/[\x00-\x09\x0b-\x1f\x7f]/.test(task));
    const dir = path.dirname(file);
    const temporary = path.join(
      dir,
      `.tasks-${randomBytes(8).toString("hex")}`,
    );
    try {
      await mkdir(dir, { recursive: true, mode: 0o700 });
      await writeFile(temporary, JSON.stringify({ at: io.now(), tasks }), {
        flag: "wx",
        mode: 0o600,
      });
      await chmod(temporary, 0o600);
      await rename(temporary, file);
    } catch {
      /* Completion still works when the cache cannot be written. */
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    io.stdout.write(tasks.join("\0") + (tasks.length ? "\0" : ""));
  } catch {
    /* A completion must never interrupt the shell with an error. */
  }
  return 0;
}

type OptionTable = Record<
  string,
  { options: Record<string, { type: string; short?: string }> }
>;
export function completion(
  shell: string | undefined,
  commands: OptionTable,
  globals: Record<string, { type: string; short?: string }>,
): string {
  const names = Object.keys(commands).filter((name) => !name.startsWith("__"));
  const words =
    "today yesterday mon tue wed thu fri sat sun week last-week running last";
  const options = (table: Record<string, { type: string; short?: string }>) =>
    Object.entries(table)
      .flatMap(([name, option]) => [
        `--${name}`,
        ...(option.short ? [`-${option.short}`] : []),
      ])
      .join(" ");
  const allOptions = [
    ...new Set(
      names.flatMap((name) =>
        options({ ...globals, ...commands[name]!.options }).split(" "),
      ),
    ),
  ].join(" ");
  const staticWords = `${names.join(" ")} ${allOptions} ${words}`;
  if (shell === "bash")
    return `# Source this file in bash.
_ajour_complete() {
  local cur candidate quoted
  cur="\${COMP_WORDS[COMP_CWORD]}"
  COMPREPLY=()
  while IFS= read -r -d '' candidate; do
    if [[ "$candidate" == "$cur"* ]]; then
      printf -v quoted '%q' "$candidate"
      COMPREPLY+=("$quoted")
    fi
  done < <(
    printf '%s\\0' ${staticWords
      .split(" ")
      .map((word) => `'${word}'`)
      .join(" ")}
    if [[ "\${COMP_WORDS[1]}" == start || "\${COMP_WORDS[1]}" == add || "\${COMP_WORDS[1]}" == edit ]]; then
      ajour __complete tasks 2>/dev/null
    fi
  )
}
complete -F _ajour_complete ajour
`;
  if (shell === "zsh")
    return `# Source this file after compinit.
_ajour_complete() {
  local -a candidates
  candidates=(${staticWords})
  if [[ "$words[2]" == (start|add|edit) ]]; then
    candidates+=("\${(@0)$(ajour __complete tasks 2>/dev/null)}")
  fi
  compadd -- "\${candidates[@]}"
}
compdef _ajour_complete ajour
`;
  if (shell === "fish")
    return `# Source this file in fish.
function __ajour_candidates
  printf '%s\\n' ${staticWords}
  set -l words (commandline -opc)
  if contains -- "$words[2]" start add edit
    ajour __complete tasks 2>/dev/null | string split0
  end
end
complete -c ajour -f -a '(__ajour_candidates)'
`;
  throw new UsageError("completion takes bash, zsh or fish.");
}
