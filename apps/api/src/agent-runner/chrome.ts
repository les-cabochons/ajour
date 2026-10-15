import { access } from "node:fs/promises";
import path from "node:path";
import { findExecutable } from "./cli-path.ts";

/** Where Google Chrome installs, per platform. */
function chromeLocations(platform: NodeJS.Platform, env: NodeJS.ProcessEnv) {
  if (platform === "darwin") {
    const binary = "Google Chrome.app/Contents/MacOS/Google Chrome";
    return [
      path.join("/Applications", binary),
      // Chrome installed for one user only.
      ...(env.HOME ? [path.join(env.HOME, "Applications", binary)] : []),
    ];
  }
  if (platform === "win32") {
    return [env.PROGRAMFILES, env["PROGRAMFILES(X86)"], env.LOCALAPPDATA]
      .filter((root): root is string => Boolean(root))
      .map((root) =>
        path.join(root, "Google", "Chrome", "Application", "chrome.exe"),
      );
  }
  return [];
}

/** Whether Google Chrome is installed, which Playwright's `--browser chrome` needs. */
export async function isChromeInstalled({
  platform = process.platform,
  env = process.env,
  pathValue = env.PATH ?? "",
  exists = async (candidate: string) =>
    access(candidate).then(
      () => true,
      () => false,
    ),
}: {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  pathValue?: string;
  exists?: (candidate: string) => Promise<boolean>;
} = {}): Promise<boolean> {
  for (const candidate of chromeLocations(platform, env)) {
    if (await exists(candidate)) return true;
  }
  if (platform === "linux") {
    return (
      (await findExecutable("google-chrome", pathValue, platform)) !== null
    );
  }
  return false;
}
