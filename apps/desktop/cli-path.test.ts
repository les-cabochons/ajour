import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { macosLinkFixture as fixture } from "./fake-macos-command-link.ts";
import { recordingEvents } from "./recording-events.ts";

/*
 * The Windows user Path for the ajour command (#568, spec #567). Ajour reads
 * the raw `Path` of HKCU\Environment, appends its folder only when absent,
 * and writes it back as REG_EXPAND_SZ. These tests use a fake registry and
 * a fake PowerShell: nothing here reads or writes the real one. The
 * real-app check, scripts/check-cli-command.mjs, proves the real one.
 */

const require = createRequire(import.meta.url);

type Kind = "ExpandString" | "String";
interface RegistryValue {
  value: string | null;
  kind: Kind | null;
}
interface Registry {
  read(): Promise<RegistryValue>;
  write(change: {
    expected: string | null;
    expectedKind: Kind | null;
    value: string | null;
    kind: Kind | null;
  }): Promise<boolean>;
  broadcast(): Promise<void>;
}
const {
  createWindowsUserPath,
  createPowerShellRegistry,
  checkPathRestoration,
} = require("./electron/cli-path.cjs") as {
  checkPathRestoration(
    current: RegistryValue | null,
    saved: RegistryValue | null,
    written: string,
    folder: string,
  ): RegistryValue | null;
  createWindowsUserPath: (options: {
    registry: Registry;
    env?: Record<string, string | undefined>;
    events?: unknown;
  }) => {
    add(folder: string): Promise<{ added: boolean }>;
    remove(folder: string): Promise<unknown>;
  };
  createPowerShellRegistry: (options: {
    run: (
      file: string,
      args: string[],
      env: Record<string, string | undefined>,
    ) => Promise<string>;
    env?: Record<string, string | undefined>;
  }) => Registry;
};

const FOLDER = "C:\\Users\\alex\\AppData\\Local\\Ajour\\bin";
const ENV = { LOCALAPPDATA: "C:\\Users\\alex\\AppData\\Local" };

/**
 * A user Path that holds `value` with `kind`, and records each write and
 * broadcast. `failWrite` writes, then throws, as a PowerShell that ends
 * after it set the value does; `failBroadcast` throws on the broadcast.
 */
function fakeRegistry(
  initial: RegistryValue,
  { failWrite = 0, failBroadcast = 0 } = {},
) {
  let current = { ...initial };
  let writesLeftToFail = failWrite;
  let broadcastsLeftToFail = failBroadcast;
  const writes: RegistryValue[] = [];
  const broadcasts: number[] = [];
  const registry: Registry & { changeTo(value: string): void } = {
    async read() {
      return { ...current };
    },
    async write({ expected, expectedKind, value, kind }) {
      // As the PowerShell write does: refuse when the Path changed since.
      if (current.value !== expected || current.kind !== expectedKind)
        return false;
      current = value === null ? { value: null, kind: null } : { value, kind };
      writes.push({ ...current });
      if (writesLeftToFail > 0) {
        writesLeftToFail -= 1;
        throw new Error("PowerShell exited with 1.");
      }
      return true;
    },
    async broadcast() {
      if (broadcastsLeftToFail > 0) {
        broadcastsLeftToFail -= 1;
        throw new Error("Add-Type failed.");
      }
      broadcasts.push(writes.length);
    },
    changeTo(value: string) {
      current = { value, kind: current.kind ?? "ExpandString" };
    },
  };
  return { registry, writes, broadcasts, current: () => current };
}

