import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { extract, list } from "tar";
import {
  PLUGIN_API_VERSION,
  PLUGIN_ARCHIVE_EXTENSION,
  pluginManifestSchema,
  pluginIdSchema,
  type AgentTask,
  type PluginManifest,
} from "../../../packages/shared/plugins.ts";
import {
  PLUGIN_API_4,
  pluginApi4ManifestSchema,
} from "../../../packages/shared/plugin-api-4.ts";
import type { PluginAccessView } from "../../../packages/shared/plugin-access-schemas.ts";
import {
  pluginAccessView,
  summarizePluginAccess,
  type PluginAccessManifest,
} from "../../../packages/shared/plugin-access.ts";
import {
  allowedTaskSlots,
  listTemplateSlots,
} from "../../../packages/shared/agent-task-templates.ts";

export const MAX_PLUGIN_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_PLUGIN_FILES = 2_000;
const MAX_PLUGIN_FILE_BYTES = 25 * 1024 * 1024;
const MAX_PLUGIN_EXTRACTED_BYTES = 100 * 1024 * 1024;
const ALLOWED_ARCHIVE_ENTRY_TYPES = new Set(["File", "Directory"]);
const ALLOWED_ENTRYPOINT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);

export interface ResolvedPlugin {
  manifest: PluginManifest;
  directory: string;
  /** Absent for a plugin that runs no code. */
  entrypointPath?: string;
  source: "development" | "installed";
  /** What the package reaches, as Access review lists it. */
  access: PluginAccessView;
}

/**
 * An installed package Ajour read but cannot run. Discovery keeps it, with a
 * reason written for the user, so the settings page can explain the problem
 * and offer an update instead of showing an unnamed placeholder.
 */
export interface UnavailablePlugin {
  manifest: PluginManifest;
  directory: string;
  reason: string;
}

/**
 * The code of an error that says the plugin archive itself is invalid, as the
 * desktop's plugin.install event records it, apart from the machine failing.
 */
export const INVALID_PLUGIN_ARCHIVE = "invalid_archive";

/** System errors that are the machine failing wherever they happen: a full, locked or busy disk. */
const MACHINE_ERROR_CODES = new Set([
  "EACCES",
  "EAGAIN",
  "EBUSY",
  "EDQUOT",
  "EIO",
  "EMFILE",
  "ENFILE",
  "ENOMEM",
  "ENOSPC",
  "EPERM",
  "EROFS",
]);

/**
 * Marks an error raised while validating, extracting or reading an archive
 * as `invalid_archive`. Errors the archive's contents cause are: tar's and
 * zlib's, the manifest's parse and schema errors, and the limits. A Node
 * system error is the archive's fault only on a path inside the extraction
 * folder, such as a manifest or entrypoint the archive lacks (`ENOENT`) or an
 * entry tar cannot write over another (`EEXIST`). Opening the staged archive
 * or reaching the extraction folder itself, and a full, locked or busy disk
 * anywhere, stay the machine failing.
 */
function invalidArchiveError(
  error: unknown,
  extractionFolder: string,
): unknown {
  const systemError = error as NodeJS.ErrnoException | null;
  if (typeof systemError?.syscall === "string") {
    const file = systemError.path;
    const insideExtraction =
      typeof file === "string" &&
      isPathInside(extractionFolder, file) &&
      path.resolve(file) !== path.resolve(extractionFolder);
    if (!insideExtraction || MACHINE_ERROR_CODES.has(systemError.code ?? "")) {
      return error;
    }
  }
  const marked = error instanceof Error ? error : new Error(String(error));
  return Object.assign(marked, { code: INVALID_PLUGIN_ARCHIVE });
}

async function asArchiveValidation<Result>(
  extractionFolder: string,
  work: () => Promise<Result>,
): Promise<Result> {
  try {
    return await work();
  } catch (error) {
    throw invalidArchiveError(error, extractionFolder);
  }
}

/** Thrown when a valid manifest targets a plugin API this app does not run. */
export class IncompatiblePluginError extends Error {
  readonly manifest: PluginManifest;

