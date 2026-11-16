import path from "node:path";
import type { UndeclaredCommand } from "../../../packages/shared/command-modes.ts";
import type {
  CommandReview,
  CommandReviewContext,
  CommandVerdict,
} from "./command-review.ts";

/**
 * The fixed rule table for undeclared commands (ADR 0019). It reads only the
 * executable's name, the argument list and the folder the command runs in,
 * and never the file system, so the same command always gets the same
 * verdict. A rule only adds friction: `risky` asks in Auto, `review` shows
 * its reason in the dialog and the audit and asks for nothing by itself.
 */
export const processRuleTable = [
  {
    id: "shell",
    verdict: "risky",
    reason:
      "Starts a shell or script host, which runs any command it is given.",
  },
  {
    id: "inline-code",
    verdict: "risky",
    reason: "Runs program code written into its arguments.",
  },
  {
    id: "ajour-folder",
    verdict: "risky",
    reason:
      "Names a file in Ajour's own data, install or command folder, where every plugin's credentials live.",
  },
  {
    id: "credentials",
    verdict: "risky",
    reason: "Reads saved passwords, keys or tokens.",
  },
  {
    id: "disk",
    verdict: "risky",
    reason: "Erases, overwrites or formats a disk.",
  },
  {
    id: "delete",
    verdict: "risky",
    reason:
      "Deletes folders and files in bulk outside a repository folder, or a whole repository folder.",
  },
  {
    id: "send",
    verdict: "risky",
    reason: "Sends data to another computer.",
  },
  {
    id: "install",
    verdict: "risky",
    reason: "Installs software or code from outside the project.",
  },
  {
    id: "system",
    verdict: "risky",
    reason:
      "Changes system settings, user accounts, startup tasks or the power state.",
  },
  {
    id: "elevate",
    verdict: "risky",
    reason: "Runs a command as an administrator.",
  },
  {
    id: "launch",
    verdict: "risky",
    reason: "Starts another program, which Ajour can't check.",
  },
  {
    id: "path-outside",
    verdict: "risky",
    reason: "Names a path outside this plugin's repository folders.",
  },
  {
    id: "download",
    verdict: "review",
    reason: "Downloads from the internet.",
  },
  {
    id: "git-force-push",
    verdict: "review",
    reason: "Overwrites the history of a remote branch.",
  },
  {
    id: "git-discard",
    verdict: "review",
    reason: "Throws away uncommitted changes or untracked files.",
  },
  {
    id: "git-branch-delete",
    verdict: "review",
    reason: "Deletes a branch even if it isn't merged.",
  },
] as const satisfies readonly {
  id: string;
  verdict: "risky" | "review";
  reason: string;
}[];
export type ProcessRuleId = (typeof processRuleTable)[number]["id"];

const UNCHECKED: CommandVerdict = {
  verdict: "risky",
  ruleId: "unchecked",
  reason: "Ajour couldn't check this command.",
};

export interface RuleInput {
  /** The bare executable name the plugin asked for. */
  executable: string;
  argv: readonly string[];
  /** The absolute folder the command starts in. */
  cwd: string;
  /** The plugin's repository folders, as absolute paths. */
  repositoryFolders: readonly string[];
  /** Ajour's data, install and command folders. */
  protectedRoots: readonly string[];
  /** The user's home folder, to read `~` and `$HOME`. */
  home?: string;
}

/** Adapts the rule table to the broker's `CommandReview` port. */
export function processRules(options: {
  repositoryFolders(projectId?: string): Promise<readonly string[]>;
  protectedRoots: readonly string[];
  home?: string;
}): CommandReview {
  return {
    async review(command: UndeclaredCommand, context: CommandReviewContext) {
      try {
        return reviewCommand({
          executable: command.executable,
          argv: command.argv,
          cwd: context.cwd,
          repositoryFolders: await options.repositoryFolders(context.projectId),
          protectedRoots: options.protectedRoots,
          home: options.home,
        });
      } catch {
        // Rules only add friction: a check that fails asks.
        return UNCHECKED;
      }
    },
  };
}

export function reviewCommand(input: RuleInput): CommandVerdict {
  const windows = isWindowsPath(input.cwd);
  const flavor = windows ? path.win32 : path.posix;
  const context: Context = {
    flavor,
    windows,
    cwd: input.cwd,
    repositories: input.repositoryFolders,
    protectedRoots: input.protectedRoots,
    home: input.home,
    inRepository: input.repositoryFolders.some((folder) =>
      inside(flavor, windows, folder, input.cwd),
    ),
  };
  const command = { name: commandName(input.executable), args: input.argv };
  const id = riskyRule(command, context, 0) ?? reviewRule(command);
  if (!id) return { verdict: "none" };
  const rule = processRuleTable.find((r) => r.id === id)!;
  return { verdict: rule.verdict, ruleId: rule.id, reason: rule.reason };
}

interface Context {
  flavor: path.PlatformPath;
  windows: boolean;
  cwd: string;
  repositories: readonly string[];
  protectedRoots: readonly string[];
  home?: string;
  inRepository: boolean;
}
interface Command {
  name: string;
  args: readonly string[];
}

/** `Git.EXE` and `git` are the same command. */
export function commandName(executable: string): string {
  return executable.toLowerCase().replace(/\.(exe|cmd|bat|com)$/, "");
}

// ---------------------------------------------------------------- arguments

/** A POSIX short option cluster such as `-rf`, never `--long` or `-`. */
function cluster(arg: string): string | undefined {
  return /^-[A-Za-z0-9]+$/.test(arg) ? arg.slice(1) : undefined;
}
/**
 * The letters a short option cluster sets before an option that takes the
 * rest of the cluster as its value, which is included: `-sd@x` sets s, d.
 */