describe("the Windows user Path", () => {
  it("appends the folder, keeping every other entry as it was", async () => {
    const fake = fakeRegistry({
      value: "C:\\Tools;%USERPROFILE%\\bin",
      kind: "ExpandString",
    });
    const userPath = createWindowsUserPath({
      registry: fake.registry,
      env: ENV,
    });

    expect((await userPath.add(FOLDER)).added).toBe(true);

    expect(fake.broadcasts).toEqual([1]);
    expect(fake.writes).toEqual([
      {
        value: `C:\\Tools;%USERPROFILE%\\bin;${FOLDER}`,
        kind: "ExpandString",
      },
    ]);
  });

  it("keeps %VARS% unexpanded and REG_EXPAND_SZ", async () => {
    const fake = fakeRegistry({
      value: "%LOCALAPPDATA%\\Microsoft\\WindowsApps;",
      kind: "ExpandString",
    });
    await createWindowsUserPath({ registry: fake.registry, env: ENV }).add(
      FOLDER,
    );

    expect(fake.current()).toEqual({
      value: `%LOCALAPPDATA%\\Microsoft\\WindowsApps;${FOLDER}`,
      kind: "ExpandString",
    });
  });

  it("creates the Path with the folder alone when the user has none", async () => {
    const fake = fakeRegistry({ value: null, kind: null });
    await createWindowsUserPath({ registry: fake.registry, env: ENV }).add(
      FOLDER,
    );

    expect(fake.current()).toEqual({ value: FOLDER, kind: "ExpandString" });
  });

  it("preserves a REG_SZ Path", async () => {
    const fake = fakeRegistry({ value: "C:\\Tools", kind: "String" });
    await createWindowsUserPath({ registry: fake.registry, env: ENV }).add(
      FOLDER,
    );

    expect(fake.current()).toEqual({
      value: `C:\\Tools;${FOLDER}`,
      kind: "String",
    });
  });

  it.each([
    ["the same folder", FOLDER],
    ["another case and a trailing backslash", `${FOLDER.toUpperCase()}\\`],
    ["the folder through %LOCALAPPDATA%", "%LOCALAPPDATA%\\Ajour\\bin"],
    ["the folder in quotes", `"${FOLDER}"`],
  ])("leaves a Path that already holds %s unchanged", async (_name, entry) => {
    const fake = fakeRegistry({
      value: `C:\\Tools;${entry};D:\\bin`,
      kind: "ExpandString",
    });
    const userPath = createWindowsUserPath({
      registry: fake.registry,
      env: ENV,
    });

    expect(await userPath.add(FOLDER)).toEqual({
      added: false,
    });
    expect(fake.writes).toEqual([]);
  });

  it("adds the entry once over two installs", async () => {
    const fake = fakeRegistry({ value: "C:\\Tools", kind: "ExpandString" });
    const userPath = createWindowsUserPath({
      registry: fake.registry,
      env: ENV,
    });

    await userPath.add(FOLDER);
    await userPath.add(FOLDER);

    expect(fake.writes).toHaveLength(1);
    expect(fake.current().value).toBe(`C:\\Tools;${FOLDER}`);
  });

  it("reads again and keeps the new entry when the Path changed meanwhile", async () => {
    const fake = fakeRegistry({ value: "C:\\Tools", kind: "ExpandString" });
    const read = fake.registry.read;
    let reads = 0;
    fake.registry.read = async () => {
      const value = await read();
      // Another program adds an entry after Ajour's first read.
      if (++reads === 1) fake.registry.changeTo("C:\\Tools;C:\\Other");
      return value;
    };

    await createWindowsUserPath({ registry: fake.registry, env: ENV }).add(
      FOLDER,
    );

    expect(fake.current().value).toBe(`C:\\Tools;C:\\Other;${FOLDER}`);
  });

  it("refuses when the Path keeps changing under it", async () => {
    const fake = fakeRegistry({ value: "C:\\Tools", kind: "ExpandString" });
    const read = fake.registry.read;
    let reads = 0;
    fake.registry.read = async () => {
      const value = await read();
      fake.registry.changeTo(`C:\\Tools;C:\\Other${++reads}`);
      return value;
    };

    await expect(
      createWindowsUserPath({ registry: fake.registry, env: ENV }).add(FOLDER),
    ).rejects.toThrow("Your PATH kept changing while Ajour edited it.");
    expect(fake.writes).toEqual([]);
  });
});

describe("reconciling the Windows user Path", () => {
  it("removes only the exact folder entry and preserves other programs' changes and the type", async () => {
    const fake = fakeRegistry({
      value: `C:\\Tools;${FOLDER};C:\\Other;`,
      kind: "String",
    });
    await createWindowsUserPath({ registry: fake.registry }).remove(FOLDER);
    expect(fake.current()).toEqual({
      value: "C:\\Tools;C:\\Other;",
      kind: "String",
    });
  });
  it("treats a failed broadcast as success", async () => {
    const fake = fakeRegistry(
      { value: "C:\\Tools", kind: "String" },
      { failBroadcast: 1 },
    );
    const { events, recorded } = recordingEvents();
    await expect(
      createWindowsUserPath({ registry: fake.registry, events }).add(FOLDER),
    ).resolves.toEqual({ added: true });
    expect(
      recorded.filter((event) => event.name === "cli_command.path_broadcast"),
    ).toMatchObject([{ outcome: "error" }]);
    expect(fake.current().value).toBe(`C:\\Tools;${FOLDER}`);
  });
  it("does not undo another writer's entry after a rejected conditional write", async () => {
    const fake = fakeRegistry({ value: "C:\\Tools", kind: "String" });
    fake.registry.write = async () => {
      fake.registry.changeTo(`C:\\Tools;${FOLDER};C:\\Other`);
      return false;
    };
    const userPath = createWindowsUserPath({ registry: fake.registry });
    await userPath.add(FOLDER);
    expect(fake.current().value).toBe(`C:\\Tools;${FOLDER};C:\\Other`);
  });
});

