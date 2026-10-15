import path from "node:path";
import { randomUUID } from "node:crypto";
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
  CONNECTOR_PLUGIN_API_VERSION,
  CONNECTOR_PLUGIN_ARCHIVE_EXTENSION,
  connectorPluginManifestSchema,
  connectorPluginIdSchema,
  type AgentTask,
  type ConnectorPluginManifest,
} from "../../../packages/shared/connectors.ts";
import {
  allowedTaskSlots,
  listTemplateSlots,
} from "../../../packages/shared/agent-task-templates.ts";

export const MAX_CONNECTOR_PLUGIN_ARCHIVE_BYTES = 25 * 1024 * 1024;
const MAX_CONNECTOR_PLUGIN_FILES = 2_000;
const MAX_CONNECTOR_PLUGIN_FILE_BYTES = 25 * 1024 * 1024;
const MAX_CONNECTOR_PLUGIN_EXTRACTED_BYTES = 100 * 1024 * 1024;
const ALLOWED_ARCHIVE_ENTRY_TYPES = new Set(["File", "Directory"]);
const ALLOWED_ENTRYPOINT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);

export interface ResolvedConnectorPlugin {
  manifest: ConnectorPluginManifest;
  directory: string;
  /** Absent for a plugin that runs no code. */
  entrypointPath?: string;
  source: "development" | "installed";
}

/**
 * An installed package Ajour read but cannot run. Discovery keeps it, with a
 * reason written for the user, so the settings page can explain the problem
 * and offer an update instead of showing an unnamed placeholder.
 */
export interface UnavailableConnectorPlugin {
  manifest: ConnectorPluginManifest;
  directory: string;
  reason: string;
}

/** Thrown when a valid manifest targets a plugin API this app does not run. */
export class IncompatibleConnectorPluginError extends Error {
  readonly manifest: ConnectorPluginManifest;

  constructor(manifest: ConnectorPluginManifest) {
    const pluginName = `${manifest.displayName} ${manifest.version}`;
    super(
      manifest.apiVersion < CONNECTOR_PLUGIN_API_VERSION
        ? `${pluginName} uses plugin API ${manifest.apiVersion}, but this version of Ajour needs plugin API ${CONNECTOR_PLUGIN_API_VERSION}. Update the plugin to use it again.`
        : `${pluginName} uses plugin API ${manifest.apiVersion}, but this version of Ajour supports plugin API ${CONNECTOR_PLUGIN_API_VERSION}. Update Ajour to use this plugin.`,
    );
    this.name = "IncompatibleConnectorPluginError";
    this.manifest = manifest;
  }
}

export interface InstalledConnectorPlugin {
  manifest: ConnectorPluginManifest;
  directory: string;
  replaced: boolean;
  installed: boolean;
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
  manifest: ConnectorPluginManifest,
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
    throw new Error(`Connector archive contains an unsafe path: ${entryPath}`);
  }
}

async function validateConnectorPluginArchive(archivePath: string) {
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
          if (entryCount > MAX_CONNECTOR_PLUGIN_FILES) {
            throw new Error(
              `Connector archive contains more than ${MAX_CONNECTOR_PLUGIN_FILES} entries.`,
            );
          }
          if (!ALLOWED_ARCHIVE_ENTRY_TYPES.has(entry.type)) {
            throw new Error(
              `Connector archive entry "${entry.path}" has unsupported type "${entry.type}".`,
            );
          }
          if (entry.type === "File") {
            if (entry.size > MAX_CONNECTOR_PLUGIN_FILE_BYTES) {
              throw new Error(
                `Connector archive entry "${entry.path}" is too large.`,
              );
            }
            extractedBytes += entry.size;
            if (extractedBytes > MAX_CONNECTOR_PLUGIN_EXTRACTED_BYTES) {
              throw new Error(
                "Connector archive expands beyond the allowed size.",
              );
            }
          }
        } catch (error) {
          const validationError =
            error instanceof Error
              ? error
              : new Error("Connector archive validation failed.");
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

export function resolveConnectorPluginEntrypoint(
  directory: string,
  manifest: ConnectorPluginManifest,
) {
  if (!manifest.entrypoint) {
    throw new Error(`Plugin "${manifest.id}" runs no code.`);
  }
  if (path.isAbsolute(manifest.entrypoint)) {
    throw new Error(
      `Connector plugin "${manifest.id}" entrypoint must be relative.`,
    );
  }

  const entrypointPath = path.resolve(directory, manifest.entrypoint);
  if (!isPathInside(directory, entrypointPath)) {
    throw new Error(
      `Connector plugin "${manifest.id}" entrypoint leaves its plugin directory.`,
    );
  }

  if (
    !ALLOWED_ENTRYPOINT_EXTENSIONS.has(
      path.extname(entrypointPath).toLowerCase(),
    )
  ) {
    throw new Error(
      `Connector plugin "${manifest.id}" entrypoint must be compiled JavaScript.`,
    );
  }

  return entrypointPath;
}

export async function readConnectorPlugin(
  directory: string,
  source: ResolvedConnectorPlugin["source"],
): Promise<ResolvedConnectorPlugin> {
  const pluginDirectory = path.resolve(directory);
  const canonicalPluginDirectory = await realpath(pluginDirectory);
  const manifestPath = path.join(pluginDirectory, "plugin.json");
  await assertRegularPluginFile(
    pluginDirectory,
    canonicalPluginDirectory,
    manifestPath,
    "Connector plugin manifest",
  );
  const rawManifest = await readFile(manifestPath, "utf8");
  const manifest = connectorPluginManifestSchema.parse(JSON.parse(rawManifest));

  if (manifest.apiVersion !== CONNECTOR_PLUGIN_API_VERSION) {
    throw new IncompatibleConnectorPluginError(manifest);
  }

  let entrypointPath: string | undefined;
  if (manifest.entrypoint) {
    entrypointPath = resolveConnectorPluginEntrypoint(
      pluginDirectory,
      manifest,
    );
    await assertRegularPluginFile(
      pluginDirectory,
      canonicalPluginDirectory,
      entrypointPath,
      `Connector plugin "${manifest.id}" entrypoint`,
    );
  }
  // Read every prompt once so a bad one fails the install, not the first run.
  for (const task of manifest.capabilities.agentTask?.tasks ?? []) {
    await readAgentTaskPromptFile(
      pluginDirectory,
      canonicalPluginDirectory,
      manifest,
      task,
    );
  }

  return {
    manifest,
    directory: pluginDirectory,
    entrypointPath,
    source,
  };
}

/**
 * Reads every installed package. Packages built for another plugin API come
 * back in `unavailable`; other invalid directories are logged and skipped.
 */
export async function discoverInstalledConnectorPlugins(
  pluginRoot: string,
): Promise<{
  plugins: ResolvedConnectorPlugin[];
  unavailable: UnavailableConnectorPlugin[];
}> {
  let entries;
  try {
    entries = await readdir(pluginRoot, { withFileTypes: true });
  } catch {
    return { plugins: [], unavailable: [] };
  }

  const plugins: ResolvedConnectorPlugin[] = [];
  const unavailable: UnavailableConnectorPlugin[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) {
      continue;
    }

    try {
      plugins.push(
        await readConnectorPlugin(
          path.join(pluginRoot, entry.name),
          "installed",
        ),
      );
    } catch (error) {
      if (error instanceof IncompatibleConnectorPluginError) {
        unavailable.push({
          manifest: error.manifest,
          directory: path.join(pluginRoot, entry.name),
          reason: error.message,
        });
        continue;
      }
      console.error(
        `Skipping invalid connector plugin directory "${entry.name}".`,
        error,
      );
    }
  }

  return { plugins, unavailable };
}