function shortFlags(arg: string, takesValue: string): string {
  const letters = cluster(arg);
  if (letters === undefined) return "";
  let flags = "";
  for (const letter of letters) {
    flags += letter;
    if (takesValue.includes(letter)) break;
  }
  return flags;
}
function hasShort(
  args: readonly string[],
  letters: string,
  takesValue = "",
): boolean {
  return args.some((arg) =>
    [...shortFlags(arg, takesValue)].some((f) => letters.includes(f)),
  );
}
function long(arg: string, ...names: string[]): boolean {
  return names.some(
    (name) => arg === `--${name}` || arg.startsWith(`--${name}=`),
  );
}
function hasLong(args: readonly string[], ...names: string[]): boolean {
  return args.some((arg) => long(arg, ...names));
}
/** A PowerShell parameter, which may be shortened: `-Rec` is `-Recurse`. */
function psParam(arg: string, name: string, shortest = 1): boolean {
  const given = /^-([A-Za-z]+)(?::.*)?$/.exec(arg)?.[1]?.toLowerCase();
  return (
    given !== undefined &&
    given.length >= shortest &&
    name.toLowerCase().startsWith(given)
  );
}
function hasPs(args: readonly string[], name: string, shortest = 1): boolean {
  return args.some((arg) => psParam(arg, name, shortest));
}
/** A PowerShell parameter's value, given as the next argument or `-P:value`. */
function psValues(args: readonly string[], name: string, shortest = 1) {
  const values: string[] = [];
  args.forEach((arg, index) => {
    if (!psParam(arg, name, shortest)) return;
    const attached = /^-[A-Za-z]+:(.*)$/.exec(arg)?.[1];
    const value = attached ?? args[index + 1];
    if (value !== undefined) values.push(value.toLowerCase());
  });
  return values;
}
/** A cmd.exe switch such as `/S`, `/q` or `/w:C:\`. */
function winSwitch(arg: string): { name: string; value?: string } | undefined {
  const match = /^\/([A-Za-z?]+)(?::(.*))?$/.exec(arg);
  return match ? { name: match[1]!.toLowerCase(), value: match[2] } : undefined;
}
function hasSwitch(args: readonly string[], ...names: string[]): boolean {
  return args.some((arg) => {
    const parsed = winSwitch(arg);
    return parsed !== undefined && names.includes(parsed.name);
  });
}
function isHelp(arg: string): boolean {
  return ["--help", "-h", "-?", "/?", "--version", "-v"].includes(arg);
}
/** Arguments that are neither options nor cmd.exe switches. */
function positionals(args: readonly string[]): string[] {
  return args.filter(
    (arg) =>
      !arg.startsWith("-") &&
      !(winSwitch(arg) && !POSIX_ROOTS.has(arg.slice(1).toLowerCase())),
  );
}
const isUrl = (arg: string) => /^[a-z][a-z0-9+.-]*:\/\//i.test(arg);

// ---------------------------------------------------------------- paths

/** A set of the names in a space-separated list. */
function words(list: string): ReadonlySet<string> {
  return new Set(list.trim().split(/\s+/));
}

const POSIX_ROOTS = words(`
  applications bin boot dev etc home lib lib64 library media mnt opt private
  proc root run sbin srv sys system tmp users usr var volumes
`);
const WINDOWS_ROOTS = new Set([
  "users",
  "windows",
  "programdata",
  "program files",
  "program files (x86)",
  "documents and settings",
  "$recycle.bin",
  "system volume information",
  "recovery",
]);
const WHOLE_FOLDER = new Set(["", ".", "*", "*.*", "**"]);
const HOME_VARIABLES = new Set(["home", "userprofile"]);
const PATH_VARIABLES = new Set([
  "home",
  "userprofile",
  "profile",
  "appdata",
  "localappdata",
  "programdata",
  "programfiles",
  "programfiles(x86)",
  "systemroot",
  "systemdrive",
  "windir",
  "temp",
  "tmp",
  "tmpdir",
  "homedrive",
  "homepath",
  "public",
]);

function isWindowsPath(value: string): boolean {
  return /^[A-Za-z]:([\\/]|$)/.test(value) || /^[\\/]{2}[^\\/]/.test(value);
}
function inside(
  flavor: path.PlatformPath,
  windows: boolean,
  parent: string,
  child: string,
): boolean {
  const fold = (value: string) => (windows ? value.toLowerCase() : value);
  const relative = flavor.relative(fold(parent), fold(child));
  return (
    relative === "" ||
    (relative !== ".." &&
      !relative.startsWith(`..${flavor.sep}`) &&
      !flavor.isAbsolute(relative))
  );
}

/** Where a path argument leads, or nothing when it doesn't name a path. */
interface PathFact {
  /** Outside every repository folder. */
  outside: boolean;
  /** Inside one of Ajour's own folders. */
  ajour: boolean;
  /** A repository folder itself, or a folder holding one. */
  wholeRepository: boolean;
}

/**
 * The values inside an argument that may name a path: the argument, what
 * follows `=` (`of=/dev/sda`, `--file=x`), `@` (`-d @.env`) or a switch's
 * `:` (`/w:C:\`), and a `file:` URL's path.
 */
function pathCandidates(arg: string): string[] {
  const values = [arg];
  const equals = arg.indexOf("=");
  if (equals > 0) values.push(arg.slice(equals + 1));
  for (const value of [...values]) {
    if (value.startsWith("@")) values.push(value.slice(1));
    const fileUrl = /^file:\/\/(?:localhost)?(\/.*)$/i.exec(value)?.[1];
    if (fileUrl)
      values.push(/^\/[A-Za-z]:/.test(fileUrl) ? fileUrl.slice(1) : fileUrl);
  }
  const switchValue = winSwitch(arg)?.value;
  if (switchValue) values.push(switchValue);
  return values;
}

