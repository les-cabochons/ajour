import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";

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
  write(change: { expected: string | null; value: string }): Promise<boolean>;
}

const { createWindowsUserPath, createPowerShellRegistry } =
  require("./electron/cli-path.cjs") as {
    createWindowsUserPath: (options: {
      registry: Registry;
      env?: Record<string, string | undefined>;
    }) => {
      add(folder: string): Promise<{ added: boolean }>;
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

/** A user Path that holds `value` with `kind`, and records each write. */
function fakeRegistry(initial: RegistryValue) {
  let current = { ...initial };
  const writes: Array<{ value: string; kind: Kind }> = [];
  const registry: Registry & { changeTo(value: string): void } = {
    async read() {
      return { ...current };
    },
    async write({ expected, value }) {
      // As the PowerShell write does: refuse when the Path changed since.
      if (current.value !== expected) return false;
      current = { value, kind: "ExpandString" };
      writes.push({ value, kind: "ExpandString" });
      return true;
    },
    changeTo(value: string) {
      current = { value, kind: current.kind ?? "ExpandString" };
    },
  };
  return { registry, writes, current: () => current };
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

    expect(await userPath.add(FOLDER)).toEqual({ added: true });

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

  it("writes a REG_SZ Path back as REG_EXPAND_SZ", async () => {
    const fake = fakeRegistry({ value: "C:\\Tools", kind: "String" });
    await createWindowsUserPath({ registry: fake.registry, env: ENV }).add(
      FOLDER,
    );

    expect(fake.current()).toEqual({
      value: `C:\\Tools;${FOLDER}`,
      kind: "ExpandString",
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

    expect(await userPath.add(FOLDER)).toEqual({ added: false });
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

    expect(await registry.write({ expected: "C:\\Tools", value })).toBe(true);

    const [call] = fake.calls;
    expect(call!.args.join(" ")).not.toContain("Remove-Item");
    expect(call!.args.join(" ")).toContain("ExpandString");
    expect(call!.args.join(" ")).toContain("WM_SETTINGCHANGE");
    expect(call!.env.AJOUR_PATH_EXPECTED).toBe(`v${b64("C:\\Tools")}`);
    expect(call!.env.AJOUR_PATH_VALUE).toBe(`v${b64(value)}`);
    expect(call!.env.SystemRoot).toBe(SYSTEM_ROOT);
  });

  it("sets an empty expected value, which Windows would otherwise drop", async () => {
    const fake = fakeRun("written");
    const registry = createPowerShellRegistry({ run: fake.run, env: {} });

    await registry.write({ expected: "", value: "C:\bin" });

    expect(fake.calls[0]!.env.AJOUR_PATH_EXPECTED).toBe("v");
  });

  it("says when the Path changed before the write", async () => {
    const fake = fakeRun("changed");
    const registry = createPowerShellRegistry({ run: fake.run, env: {} });

    expect(await registry.write({ expected: null, value: "C:\\bin" })).toBe(
      false,
    );
    expect(fake.calls[0]!.env.AJOUR_PATH_EXPECTED).toBe("-");
  });
});