  constructor(manifest: PluginManifest) {
    const pluginName = `${manifest.displayName} ${manifest.version}`;
    super(
      manifest.apiVersion < PLUGIN_API_VERSION
        ? `${pluginName} uses plugin API ${manifest.apiVersion}, but this version of Ajour needs plugin API ${PLUGIN_API_VERSION}. Update the plugin to use it again.`
        : `${pluginName} uses plugin API ${manifest.apiVersion}, but this version of Ajour supports plugin API ${PLUGIN_API_VERSION}. Update Ajour to use this plugin.`,
    );
    this.name = "IncompatiblePluginError";
    this.manifest = manifest;
  }
}

export interface InstalledPlugin {
  manifest: PluginManifest;
  directory: string;
  replaced: boolean;
  installed: boolean;
  /** What the installed package reaches. */
  access: PluginAccessView;
  /** The replaced package's backup couldn't be removed; the next start removes it. */
  backupLeft?: true;
}

function isPathInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return (
    relative.length === 0 ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
}

async function pathExists(candidate: string) {
  try {
    await access(candidate);
    return true;
  } catch {
    return false;
  }
}

async function assertRegularPluginFile(
  pluginDirectory: string,
  canonicalPluginDirectory: string,
  candidate: string,
  description: string,
) {
  const candidateStat = await lstat(candidate);
  if (!candidateStat.isFile() || candidateStat.isSymbolicLink()) {
    throw new Error(`${description} must be a regular file.`);
  }

  const relativeCandidate = path.relative(pluginDirectory, candidate);
  const expectedCanonicalPath = path.resolve(
    canonicalPluginDirectory,
    relativeCandidate,
  );
  const canonicalCandidate = await realpath(candidate);
  if (
    !isPathInside(canonicalPluginDirectory, canonicalCandidate) ||
    canonicalCandidate !== expectedCanonicalPath
  ) {
    throw new Error(`${description} must not traverse symbolic links.`);
  }
}

/** The largest agent task prompt Ajour reads, in bytes. */
export const MAX_AGENT_TASK_PROMPT_BYTES = 64 * 1024;

/**
 * Resolves an agent task's prompt file like an entrypoint: relative, inside
 * the plugin folder, a regular file, no symbolic links, and at most 64 KB.
 * Every slot in the prompt must be one Ajour fills.
 */
export async function readAgentTaskPromptFile(
  directory: string,
  canonicalDirectory: string,
  manifest: PluginManifest,
  task: AgentTask,
): Promise<string> {
  const description = `Plugin "${manifest.id}" task "${task.id}" prompt`;
  if (path.isAbsolute(task.prompt)) {
    throw new Error(`${description} must be relative.`);
  }
  const promptPath = path.resolve(directory, task.prompt);
  if (!isPathInside(directory, promptPath)) {
    throw new Error(`${description} leaves its plugin directory.`);
  }
  await assertRegularPluginFile(
    directory,
    canonicalDirectory,
    promptPath,
    description,
  );
  const { size } = await stat(promptPath);
  if (size > MAX_AGENT_TASK_PROMPT_BYTES) {
    throw new Error(`${description} is over 64 KB.`);
  }
  const prompt = await readFile(promptPath, "utf8");
  const allowed = allowedTaskSlots(task.settings.map((field) => field.id));
  for (const slot of listTemplateSlots(prompt)) {
    if (!allowed.has(slot)) {
      throw new Error(
        `${description} uses {{${slot}}}, which Ajour does not fill.`,
      );
    }
  }
  return prompt;
}

function validateArchiveEntryPath(entryPath: string) {
  const normalized = entryPath.replaceAll("\\", "/");
  if (
    path.posix.isAbsolute(normalized) ||
    path.win32.isAbsolute(normalized) ||
    /^[A-Za-z]:/.test(normalized) ||
    normalized.split("/").some((segment) => segment === "..")
  ) {
    throw new Error(`Plugin archive contains an unsafe path: ${entryPath}`);
  }
}