/**
 * Reads `~`, `$HOME`, `$env:NAME`, `${NAME}` and `%NAME%` at the start of a
 * value. A home folder becomes the user's home when known; any other
 * variable becomes `undefined`, since only a shell knows its value, and a
 * variable is still a path outside the repository folders.
 */
function expandStart(
  value: string,
  home: string | undefined,
): { value: string } | { unknown: true } | undefined {
  const tilde = /^~(?=[\\/]|$)/.exec(value);
  const variable =
    /^(?:\$env:([A-Za-z_][\w()]*)|\$\{([A-Za-z_]\w*)\}|\$([A-Za-z_]\w*)|%([A-Za-z_][\w()]*)%)(?=[\\/]|$)/i.exec(
      value,
    );
  if (!tilde && !variable) return undefined;
  const name = variable
    ? (variable[1] ?? variable[2] ?? variable[3] ?? variable[4])!.toLowerCase()
    : "home";
  const rest = value.slice((tilde ?? variable)![0].length);
  if (!rest && !PATH_VARIABLES.has(name)) return undefined;
  if (HOME_VARIABLES.has(name) && home) return { value: home + rest };
  if (name === "localappdata" && home)
    return { value: `${home}\\AppData\\Local${rest}` };
  if (name === "appdata" && home)
    return { value: `${home}\\AppData\\Roaming${rest}` };
  return { unknown: true };
}

function pathFacts(arg: string, context: Context): PathFact[] {
  const facts: PathFact[] = [];
  for (const candidate of pathCandidates(arg)) {
    const fact = pathFact(candidate, context);
    if (fact) facts.push(fact);
  }
  return facts;
}

function pathFact(raw: string, context: Context): PathFact | undefined {
  const { flavor, windows } = context;
  if (!raw || isUrl(raw)) return undefined;
  let value = raw;
  const expanded = expandStart(value, context.home);
  if (expanded && "unknown" in expanded)
    return { outside: true, ajour: false, wholeRepository: false };
  if (expanded) value = expanded.value;
  const windowsAbsolute =
    /^[A-Za-z]:/.test(value) || /^[\\/]{2}[^\\/]/.test(value);
  const rootRelative = /^[\\/]/.test(value);
  if (rootRelative && !windowsAbsolute) {
    // A lone `/s` or `/list` is a cmd.exe switch, unless it is a POSIX
    // top-level folder such as `/etc` or the root itself.
    const segment = /^\/([^\\/]*)$/.exec(value)?.[1];
    if (
      segment !== undefined &&
      segment !== "" &&
      !POSIX_ROOTS.has(segment.toLowerCase())
    )
      return undefined;
  }
  let resolved: string;
  if (windowsAbsolute || rootRelative) {
    if (windowsAbsolute && !windows)
      return { outside: true, ajour: false, wholeRepository: false };
    resolved = flavor.resolve(context.cwd, value);
  } else {
    const segments = value.split(/[\\/]/);
    if (!segments.includes("..")) {
      // Inside a repository folder, a relative path stays inside it.
      if (context.inRepository) return undefined;
      // From the system root, flag the root itself, a top-level system
      // folder, and anything reaching Ajour's folders, but read
      // `feature/login` as a branch, not a path.
      const first = segments[0]!.toLowerCase();
      const wholeFolder = segments.every((s) => WHOLE_FOLDER.has(s));
      const systemFolder =
        segments.length > 1 &&
        (POSIX_ROOTS.has(first) || WINDOWS_ROOTS.has(first));
      if (!wholeFolder && !systemFolder) {
        if (segments.length < 2) return undefined;
        const reached = flavor.resolve(context.cwd, value);
        return context.protectedRoots.some((root) =>
          inside(flavor, windows, root, reached),
        )
          ? { outside: true, ajour: true, wholeRepository: false }
          : undefined;
      }
    }
    resolved = flavor.resolve(context.cwd, value);
  }
  const target = stripWildcards(flavor, resolved);
  return {
    outside: !context.repositories.some((folder) =>
      inside(flavor, windows, folder, target),
    ),
    ajour: context.protectedRoots.some((root) =>
      inside(flavor, windows, root, target),
    ),
    wholeRepository: context.repositories.some((folder) =>
      inside(flavor, windows, target, folder),
    ),
  };
}
function stripWildcards(flavor: path.PlatformPath, value: string): string {
  let current = value;
  while (/[*?]/.test(flavor.basename(current)))
    current = flavor.dirname(current);
  return current;
}
function anyPath(
  args: readonly string[],
  context: Context,
  test: (fact: PathFact) => boolean,
): boolean {
  return args.some((arg) => pathFacts(arg, context).some(test));
}

// ---------------------------------------------------------------- risky

function riskyRule(
  command: Command,
  context: Context,
  depth: number,
): ProcessRuleId | undefined {
  const { name, args } = command;
  if (SHELLS.has(name)) return "shell";
  if (inlineCode(command)) return "inline-code";
  if (anyPath(args, context, (fact) => fact.ajour)) return "ajour-folder";
  if (credentials(command, context)) return "credentials";
  if (disk(command)) return "disk";
  if (deletes(command, context)) return "delete";
  if (sends(command)) return "send";
  if (installs(command)) return "install";
  if (system(command)) return "system";
  const wrapped = wrapper(command);
  if (wrapped) {
    const inner =
      wrapped.inner && depth < 4
        ? riskyRule(wrapped.inner, context, depth + 1)
        : undefined;
    return inner ?? wrapped.rule;
  }
  if (launches(command)) return "launch";
  if (anyPath(args, context, (fact) => fact.outside)) return "path-outside";
  return undefined;
}

const SHELLS = words(`
  sh bash zsh fish dash ksh mksh csh tcsh ash busybox nu xonsh elvish cmd
  command powershell powershell_ise pwsh wsl wslhost wscript cscript mshta
  rundll32 regsvr32 conhost explorer start invoke-expression iex
`);