describe("the PowerShell registry", () => {
  const SYSTEM_ROOT = "D:\\Windows";
  const POWERSHELL =
    "D:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe";
  const b64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

  function fakeRun(answer: string) {
    const calls: Array<{
      file: string;
      args: string[];
      env: Record<string, string | undefined>;
    }> = [];
    const run = async (
      file: string,
      args: string[],
      env: Record<string, string | undefined>,
    ) => {
      calls.push({ file, args, env });
      return answer;
    };
    return { run, calls };
  }

  it("runs PowerShell by its absolute path, without a profile or prompts", async () => {
    const fake = fakeRun(
      JSON.stringify({ kind: "ExpandString", value: b64("C:\\Tools") }),
    );
    const registry = createPowerShellRegistry({
      run: fake.run,
      env: { SystemRoot: SYSTEM_ROOT },
    });

    await registry.read();

    expect(fake.calls[0]!.file).toBe(POWERSHELL);
    expect(fake.calls[0]!.args.slice(0, 2)).toEqual([
      "-NoProfile",
      "-NonInteractive",
    ]);
    // The script reads the value raw, never expanded.
    expect(fake.calls[0]!.args.join(" ")).toContain(
      "DoNotExpandEnvironmentNames",
    );
  });

  it("reads the raw value and its kind, in any language", async () => {
    const raw = "%USERPROFILE%\\outils;C:\\Program Files\\Ünïcode";
    const fake = fakeRun(
      JSON.stringify({ kind: "ExpandString", value: b64(raw) }),
    );
    const registry = createPowerShellRegistry({ run: fake.run, env: {} });

    expect(await registry.read()).toEqual({ value: raw, kind: "ExpandString" });
  });

  it("reads a missing Path as none", async () => {
    const fake = fakeRun(JSON.stringify({ kind: "", value: null }));
    const registry = createPowerShellRegistry({ run: fake.run, env: {} });

    expect(await registry.read()).toEqual({ value: null, kind: null });
  });

  it("passes the values through the environment, never inside the script", async () => {
    const fake = fakeRun("written");
    const registry = createPowerShellRegistry({
      run: fake.run,
      env: { SystemRoot: SYSTEM_ROOT },
    });
    const value = `C:\\Tools;'; Remove-Item C:\\ -Recurse; '`;

    expect(
      await registry.write({
        expected: "C:\\Tools",
        expectedKind: "String",
        value,
        kind: "ExpandString",
      }),
    ).toBe(true);

    const [call] = fake.calls;
    expect(call!.args.join(" ")).not.toContain("Remove-Item");
    expect(call!.env.AJOUR_PATH_EXPECTED).toBe(`v${b64("C:\\Tools")}`);
    expect(call!.env.AJOUR_PATH_EXPECTED_KIND).toBe("String");
    expect(call!.args.join(" ")).toContain(
      "$currentKind -cne $env:AJOUR_PATH_EXPECTED_KIND",
    );
    expect(call!.env.AJOUR_PATH_VALUE).toBe(`v${b64(value)}`);
    expect(call!.env.AJOUR_PATH_KIND).toBe("ExpandString");
    expect(call!.env.SystemRoot).toBe(SYSTEM_ROOT);
  });

  it("sets an empty expected value, which Windows would otherwise drop", async () => {
    const fake = fakeRun("written");
    const registry = createPowerShellRegistry({ run: fake.run, env: {} });

    await registry.write({
      expected: "",
      expectedKind: "String",
      value: "C:\\bin",
      kind: "ExpandString",
    });

    expect(fake.calls[0]!.env.AJOUR_PATH_EXPECTED).toBe("v");
  });

  it("says when the Path changed before the write", async () => {
    const fake = fakeRun("changed");
    const registry = createPowerShellRegistry({ run: fake.run, env: {} });

    expect(
      await registry.write({
        expected: null,
        expectedKind: null,
        value: "C:\\bin",
        kind: "ExpandString",
      }),
    ).toBe(false);
    expect(fake.calls[0]!.env.AJOUR_PATH_EXPECTED).toBe("-");
  });

  it("writes a REG_SZ value back as REG_SZ", async () => {
    const fake = fakeRun("written");
    const registry = createPowerShellRegistry({ run: fake.run, env: {} });

    await registry.write({
      expected: "C:\\a",
      expectedKind: "String",
      value: "C:\\b",
      kind: "String",
    });

    expect(fake.calls[0]!.env.AJOUR_PATH_KIND).toBe("String");
  });

  it("deletes the Path for a null value", async () => {
    const fake = fakeRun("written");
    const registry = createPowerShellRegistry({ run: fake.run, env: {} });

    await registry.write({
      expected: "C:\\bin",
      expectedKind: "String",
      value: null,
      kind: null,
    });

    expect(fake.calls[0]!.env.AJOUR_PATH_VALUE).toBe("-");
    expect(fake.calls[0]!.args.join(" ")).toContain("DeleteValue");
  });

  it('passes a missing Path\'s kind as "-", which PowerShell can compare', async () => {
    const fake = fakeRun("written");
    const registry = createPowerShellRegistry({ run: fake.run, env: {} });

    await registry.write({
      expected: null,
      expectedKind: null,
      value: "C:\\bin",
      kind: "ExpandString",
    });

    expect(fake.calls[0]!.env.AJOUR_PATH_EXPECTED_KIND).toBe("-");
  });

  it.skipIf(process.platform !== "win32")(
    "writes a first Path through real PowerShell, in a scratch key",
    async () => {
      const fake = fakeRun("written");
      await createPowerShellRegistry({
        run: fake.run,
        env: { SystemRoot: process.env.SystemRoot },
      }).write({
        expected: null,
        expectedKind: null,
        value: "C:\\bin",
        kind: "ExpandString",
      });
      const [call] = fake.calls;
      // The same script and variables, aimed at a key of the test's own
      // instead of HKCU\Environment.
      const scratch = `Software\\AjourTest-${randomUUID()}`;
      const script = call!.args[3]!.replace(
        "CreateSubKey('Environment')",
        `CreateSubKey('${scratch}')`,
      );
      expect(script).not.toBe(call!.args[3]);
      const run = (args: string[], env: NodeJS.ProcessEnv) =>
        execFileSync(call!.file, args, {
          encoding: "utf8",
          env,
        });
      try {
        expect(
          run([...call!.args.slice(0, 3), script], {
            ...process.env,
            ...call!.env,
          }),
        ).toBe("written");
        expect(
          execFileSync("reg.exe", ["query", `HKCU\\${scratch}`, "/v", "Path"], {
            encoding: "utf8",
          }),
        ).toMatch(/Path\s+REG_EXPAND_SZ\s+C:\\bin$/m);
      } finally {
        execFileSync("reg.exe", ["delete", `HKCU\\${scratch}`, "/f"], {
          stdio: "ignore",
        });
      }
    },
    20_000,
  );

  it("refuses a kind other than REG_SZ or REG_EXPAND_SZ", async () => {
    const fake = fakeRun("written");
    const registry = createPowerShellRegistry({ run: fake.run, env: {} });

    await expect(
      registry.write({
        expected: null,
        expectedKind: null,
        value: "C:\\bin",
        kind: "Binary" as never,
      }),
    ).rejects.toThrow();
    expect(fake.calls).toEqual([]);
  });

  it("broadcasts WM_SETTINGCHANGE in a run of its own", async () => {
    const fake = fakeRun("");
    const registry = createPowerShellRegistry({
      run: fake.run,
      env: { SystemRoot: SYSTEM_ROOT },
    });

    await registry.broadcast();

    expect(fake.calls[0]!.file).toBe(POWERSHELL);
    expect(fake.calls[0]!.args.join(" ")).toContain("WM_SETTINGCHANGE");
    expect(fake.calls[0]!.args.join(" ")).not.toContain("SetValue");
  });
});