async function validatePluginArchive(archivePath: string) {
  let entryCount = 0;
  let extractedBytes = 0;

  await new Promise<void>((resolve, reject) => {
    const source = createReadStream(archivePath);
    const parser = list({
      gzip: true,
      strict: true,
      onReadEntry(entry) {
        try {
          validateArchiveEntryPath(entry.path);
          entryCount += 1;
          if (entryCount > MAX_PLUGIN_FILES) {
            throw new Error(
              `Plugin archive contains more than ${MAX_PLUGIN_FILES} entries.`,
            );
          }
          if (!ALLOWED_ARCHIVE_ENTRY_TYPES.has(entry.type)) {
            throw new Error(
              `Plugin archive entry "${entry.path}" has unsupported type "${entry.type}".`,
            );
          }
          if (entry.type === "File") {
            if (entry.size > MAX_PLUGIN_FILE_BYTES) {
              throw new Error(
                `Plugin archive entry "${entry.path}" is too large.`,
              );
            }
            extractedBytes += entry.size;
            if (extractedBytes > MAX_PLUGIN_EXTRACTED_BYTES) {
              throw new Error(
                "Plugin archive expands beyond the allowed size.",
              );
            }
          }
        } catch (error) {
          const validationError =
            error instanceof Error
              ? error
              : new Error("Plugin archive validation failed.");
          parser.abort(validationError);
          source.destroy();
        }
      },
    });
    source.once("error", reject);
    parser.once("error", reject);
    parser.once("end", resolve);
    source.pipe(parser);
  });
}

export function resolvePluginEntrypoint(
  directory: string,
  manifest: PluginManifest,
) {
  if (!manifest.entrypoint) {
    throw new Error(`Plugin "${manifest.id}" runs no code.`);
  }
  if (path.isAbsolute(manifest.entrypoint)) {
    throw new Error(`Plugin "${manifest.id}" entrypoint must be relative.`);
  }

  const entrypointPath = path.resolve(directory, manifest.entrypoint);
  if (!isPathInside(directory, entrypointPath)) {
    throw new Error(
      `Plugin "${manifest.id}" entrypoint leaves its plugin directory.`,
    );
  }

  if (
    !ALLOWED_ENTRYPOINT_EXTENSIONS.has(
      path.extname(entrypointPath).toLowerCase(),
    )
  ) {
    throw new Error(
      `Plugin "${manifest.id}" entrypoint must be compiled JavaScript.`,
    );
  }

  return entrypointPath;
}

/** Which plugin APIs the host admits besides the one it runs. */
export interface PluginAdmissionPolicy {
  /**
   * Development builds admit plugin API 4 packages until the cut-over
   * (#403). Packaged builds refuse them as built for a newer Ajour.
   */
  admitPluginApi4: boolean;
}

const PACKAGED_BUILD: PluginAdmissionPolicy = { admitPluginApi4: false };

/**
 * Validates a manifest against the schema of the plugin API it declares. An
 * API 4 manifest must pass every API 4 rule even where it is refused, so a
 * broken one is invalid rather than merely unavailable.
 */
function parsePluginManifest(
  raw: unknown,
  policy: PluginAdmissionPolicy,
): PluginManifest {
  if ((raw as { apiVersion?: unknown } | null)?.apiVersion === PLUGIN_API_4) {
    const manifest = pluginApi4ManifestSchema.parse(raw);
    if (!policy.admitPluginApi4) throw new IncompatiblePluginError(manifest);
    return manifest;
  }
  const manifest = pluginManifestSchema.parse(raw);
  if (manifest.apiVersion !== PLUGIN_API_VERSION) {
    throw new IncompatiblePluginError(manifest);
  }
  return manifest;
}