function inlineCode({ name, args }: Command): boolean {
  if (/^node(js)?\d*$/.test(name) || /^(tsx|ts-node|esno)$/.test(name))
    return (
      hasLong(args, "eval", "print") ||
      args.some((arg) => /^-[pe]+$/.test(arg)) ||
      args.some((arg) => pathCandidates(arg).some((v) => /^data:/i.test(v)))
    );
  if (name === "bun")
    return hasLong(args, "eval", "print") || hasShort(args, "ep");
  if (name === "deno")
    return (
      positionals(args)[0] === "eval" ||
      hasLong(args, "eval") ||
      args.some((arg) => /^data:/i.test(arg))
    );
  if (/^(python|pythonw|py)(\d+(\.\d+)*)?$/.test(name))
    return hasShort(args, "c", "mWXQ");
  if (/^ruby\d*(\.\d+)*$/.test(name)) return hasShort(args, "e", "rIECFTx0W");
  if (/^perl\d*(\.\d+)*$/.test(name)) return hasShort(args, "eE", "IMmCxiFdDV");
  if (/^php\d*(\.\d+)*$/.test(name))
    return (
      hasShort(args, "rBRE", "rBREFcdzt") ||
      hasLong(args, "run", "process-begin", "process-code", "process-end")
    );
  if (["osascript", "lua", "luajit", "rscript", "r"].includes(name))
    return hasShort(args, "e") || hasLong(args, "expr");
  if (["awk", "gawk", "mawk", "nawk"].includes(name))
    return (
      !args.some((arg) => arg === "-f" || long(arg, "file")) &&
      !args.every(isHelp) &&
      positionals(args).length > 0
    );
  return false;
}

const CREDENTIAL_FILES = new Set([
  ".netrc",
  "_netrc",
  ".npmrc",
  ".pypirc",
  ".git-credentials",
  ".pgpass",
  ".vault-token",
  ".htpasswd",
  "id_rsa",
  "id_dsa",
  "id_ecdsa",
  "id_ed25519",
  "id_ecdsa_sk",
  "id_ed25519_sk",
  "app-api-vault.json",
  "login.keychain-db",
]);
const CREDENTIAL_FOLDERS = new Set([
  ".ssh",
  ".aws",
  ".azure",
  ".gnupg",
  ".password-store",
  ".kube",
  ".oci",
  "keychains",
]);
const CREDENTIAL_CONFIG_FOLDERS = new Set(["gh", "gcloud", "op", "hub"]);
function credentialPath(value: string): boolean {
  const segments = value.replaceAll("\\", "/").toLowerCase().split("/");
  const base = segments.at(-1) ?? "";
  if (CREDENTIAL_FILES.has(base)) return true;
  if (/\.(kdbx|pfx|p12|ppk|keychain|keychain-db)$/.test(base)) return true;
  if (
    /^\.env(\..+)?$/.test(base) &&
    !/\.(example|sample|template|dist|defaults|schema)$/.test(base)
  )
    return true;
  return segments.some(
    (segment, index) =>
      CREDENTIAL_FOLDERS.has(segment) ||
      (segment === ".config" &&
        CREDENTIAL_CONFIG_FOLDERS.has(segments[index + 1] ?? "")) ||
      (segment === "github cli" && index > 0) ||
      (segment === ".docker" && segments[index + 1] === "config.json"),
  );
}
const SENSITIVE_KEY = /putty|winscp|credential|password|secret|token|vault/i;

function credentials({ name, args }: Command, context: Context): boolean {
  if (
    args.some((arg) =>
      pathCandidates(arg).some((value) => {
        const expanded = expandStart(value, context.home);
        return credentialPath(
          expanded && "value" in expanded ? expanded.value : value,
        );
      }),
    )
  )
    return true;
  const [first, second] = positionals(args).map((a) => a.toLowerCase());
  const plain = args.length === 0 || !args.every(isHelp);
  switch (name) {
    case "cmdkey":
    case "vaultcmd":
    case "get-credential":
    case "get-storedcredential":
    case "get-secret":
    case "bw":
    case "lpass":
    case "pass":
    case "printenv":
    case "mimikatz":
    case "lazagne":
      return plain;
    case "env":
      return positionals(args).every((arg) => arg.includes("="));
    case "security":
      return /^(find-.*-password|dump-keychain|export|find-certificate)$/.test(
        first ?? "",
      );
    case "gh":
      return (
        first === "auth" &&
        (second === "token" ||
          (second === "status" &&
            (args.includes("--show-token") || args.includes("-t"))))
      );
    case "git": {
      const sub = gitSubcommand(args);
      return sub?.name === "credential" || /^credential-/.test(sub?.name ?? "");
    }
    case "vault":
    case "op":
      return plain && first !== "update";
    case "secret-tool":
      return first === "lookup" || first === "search";
    case "keyring":
      return first === "get";
    case "az":
      return first === "account" && second === "get-access-token";
    case "gcloud":
      return args.some((arg) => /^print-.*token$/.test(arg));
    case "aws":
      return (
        (first === "configure" &&
          ["get", "export-credentials"].includes(second ?? "")) ||
        (first === "sts" && second === "get-session-token") ||
        (first === "ecr" && second === "get-login-password")
      );
    case "npm":
      return first === "token";
    case "reg":
      return (
        ["query", "export", "save"].includes(first ?? "") &&
        SENSITIVE_KEY.test(second ?? "")
      );
    case "get-childitem":
    case "gci":
    case "ls":
    case "dir":
    case "get-item":
    case "gi":
    case "get-content":
    case "gc":
    case "cat":
    case "type":
      return args.some((arg) => /^env:/i.test(arg));
    case "get-itemproperty":
    case "gp":
    case "get-itempropertyvalue":
      return args.some(
        (arg) =>
          /^(hk[a-z]+:|registry::|hkey_)/i.test(arg) && SENSITIVE_KEY.test(arg),
      );
  }
  if (/^git-credential-/.test(name)) return true;
  return false;
}

