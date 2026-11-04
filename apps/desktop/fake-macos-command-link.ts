import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { createMacosCommandLink } = require("./electron/cli-path.cjs");

/** Only models the fixed macOS command path; it never accesses the host. */
export function macosLinkFixture({
  target = null as string | null,
  foreignFile = false,
  writable = true,
  cancelled = false,
  beforeCreate = () => {},
  beforeExec = () => {},
  afterRead = () => {},
} = {}) {
  const escaped: string[] = [];
  const calls: Array<{ file: string; args: string[] }> = [];
  const fs = {
    lstat: async () => {
      if (target === null && !foreignFile)
        throw Object.assign(new Error(), { code: "ENOENT" });
      return { isSymbolicLink: () => !foreignFile };
    },
    readlink: async () => {
      const observed = target;
      afterRead();
      if (observed === null)
        throw Object.assign(new Error(), { code: "ENOENT" });
      return observed;
    },
    access: async () => {
      if (!writable) throw Object.assign(new Error(), { code: "EACCES" });
    },
  };
  const exec = async (file: string, args: string[]) => {
    calls.push({ file, args });
    beforeExec();
    if (cancelled) throw new Error("User canceled. (-128)");
    const quote = (value: string) =>
      "'" + value.replaceAll("'", "'\"'\"'") + "'";
    const create = (source: string, noFollow: boolean) => {
      beforeCreate();
      if (target !== null || foreignFile) {
        if (noFollow) throw new Error("File exists");
        // Plain BSD ln writes inside a destination directory link.
        escaped.push(`${target}/ajour`);
      } else target = source;
    };
    if (file === "/bin/ln") create(args[args.length - 2]!, args.includes("-n"));
    else if (file === "/bin/rm") target = null;
    else if (file === "/usr/bin/osascript" || file === "/bin/sh") {
      const shell: string =
        file === "/bin/sh"
          ? args[1]!
          : JSON.parse(
              args[1]!.slice(
                "do shell script ".length,
                -" with administrator privileges".length,
              ),
            );
      if (shell.includes("/bin/rm")) {
        if (target !== null && shell.includes(`= ${quote(target)} ]`))
          target = null;
      }
      const ln = shell.match(
        /\/bin\/ln '-s' ('-n' )?(.+) '\/usr\/local\/bin\/ajour'/,
      );
      if (ln)
        create(ln[2]!.slice(1, -1).replaceAll("'\"'\"'", "'"), Boolean(ln[1]));
    }
    return { stdout: "" };
  };
  return {
    link: () => createMacosCommandLink({ fs, exec }),
    calls,
    escaped,
    current: () => target,
    fs,
    exec,
    replace: (value: string) => {
      target = value;
    },
  };
}