export async function readPlugin(
  directory: string,
  source: ResolvedPlugin["source"],
  policy: PluginAdmissionPolicy = PACKAGED_BUILD,
): Promise<ResolvedPlugin> {
  const pluginDirectory = path.resolve(directory);
  const canonicalPluginDirectory = await realpath(pluginDirectory);
  const manifestPath = path.join(pluginDirectory, "plugin.json");
  await assertRegularPluginFile(
    pluginDirectory,
    canonicalPluginDirectory,
    manifestPath,
    "Plugin manifest",
  );
  const rawManifest = await readFile(manifestPath, "utf8");
  const manifest = parsePluginManifest(JSON.parse(rawManifest), policy);

  let entrypointPath: string | undefined;
  if (manifest.entrypoint) {
    entrypointPath = resolvePluginEntrypoint(pluginDirectory, manifest);
    await assertRegularPluginFile(
      pluginDirectory,
      canonicalPluginDirectory,
      entrypointPath,
      `Plugin "${manifest.id}" entrypoint`,
    );
  }
  // Read every prompt once so a bad one fails the install, not the first run.
  // Access review keeps a hash of each, so a changed prompt is seen without
  // storing its text.
  const agentPrompts: Record<string, string> = {};
  for (const task of manifest.capabilities.agentTask?.tasks ?? []) {
    const prompt = await readAgentTaskPromptFile(
      pluginDirectory,
      canonicalPluginDirectory,
      manifest,
      task,
    );
    agentPrompts[task.id] = createHash("sha256").update(prompt).digest("hex");
  }
  const accessManifest = manifest as PluginAccessManifest;

  return {
    manifest,
    directory: pluginDirectory,
    entrypointPath,
    source,
    access: pluginAccessView(
      accessManifest,
      summarizePluginAccess(accessManifest, { agentPrompts }),
    ),
  };
}

/**
 * Reads every installed package. Packages built for another plugin API come
 * back in `unavailable`. Other invalid directories are skipped, and
 * `invalidCount` counts them, for the caller's event.
 */
export async function discoverInstalledPlugins(
  pluginRoot: string,
  policy: PluginAdmissionPolicy = PACKAGED_BUILD,
): Promise<{
  plugins: ResolvedPlugin[];
  unavailable: UnavailablePlugin[];
  invalidCount: number;
}> {
  let entries;
  try {
    entries = await readdir(pluginRoot, { withFileTypes: true });
  } catch {
    return { plugins: [], unavailable: [], invalidCount: 0 };
  }

  const plugins: ResolvedPlugin[] = [];
  const unavailable: UnavailablePlugin[] = [];
  let invalidCount = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    try {
      plugins.push(
        await readPlugin(
          path.join(pluginRoot, entry.name),
          "installed",
          policy,
        ),
      );
    } catch (error) {
      if (error instanceof IncompatiblePluginError) {
        unavailable.push({
          manifest: error.manifest,
          directory: path.join(pluginRoot, entry.name),
          reason: error.message,
        });
        continue;
      }
      invalidCount += 1;
    }
  }

  return { plugins, unavailable, invalidCount };
}

/**
 * Finishes or undoes package changes a stopped app left half done. Returns
 * how many leftover backups it could neither restore nor remove.
 */
export async function reconcilePluginInstallRoot(
  pluginRoot: string,
  policy: PluginAdmissionPolicy = PACKAGED_BUILD,
): Promise<number> {
  let failedBackups = 0;
  await mkdir(pluginRoot, { recursive: true, mode: 0o700 });
  const entries = await readdir(pluginRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }
    const entryPath = path.join(pluginRoot, entry.name);
    if (
      entry.name.startsWith(".install-") ||
      entry.name.startsWith(".uninstall-")
    ) {
      await rm(entryPath, { recursive: true, force: true });
      continue;
    }
    if (!entry.name.startsWith(".backup-")) {
      continue;
    }

    try {
      const backupPlugin = await readPlugin(entryPath, "installed", policy);
      const targetDirectory = path.join(pluginRoot, backupPlugin.manifest.id);
      if (await pathExists(targetDirectory)) {
        await rm(entryPath, { recursive: true, force: true });
      } else {
        await rename(entryPath, targetDirectory);
      }
    } catch {
      failedBackups += 1;
    }
  }
  return failedBackups;
}