const DISK_COMMANDS = words(`
  dd shred wipe srm sdelete sdelete64 mkswap fdisk sfdisk cfdisk gdisk sgdisk
  parted wipefs blkdiscard diskpart format format-volume format-disk
  clear-disk initialize-disk remove-partition
`);
function disk({ name, args }: Command): boolean {
  if (DISK_COMMANDS.has(name) || /^(mkfs|newfs)(\..+|_.+)?$/.test(name))
    return !(args.length > 0 && args.every(isHelp));
  const [first, second] = positionals(args).map((a) => a.toLowerCase());
  switch (name) {
    case "cipher":
      return args.some((arg) => winSwitch(arg)?.name === "w");
    case "diskutil":
      return /^(erase.*|zerodisk|randomdisk|secureerase|partitiondisk|reformat|apfs)$/.test(
        first ?? "",
      );
    case "vssadmin":
    case "wbadmin":
      return first === "delete" || first === "resize";
    case "fsutil":
      return args.some((arg) => /^setzerodata$/i.test(arg));
    case "wmic":
      return first === "shadowcopy" && second === "delete";
  }
  return false;
}

function deletes({ name, args }: Command, context: Context): boolean {
  if (args.some(isHelp) || hasPs(args, "whatif", 2)) return false;
  let bulk = false;
  let filtered = false;
  let targets: string[] = [];
  switch (name) {
    case "rm":
      bulk =
        hasShort(args, "rRf") ||
        hasLong(args, "recursive", "force", "no-preserve-root") ||
        hasPs(args, "recurse") ||
        hasPs(args, "force", 2);
      targets = positionals(args);
      break;
    case "rimraf":
    case "del-cli":
    case "trash":
      bulk = true;
      targets = positionals(args);
      break;
    case "remove-item":
    case "ri":
      bulk = hasPs(args, "recurse");
      targets = psTargets(args);
      break;
    case "rmdir":
    case "rd":
      bulk = hasSwitch(args, "s") || hasPs(args, "recurse");
      targets = psTargets(args);
      break;
    case "del":
    case "erase":
      bulk = hasSwitch(args, "s", "q") || hasPs(args, "recurse");
      targets = psTargets(args);
      break;
    case "find": {
      bulk = args.includes("-delete");
      const expression = args.findIndex((a) => /^[-(!]/.test(a));
      targets = args.slice(0, expression === -1 ? undefined : expression);
      if (targets.length === 0) targets = ["."];
      // `find . -name '*.log' -delete` deletes matches, not the folder.
      filtered = args.some((a) => /^-i?(name|path|regex|wholename)$/.test(a));
      break;
    }
    case "robocopy":
      bulk = hasSwitch(args, "mir", "purge");
      targets = positionals(args).slice(1, 2);
      break;
    case "rsync":
      bulk = hasLong(
        args,
        "delete",
        "delete-before",
        "delete-after",
        "delete-during",
        "delete-excluded",
        "remove-source-files",
      );
      targets = positionals(args);
      break;
    default:
      return false;
  }
  if (!bulk || targets.length === 0) return false;
  return (
    !context.inRepository ||
    targets.some((target) =>
      pathFacts(target, context).some(
        (fact) => fact.outside || (!filtered && fact.wholeRepository),
      ),
    ) ||
    (!filtered &&
      targets.some((target) => /^(\.|\*|\*\.\*|\.[\\/]\*?|\*\*)$/.test(target)))
  );
}
/** Targets of a cmdlet or cmd.exe command, skipping parameters' values. */
function psTargets(args: readonly string[]): string[] {
  const targets: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (/^-[A-Za-z]+$/.test(arg)) {
      if (/^-(path|literalpath|lp|pspath|filter|include|exclude)$/i.test(arg))
        targets.push(args[++i] ?? "");
      continue;
    }
    if (arg.startsWith("-")) continue;
    const parsed = winSwitch(arg);
    if (parsed && !POSIX_ROOTS.has(parsed.name)) continue;
    targets.push(arg);
  }
  return targets;
}