export async function reconcileConnectorPluginInstallRoot(pluginRoot: string) {
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
      const backupPlugin = await readConnectorPlugin(entryPath, "installed");
      const targetDirectory = path.join(pluginRoot, backupPlugin.manifest.id);
      if (await pathExists(targetDirectory)) {
        await rm(entryPath, { recursive: true, force: true });
      } else {
        await rename(entryPath, targetDirectory);
      }
    } catch (error) {
      console.error(
        `Unable to reconcile connector plugin backup "${entryPath}".`,
        error,
      );
    }
  }
}

export async function installConnectorPluginArchive(options: {
  archiveBytes: Uint8Array;
  archiveFilename: string;
  installRoot: string;
  replaceExisting?: boolean;
}): Promise<InstalledConnectorPlugin> {
  if (
    !options.archiveFilename
      .toLowerCase()
      .endsWith(CONNECTOR_PLUGIN_ARCHIVE_EXTENSION)
  ) {
    throw new Error(
      `Connector plugin files must use the ${CONNECTOR_PLUGIN_ARCHIVE_EXTENSION} extension.`,
    );
  }

  if (
    options.archiveBytes.byteLength === 0 ||
    options.archiveBytes.byteLength > MAX_CONNECTOR_PLUGIN_ARCHIVE_BYTES
  ) {
    throw new Error(
      `Connector plugin archives must be between 1 byte and ${MAX_CONNECTOR_PLUGIN_ARCHIVE_BYTES} bytes.`,
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
    await validateConnectorPluginArchive(archivePath);
    await extract({
      cwd: payloadDirectory,
      file: archivePath,
      gzip: true,
      preservePaths: false,
      strict: true,
    });

    const stagedPlugin = await readConnectorPlugin(
      payloadDirectory,
      "installed",
    );
    const targetDirectory = path.join(
      options.installRoot,
      stagedPlugin.manifest.id,
    );
    const targetExists = await pathExists(targetDirectory);

    if (targetExists && options.replaceExisting === false) {
      const existingPlugin = await readConnectorPlugin(
        targetDirectory,
        "installed",
      );
      return {
        manifest: existingPlugin.manifest,
        directory: existingPlugin.directory,
        replaced: false,
        installed: false,
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

    if (targetExists) {
      await rm(backupDirectory, { recursive: true, force: true }).catch(
        (error) => {
          console.error(
            `Unable to remove connector plugin backup "${backupDirectory}".`,
            error,
          );
        },
      );
    }

    return {
      manifest: stagedPlugin.manifest,
      directory: targetDirectory,
      replaced: targetExists,
      installed: true,
    };
  } finally {
    await rm(stagingRoot, { recursive: true, force: true });
  }
}

export async function uninstallConnectorPluginPackage(options: {
  installRoot: string;
  pluginId: string;
}): Promise<Pick<ResolvedConnectorPlugin, "manifest" | "directory"> | null> {
  const pluginId = connectorPluginIdSchema.parse(options.pluginId);
  const installRoot = path.resolve(options.installRoot);
  const { plugins, unavailable } =
    await discoverInstalledConnectorPlugins(installRoot);
  // A package built for another plugin API can still be removed.
  const plugin = [...plugins, ...unavailable].find(
    (candidate) => candidate.manifest.id === pluginId,
  );
  if (!plugin) {
    return null;
  }

  if (path.dirname(plugin.directory) !== installRoot) {
    throw new Error(
      `Connector plugin "${pluginId}" is outside the managed plugin directory.`,
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