describe("the real-app check's leftover PATH backup", () => {
  const saved: RegistryValue = { value: "C:\\Tools;", kind: "String" };
  const written = `C:\\Tools;${FOLDER}`;
  it("restores the exact backup only while the check's write is current", () => {
    expect(
      checkPathRestoration(
        { value: written, kind: "String" },
        saved,
        written,
        FOLDER,
      ),
    ).toEqual(saved);
  });
  it("keeps entries added since and removes only the check's folder", () => {
    expect(
      checkPathRestoration(
        { value: `${written};D:\\Later;`, kind: "String" },
        saved,
        written,
        FOLDER,
      ),
    ).toEqual({ value: "C:\\Tools;D:\\Later;", kind: "String" });
  });
});

describe("type-only changes during check cleanup", () => {
  it("removes only the check entry and keeps the current kind", () => {
    expect(
      checkPathRestoration(
        { value: `C:\\Tools;${FOLDER}`, kind: "String" },
        { value: "C:\\Tools;", kind: "ExpandString" },
        `C:\\Tools;${FOLDER}`,
        FOLDER,
      ),
    ).toEqual({ value: "C:\\Tools", kind: "String" });
  });
});

describe("literal Windows path comparison", () => {
  it.each(["String", "ExpandString"] as const)(
    "normalizes case and trailing backslashes in %s",
    async (kind) => {
      const fake = fakeRegistry({ value: `${FOLDER.toUpperCase()}\\`, kind });
      expect(
        await createWindowsUserPath({ registry: fake.registry, env: ENV }).add(
          FOLDER,
        ),
      ).toEqual({ added: false });
      expect(fake.writes).toEqual([]);
    },
  );
});