const UPLOAD_METHODS = /^(post|put|patch)$/i;
const CURL_VALUE = "AbcCdDeEFHKmoQrTuUwxXyYz";
function sends({ name, args }: Command): boolean {
  switch (name) {
    case "curl":
      return (
        hasShort(args, "dFT", CURL_VALUE) ||
        hasLong(
          args,
          "data",
          "data-binary",
          "data-raw",
          "data-ascii",
          "data-urlencode",
          "form",
          "form-string",
          "upload-file",
          "json",
        ) ||
        curlMethods(args).some((m) => UPLOAD_METHODS.test(m))
      );
    case "wget":
      return (
        hasLong(args, "post-data", "post-file", "body-data", "body-file") ||
        args.some(
          (arg, i) =>
            long(arg, "method") &&
            UPLOAD_METHODS.test(
              arg.includes("=") ? arg.split("=")[1]! : (args[i + 1] ?? ""),
            ),
        )
      );
    case "invoke-webrequest":
    case "iwr":
    case "invoke-restmethod":
    case "irm":
      return (
        psValues(args, "method", 2).some((m) => UPLOAD_METHODS.test(m)) ||
        hasPs(args, "infile", 3) ||
        hasPs(args, "body", 1) ||
        hasPs(args, "form", 2)
      );
    case "scp":
    case "sftp":
    case "ssh":
    case "slogin":
    case "plink":
    case "pscp":
    case "psftp":
    case "nc":
    case "ncat":
    case "netcat":
    case "socat":
    case "telnet":
    case "ftp":
    case "tftp":
    case "send-mailmessage":
    case "enter-pssession":
    case "etsn":
    case "new-pssession":
    case "nsn":
      return !(args.length > 0 && args.every(isHelp));
    case "invoke-command":
    case "icm":
      return [
        "computername",
        "cn",
        "hostname",
        "session",
        "connectionuri",
        "vmname",
        "vmid",
        "containerid",
      ].some((p) => hasPs(args, p, 2));
    case "rsync":
      return positionals(args).some(isRemote);
    case "git": {
      const sub = gitSubcommand(args);
      if (sub?.name !== "push") return false;
      const remote = positionals(sub.args)[0];
      return remote !== undefined && (isUrl(remote) || isRemote(remote));
    }
  }
  return false;
}
function curlMethods(args: readonly string[]): string[] {
  const methods: string[] = [];
  args.forEach((arg, i) => {
    if (arg === "--request" || arg === "-X") methods.push(args[i + 1] ?? "");
    else if (arg.startsWith("--request=")) methods.push(arg.slice(10));
    else {
      const flags = shortFlags(arg, CURL_VALUE);
      if (flags.endsWith("X")) {
        const rest = arg.slice(1 + flags.length);
        methods.push(rest || (args[i + 1] ?? ""));
      }
    }
  });
  return methods;
}
/** `host:path`, `user@host:path`, `host::module` or `rsync://`, never `C:`. */
function isRemote(arg: string): boolean {
  return (
    /^rsync:\/\//i.test(arg) || /^(?:[^@\s\\/:]+@)?[^@\s\\/:]{2,}::?/.test(arg)
  );
}

function installs({ name, args }: Command): boolean {
  const [first, second] = positionals(args).map((a) => a.toLowerCase());
  const remoteSpec = (arg: string) =>
    isUrl(arg) || /^(git\+|github:|gitlab:|bitbucket:|gist:)/i.test(arg);
  switch (name) {
    case "npm":
    case "pnpm":
    case "bun":
      return (
        [
          "i",
          "install",
          "add",
          "update",
          "up",
          "upgrade",
          "link",
          "ln",
        ].includes(first ?? "") &&
        (hasShort(args, "g") ||
          hasLong(args, "global") ||
          args.includes("--location=global") ||
          positionals(args).slice(1).some(remoteSpec))
      );
    case "yarn":
      return (
        (first === "global" && second === "add") ||
        (first === "add" && positionals(args).slice(1).some(remoteSpec))
      );
    case "uv":
      return first === "pip" && pipInstallsRemote(args.slice(1));
    case "pipx":
      return first === "install" && positionals(args).slice(1).some(remoteSpec);
    case "cargo":
      return first === "install" && hasLong(args, "git");
    case "winget":
    case "choco":
    case "scoop":
    case "brew":
    case "port":
    case "apt":
    case "apt-get":
    case "dnf":
    case "yum":
    case "zypper":
    case "pacman":
    case "apk":
    case "snap":
    case "flatpak":
      return (
        ["install", "reinstall", "upgrade", "add"].includes(
          positionals(args)[0]?.toLowerCase() ?? "",
        ) ||
        (name === "pacman" && args.some((a) => /^-S/.test(a)))
      );
    case "msiexec":
      return hasSwitch(args, "i", "package", "a", "j", "update", "p");
    case "install-module":
    case "install-package":
    case "install-script":
    case "add-appxpackage":
      return true;
  }
  if (/^pip\d*(\.\d+)*$/.test(name)) return pipInstallsRemote(args);
  if (/^(python|pythonw|py)(\d+(\.\d+)*)?$/.test(name)) {
    const module = args.indexOf("-m");
    return (
      module !== -1 &&
      /^pip\d*(\.\d+)*$/.test(args[module + 1] ?? "") &&
      pipInstallsRemote(args.slice(module + 2))
    );
  }
  return false;
}
function pipInstallsRemote(args: readonly string[]): boolean {
  if (positionals(args)[0]?.toLowerCase() !== "install") return false;
  return args.some(
    (arg) =>
      isUrl(arg) ||
      /^git\+/i.test(arg) ||
      / @ /.test(arg) ||
      ["-i", "-f"].includes(arg) ||
      long(arg, "index-url", "extra-index-url", "find-links", "trusted-host"),
  );
}

const SYSTEM_COMMANDS = words(`
  shutdown reboot halt poweroff stop-computer restart-computer bcdedit bootcfg
  set-mppreference add-mppreference remove-mppreference useradd userdel
  usermod groupadd groupdel passwd chpasswd visudo sysadminctl new-localuser
  remove-localuser set-localuser add-localgroupmember setx
  set-executionpolicy csrutil regedit new-service set-service remove-service
  register-scheduledtask unregister-scheduledtask disable-computerrestore
`);
/** Commands that change an item, including in the registry or `Env:`. */
const ITEM_WRITES = words(`
  remove-item ri del erase rm set-item si new-item ni clear-item cli
  rename-item rni move-item mi copy-item cpi set-itemproperty sp
  new-itemproperty remove-itemproperty rp rename-itemproperty
  clear-itemproperty
`);
function system({ name, args }: Command): boolean {
  const [first, second] = positionals(args).map((a) => a.toLowerCase());
  const plain = !(args.length > 0 && args.every(isHelp));
  if (SYSTEM_COMMANDS.has(name)) return plain;
  if (
    ITEM_WRITES.has(name) &&
    args.some((arg) => /^(hk[a-z]+:|registry::|hkey_|env:)/i.test(arg))
  )
    return true;
  switch (name) {
    case "reg":
      return /^(add|delete|import|load|unload|restore|copy)$/.test(first ?? "");
    case "net":
    case "net1":
      return (
        ["user", "localgroup", "group", "accounts"].includes(first ?? "") &&
        (hasSwitch(
          args,
          "add",
          "delete",
          "del",
          "active",
          "passwordreq",
          "times",
          "expires",
        ) ||
          positionals(args).length > 2)
      );
    case "schtasks":
      return hasSwitch(args, "create", "change", "delete", "run");
    case "sc":
      return /^(create|config|delete|failure|stop|privs|sidtype)$/.test(
        first ?? "",
      );
    case "netsh":
      return args.some((a) => /^(set|add|delete|reset)$/i.test(a));
    case "systemctl":
      return /^(poweroff|reboot|halt|kexec|suspend|hibernate|enable|disable|mask|stop|kill|isolate|set-default|edit)$/.test(
        first ?? "",
      );
    case "init":
    case "telinit":
      return first === "0" || first === "6";
    case "crontab":
      return !args.some((a) => a === "-l") && plain;
    case "launchctl":
      return /^(load|bootstrap|submit|unload|remove|bootout|enable|disable|setenv)$/.test(
        first ?? "",
      );
    case "dscl":
      return args.some((a) =>
        /^-(create|delete|passwd|append|merge|change)$/.test(a),
      );
    case "spctl":
      return hasLong(
        args,
        "master-disable",
        "global-disable",
        "disable",
        "add",
      );
    case "defaults":
      return first === "write" && /^\/(library|system)/i.test(second ?? "");
  }
  return false;
}