export async function installPluginArchive(options: {
  archiveBytes: Uint8Array;
  archiveFilename: string;
  installRoot: string;
  replaceExisting?: boolean;
  policy?: PluginAdmissionPolicy;
}): Promise<InstalledPlugin> {
  if (
    !options.archiveFilename.toLowerCase().endsWith(PLUGIN_ARCHIVE_EXTENSION)
  ) {
    throw Object.assign(
      new Error(
        `Plugin files must use the ${PLUGIN_ARCHIVE_EXTENSION} extension.`,
      ),
      { code: INVALID_PLUGIN_ARCHIVE },
    );
  }

  if (
    options.archiveBytes.byteLength === 0 ||
    options.archiveBytes.byteLength > MAX_PLUGIN_ARCHIVE_BYTES
  ) {
    throw Object.assign(
      new Error(
        `Plugin archives must be between 1 byte and ${MAX_PLUGIN_ARCHIVE_BYTES} bytes.`,
      ),
      { code: INVALID_PLUGIN_ARCHIVE },
    );
  }

  await mkdir(options.installRoot, { recursive: true, mode: 0o700 });
  const stagingRoot = await mkdtemp(
    path.join(options.installRoot, ".install-"),
  );
  const archivePath = path.join(stagingRoot, "plugin.ajour-connector");
  const payloadDirectory = path.join(stagingRoot, "payload");
  await mkdir(payloadDirectory, { mode: 0o700 });

  try {
    await writeFile(archivePath, options.archiveBytes, { mode: 0o600 });
    const stagedPlugin = await asArchiveValidation(
      payloadDirectory,
      async () => {
        await validatePluginArchive(archivePath);
        await extract({
          cwd: payloadDirectory,
          file: archivePath,
          gzip: true,
          preservePaths: false,
          strict: true,
        });
        return await readPlugin(payloadDirectory, "installed", options.policy);
      },
    );
    const targetDirectory = path.join(
      options.installRoot,
      stagedPlugin.manifest.id,
    );
    const targetExists = await pathExists(targetDirectory);

    if (targetExists && options.replaceExisting === false) {
      const existingPlugin = await readPlugin(
        targetDirectory,
        "installed",
        options.policy,
      );
      return {
        manifest: existingPlugin.manifest,
        directory: existingPlugin.directory,
        replaced: false,
        installed: false,
        access: existingPlugin.access,
      };
    }

    const backupDirectory = path.join(
      options.installRoot,
      `.backup-${stagedPlugin.manifest.id}-${randomUUID()}`,
    );

    if (targetExists) {
      await rename(targetDirectory, backupDirectory);
    }

    try {
      await rename(payloadDirectory, targetDirectory);
    } catch (error) {
      if (targetExists && (await pathExists(backupDirectory))) {
        await rename(backupDirectory, targetDirectory);
      }
      throw error;
    }

    // A backup left behind is removed at the next start, by
    // reconcilePluginInstallRoot.
    const backupLeft =
      targetExists &&
      (await rm(backupDirectory, { recursive: true, force: true }).then(
        () => false,
        () => true,
      ));

    return {
      manifest: stagedPlugin.manifest,
      directory: targetDirectory,
      replaced: targetExists,
      installed: true,
      access: stagedPlugin.access,
      ...(backupLeft ? { backupLeft: true as const } : {}),
    };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

export async function uninstallPluginPackage(options: {
  installRoot: string;
  pluginId: string;
}): Promise<Pick<ResolvedPlugin, "manifest" | "directory"> | null> {
  const pluginId = pluginIdSchema.parse(options.pluginId);
  const installRoot = path.resolve(options.installRoot);
  const { plugins, unavailable } = await discoverInstalledPlugins(installRoot);
  // A package built for another plugin API can still be removed.
  const plugin = [...plugins, ...unavailable].find(
    (candidate) => candidate.manifest.id === pluginId,
  );
  if (!plugin) {
    return null;
  }

  if (path.dirname(plugin.directory) !== installRoot) {
    throw new Error(
      `Plugin "${pluginId}" is outside the managed plugin directory.`,
    );
  }

  const removedDirectory = path.join(
    installRoot,
    `.uninstall-${pluginId}-${randomUUID()}`,
  );
  await rename(plugin.directory, removedDirectory);
  try {
    await rm(removedDirectory, { recursive: true, force: true });
  } catch (error) {
    if (
      !(await pathExists(plugin.directory)) &&
      (await pathExists(removedDirectory))
    ) {
      await rename(removedDirectory, plugin.directory);
    }
    throw error;
  }

  return plugin;
}