describe("macOS command link", () => {
  const { createMacosCommandLink } = require("./electron/cli-path.cjs");
  it("creates an absent link directly without a password", async () => {
    const f = fixture();
    expect(await f.link().add("/Users/alex/Ajour/bin")).toEqual({
      added: true,
    });
    expect(f.calls).toEqual([
      {
        file: "fs.symlink",
        args: ["/Users/alex/Ajour/bin/ajour", "/usr/local/bin/ajour"],
      },
    ]);
  });
  it.each([true, false])(
    "refuses a directory link that appears before creation, writable=%s",
    async (writable) => {
      const f = fixture({
        writable,
        beforeCreate: () => f.replace("/another/directory"),
      });
      await expect(
        f.link().add("/Users/alex/Ajour/bin", { interactive: true }),
      ).rejects.toThrow();
      expect(f.escaped).toEqual([]);
      expect(f.current()).toBe("/another/directory");
    },
  );
  it.each([true, false])(
    "leaves a real directory empty when it appears after inspection, writable=%s",
    async (writable) => {
      const f = fixture({
        writable,
        beforeCreate: () => f.replaceWithDirectory(),
      });
      await expect(
        f.link().add("/Users/alex/Ajour/bin", { interactive: true }),
      ).rejects.toThrow(
        "Ajour couldn't create /usr/local/bin/ajour. Press Retry in Settings.",
      );
      expect(f.escaped).toEqual([]);
      expect((await f.fs.lstat()).isSymbolicLink()).toBe(false);
    },
  );
  it("creates a missing bin without privilege when its parent is writable", async () => {
    const f = fixture({
      directoryMissing: true,
      parentWritable: true,
      writable: false,
    });
    expect(await f.link().add("/Users/alex/bin")).toEqual({ added: true });
    expect(f.calls.map((call) => call.file)).toEqual([
      "fs.mkdir",
      "fs.symlink",
    ]);
  });
  it.each([
    { directoryMissing: true, parentWritable: false },
    { directoryUid: 501 },
    { directoryMode: 0o775 },
    { directoryMode: 0o757 },
    { directorySymlink: true },
  ])(
    "checks the privileged directory before creating entries: %j",
    async (options) => {
      const f = fixture({ writable: false, ...options });
      const result = f.link().add("/Users/alex/bin", { interactive: true });
      if (options.directoryMissing) {
        expect(await result).toEqual({ added: true });
        const shell = JSON.parse(
          f.calls[0]!.args[1]!.slice(
            "do shell script ".length,
            -" with administrator privileges".length,
          ),
        );
        expect(shell).toContain("/bin/mkdir -m 755 '/usr/local/bin'");
        expect(shell).not.toContain("mkdir -p");
        expect(shell).toContain("[ ! -L '/usr/local/bin' ]");
        expect(shell).toContain("/usr/bin/stat -f '%u %Lp'");
      } else {
        await expect(result).rejects.toThrow("Retry");
        expect(f.current()).toBeNull();
      }
    },
  );
  it("refuses a user-owned bin appearing while the password prompt is open", async () => {
    const f = fixture({
      writable: false,
      directoryMissing: true,
      beforeExec: () => f.makeDirectoryUnsafe(),
    });
    await expect(
      f.link().add("/Users/alex/bin", { interactive: true }),
    ).rejects.toThrow("Retry");
    expect(f.current()).toBeNull();
  });
  it("rejects success when the exact link no longer has the intended target", async () => {
    const f = fixture();
    const files = {
      ...f.fs,
      symlink: async (...args: Parameters<typeof f.fs.symlink>) => {
        await f.fs.symlink(...args);
        f.replace("/opt/homebrew/bin/ajour");
      },
    };
    await expect(
      createMacosCommandLink({ fs: files, exec: f.exec }).add(
        "/Users/alex/Ajour/bin",
      ),
    ).rejects.toThrow(
      "Ajour couldn't verify /usr/local/bin/ajour. Press Retry in Settings.",
    );
  });
  it.each([true, false])(
    "preserves a foreign replacement before removal, writable=%s",
    async (writable) => {
      let reads = 0;
      const f = fixture({
        target: "/Users/alex/Ajour/bin/ajour",
        writable,
        afterRead: () => {
          if (++reads === 2) f.replace("/opt/homebrew/bin/ajour");
        },
      });
      await expect(
        f.link().remove("/Users/alex/Ajour/bin", { interactive: true }),
      ).rejects.toThrow("changed during reconciliation");
      expect(f.current()).toBe("/opt/homebrew/bin/ajour");
    },
  );
  it("leaves an owned link alone", async () => {
    const f = fixture({ target: "/Users/alex/Ajour/bin/ajour" });
    expect(await f.link().add("/Users/alex/Ajour/bin")).toEqual({
      added: false,
    });
    expect(f.calls).toEqual([]);
  });
  it.each([
    { foreignFile: true },
    { target: "/opt/homebrew/bin/ajour" },
    { target: "/Users/alex/Ajour/bin-other/ajour" },
  ])("refuses foreign commands %j", async (options) => {
    const f = fixture(options);
    await expect(f.link().add("/Users/alex/Ajour/bin")).rejects.toThrow(
      "Another ajour is at /usr/local/bin/ajour. Remove it, then install again.",
    );
    await f.link().remove("/Users/alex/Ajour/bin");
    expect(f.calls).toEqual([]);
  });
  it("quotes shell paths and the AppleScript string independently", async () => {
    const f = fixture({ writable: false });
    await f.link().add(`/Users/A "B"/it's\\$home/bin`, { interactive: true });
    expect(f.calls[0]!.file).toBe("/usr/bin/osascript");
    const script = f.calls[0]!.args[1]!;
    expect(script).toContain("with administrator privileges");
    // Decode only the AppleScript string. Shell quoting must survive unchanged.
    const shell = JSON.parse(
      script.slice(
        "do shell script ".length,
        -" with administrator privileges".length,
      ),
    );
    expect(f.calls).toHaveLength(1);
    expect(f.current()).toBe(`/Users/A "B"/it's\\$home/bin/ajour`);
    expect(shell).toContain("createSymbolicLinkAtPathWithDestinationError");
    expect(shell).not.toContain("/bin/ln");
    expect(shell).toContain(
      `[ ! -e '/usr/local/bin/ajour' ] && [ ! -L '/usr/local/bin/ajour' ] && AJOUR_LINK='/usr/local/bin/ajour'`,
    );
    expect(shell).toContain(
      `AJOUR_TARGET='/Users/A "B"/it'"'"'s\\$home/bin/ajour' /usr/bin/osascript -l JavaScript`,
    );
    expect(shell).toContain(
      `[ -L '/usr/local/bin/ajour' ] && [ "$(/usr/bin/readlink '/usr/local/bin/ajour')" = `,
    );
  });
  it("refuses cancellation with the specified message", async () => {
    const f = fixture({ writable: false, cancelled: true });
    await expect(
      f.link().add("/Users/alex/bin", { interactive: true }),
    ).rejects.toThrow(
      "Ajour needs your password to link /usr/local/bin/ajour. Nothing was installed.",
    );
  });
  it("does not prompt to clean an orphaned link during reconciliation", async () => {
    const f = fixture({ target: "/Users/alex/bin/ajour", writable: false });
    await expect(f.link().remove("/Users/alex/bin")).rejects.toThrow("Retry");
    expect(f.calls).toEqual([]);
  });
  it("never prompts without an explicit action", async () => {
    const f = fixture({ writable: false });
    await expect(f.link().add("/Users/alex/bin")).rejects.toThrow("Retry");
    expect(f.calls).toEqual([]);
  });
});