/**
 * A command that runs another command it is given: its rule, and the inner
 * command when the rule table can read it, to name a more precise rule.
 */
function wrapper(
  command: Command,
): { rule: "elevate" | "launch"; inner?: Command } | undefined {
  const { name, args } = command;
  const after = (start: number, valueOptions: string[] = []) => {
    let i = start;
    while (i < args.length) {
      const arg = args[i]!;
      if (arg === "--") {
        i++;
        break;
      }
      if (!arg.startsWith("-")) break;
      i += valueOptions.includes(arg) ? 2 : 1;
    }
    return i;
  };
  const innerAt = (index: number): Command | undefined =>
    index < args.length
      ? { name: commandName(args[index]!), args: args.slice(index + 1) }
      : undefined;
  switch (name) {
    case "sudo":
      return {
        rule: "elevate",
        inner: innerAt(
          after(0, [
            "-u",
            "-g",
            "-C",
            "-h",
            "-p",
            "-r",
            "-t",
            "-U",
            "-D",
            "-R",
          ]),
        ),
      };
    case "doas":
      return { rule: "elevate", inner: innerAt(after(0, ["-u", "-C"])) };
    case "pkexec":
    case "gsudo":
      return { rule: "elevate", inner: innerAt(after(0, ["--user", "-u"])) };
    case "su":
    case "runas":
      return { rule: "elevate" };
    case "env": {
      let i = after(0, [
        "-u",
        "-C",
        "-S",
        "--unset",
        "--chdir",
        "--split-string",
      ]);
      if (args.some((a) => a === "-S" || long(a, "split-string")))
        return { rule: "launch" };
      while (i < args.length && args[i]!.includes("=")) i++;
      return i < args.length
        ? { rule: "launch", inner: innerAt(i) }
        : undefined;
    }
    case "nohup":
    case "setsid":
    case "time":
      return { rule: "launch", inner: innerAt(after(0, ["-o", "-f"])) };
    case "nice":
    case "ionice":
    case "stdbuf":
    case "chrt":
    case "taskset":
      return {
        rule: "launch",
        inner: innerAt(after(0, ["-n", "-c", "-p", "-i", "-o", "-e"])),
      };
    case "timeout": {
      const start = after(0, ["-s", "-k", "--signal", "--kill-after"]);
      return { rule: "launch", inner: innerAt(start + 1) };
    }
    case "chroot":
      return { rule: "launch", inner: innerAt(after(0) + 1) };
    case "xargs":
    case "parallel":
    case "watch":
    case "entr":
      return { rule: "launch" };
    case "find": {
      const exec = args.findIndex((a) => /^-(exec|execdir|ok|okdir)$/.test(a));
      if (exec === -1) return undefined;
      const end = args.findIndex(
        (a, i) => i > exec && (a === ";" || a === "+"),
      );
      const inner = innerAt(exec + 1);
      return {
        rule: "launch",
        inner: inner && {
          name: inner.name,
          args: args.slice(exec + 2, end === -1 ? undefined : end),
        },
      };
    }
  }
  return undefined;
}

/** Git settings whose value is a command git runs, or that let one run. */
const GIT_LAUNCH_KEYS = [
  /^core\.(sshcommand|pager|editor|fsmonitor|hookspath|gitproxy|askpass)$/,
  /^(sequence\.editor|diff\.external|credential\.helper|ssh\.variant)$/,
  /^(diff\..+\.(textconv|command)|(difftool|mergetool)\..+\.cmd)$/,
  /^(merge\..+\.driver|filter\..+\.(clean|smudge|process))$/,
  /^(credential\..+\.helper|uploadpack\.packobjectshook)$/,
  /^(protocol\.(.+\.)?allow|remote\..+\.(uploadpack|receivepack))$/,
  /^(gpg\.(.+\.)?program|include\.path|includeif\..+\.path|pager\..+)$/,
  /^(web\.browser|(browser|man)\..+\.(cmd|path)|sendemail\..+)$/,
];
function gitLaunchSetting(key: string, value: string | undefined): boolean {
  const name = key.toLowerCase();
  if (name.startsWith("alias."))
    return (value ?? "").trimStart().startsWith("!");
  return GIT_LAUNCH_KEYS.some((pattern) => pattern.test(name));
}

function launches({ name, args }: Command): boolean {
  const [first] = positionals(args).map((a) => a.toLowerCase());
  switch (name) {
    case "npx":
    case "pnpx":
    case "bunx":
    case "start-process":
    case "saps":
    case "invoke-item":
    case "ii":
    case "open":
    case "xdg-open":
    case "forfiles":
    case "pcalua":
    case "script":
      return !(args.length > 0 && args.every(isHelp));
    case "npm":
      return (
        ["exec", "x", "explore", "create", "init"].includes(first ?? "") &&
        (first !== "init" || positionals(args).length > 1)
      );
    case "pnpm":
    case "yarn":
      return ["dlx", "exec", "create"].includes(first ?? "");
    case "bun":
      return first === "x" || first === "create";
    case "wmic":
      return args.some((a) => /^create$/i.test(a));
    case "git":
      return gitLaunches(args);
  }
  return false;
}
function gitLaunches(args: readonly string[]): boolean {
  if (args.some((a) => /^ext::/i.test(a))) return true;
  const sub = gitSubcommand(args);
  for (const setting of sub?.settings ?? []) {
    const equals = setting.indexOf("=");
    const key = equals === -1 ? setting : setting.slice(0, equals);
    if (
      gitLaunchSetting(
        key,
        equals === -1 ? undefined : setting.slice(equals + 1),
      )
    )
      return true;
  }
  if (!sub) return false;
  const rest = sub.args;
  if (
    rest.some((a) =>
      long(a, "upload-pack", "receive-pack", "exec", "extcmd"),
    ) ||
    (["fetch", "clone", "pull", "ls-remote", "archive"].includes(sub.name) &&
      rest.includes("-u"))
  )
    return true;
  const [first] = positionals(rest);
  switch (sub.name) {
    case "config": {
      const keys = positionals(rest);
      const offset = ["set", "get", "unset", "add", "replace-all"].includes(
        keys[0] ?? "",
      )
        ? 1
        : 0;
      const key = keys[offset];
      return (
        key !== undefined &&
        !rest.some((a) =>
          /^--(get|get-all|get-regexp|list|unset|unset-all)$/.test(a),
        ) &&
        gitLaunchSetting(key, keys[offset + 1])
      );
    }
    case "submodule":
      return first === "foreach";
    case "bisect":
      return first === "run";
    case "rebase":
      return rest.includes("-x") || hasLong(rest, "exec");
    case "difftool":
    case "mergetool":
      return rest.includes("-x") || hasLong(rest, "extcmd", "tool");
    case "filter-branch":
      return true;
  }
  return false;
}

/** Git's subcommand after its global options, with every `-c` setting. */
function gitSubcommand(
  args: readonly string[],
): { name: string; args: readonly string[]; settings: string[] } | undefined {
  const settings: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === "-c" || arg === "--config-env") {
      settings.push(args[++i] ?? "");
      continue;
    }
    if (arg.startsWith("-c") && arg.length > 2) {
      settings.push(arg.slice(2));
      continue;
    }
    if (
      [
        "-C",
        "--git-dir",
        "--work-tree",
        "--namespace",
        "--exec-path",
        "--super-prefix",
      ].includes(arg)
    ) {
      i++;
      continue;
    }
    if (arg.startsWith("-")) continue;
    return { name: arg.toLowerCase(), args: args.slice(i + 1), settings };
  }
  return settings.length ? { name: "", args: [], settings } : undefined;
}

// ---------------------------------------------------------------- review

function reviewRule({ name, args }: Command): ProcessRuleId | undefined {
  switch (name) {
    case "curl":
    case "wget":
    case "aria2c":
    case "http":
    case "xh":
      return positionals(args).length > 0 || hasLong(args, "url")
        ? "download"
        : undefined;
    case "invoke-webrequest":
    case "iwr":
    case "invoke-restmethod":
    case "irm":
    case "start-bitstransfer":
      return "download";
    case "certutil":
      return args.some((a) => /^[-/](urlcache|verifyctl)$/i.test(a))
        ? "download"
        : undefined;
    case "bitsadmin":
      return hasSwitch(args, "transfer", "addfile") ? "download" : undefined;
    case "git":
      return gitReview(args);
  }
  return undefined;
}
function gitReview(args: readonly string[]): ProcessRuleId | undefined {
  const sub = gitSubcommand(args);
  if (!sub) return undefined;
  const rest = sub.args;
  switch (sub.name) {
    case "push":
      return hasLong(
        rest,
        "force",
        "force-with-lease",
        "force-if-includes",
        "mirror",
      ) ||
        hasShort(rest, "f") ||
        positionals(rest).some((a) => a.startsWith("+"))
        ? "git-force-push"
        : undefined;
    case "reset":
      return rest.includes("--hard") ? "git-discard" : undefined;
    case "clean":
      return (hasShort(rest, "f") || hasLong(rest, "force")) &&
        !hasShort(rest, "n") &&
        !hasLong(rest, "dry-run")
        ? "git-discard"
        : undefined;
    case "checkout": {
      const dashes = rest.indexOf("--");
      const paths = dashes === -1 ? positionals(rest) : rest.slice(dashes + 1);
      return hasShort(rest, "f") ||
        hasLong(rest, "force") ||
        paths.some((p) => /^(\.|:\/|\*|\.[\\/])$/.test(p))
        ? "git-discard"
        : undefined;
    }
    case "restore": {
      const stagedOnly =
        (rest.includes("--staged") || hasShort(rest, "S")) &&
        !rest.includes("--worktree") &&
        !hasShort(rest, "W");
      return !stagedOnly &&
        positionals(rest).some((p) => /^(\.|:\/|\*|\.[\\/])$/.test(p))
        ? "git-discard"
        : undefined;
    }
    case "branch":
      return rest.includes("-D") ||
        ((hasShort(rest, "d") || hasLong(rest, "delete")) &&
          (hasShort(rest, "f") || hasLong(rest, "force")))
        ? "git-branch-delete"
        : undefined;
  }
  return undefined;
}
