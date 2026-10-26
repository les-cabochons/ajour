import path from "node:path";
import { lstat, readFile, realpath } from "node:fs/promises";
import {
  PROJECT_DATA_SHAPE_PLUGIN_API_VERSION,
  projectDataShapePluginManifestSchema,
  type ProjectDataShapePluginManifest,
} from "../../../packages/shared/project-data-shapes.ts";
import {
  PLUGIN_API_4,
  pluginApi4ManifestSchema,
  type PluginApi4Manifest,
} from "../../../packages/shared/plugin-api-4.ts";

const ALLOWED_ENTRYPOINT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);

/** Which plugin APIs the data shape host reads besides data shape API 1. */
export interface ProjectDataShapeAdmissionPolicy {
  /** Development builds admit plugin API 4 packages until the cut-over (#403). */
  admitPluginApi4: boolean;
}

export interface ResolvedProjectDataShapePlugin {
  manifest: ProjectDataShapePluginManifest;
  directory: string;
  entrypointPath: string;
}

function isPathInside(parent: string, candidate: string) {
  const relative = path.relative(parent, candidate);
  return (
    relative.length === 0 ||
    (!relative.startsWith("..") && !path.isAbsolute(relative))
  );
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

function dataShapeApi1Manifest(raw: unknown): ProjectDataShapePluginManifest {
  const manifest = projectDataShapePluginManifestSchema.parse(raw);
  if (manifest.apiVersion !== PROJECT_DATA_SHAPE_PLUGIN_API_VERSION) {
    throw new Error(
      `Schema plugin "${manifest.id}" requires API version ${manifest.apiVersion}; this app supports version ${PROJECT_DATA_SHAPE_PLUGIN_API_VERSION}.`,
    );
  }
  return manifest;
}

/**
 * The data shape of a plugin API 4 package. The host gives it no connection
 * and no broker, so it may declare no network or connection fields, and it
 * is loaded when needed: nothing of it stays ready between operations.
 */
function dataShapeOfApi4Package(
  raw: unknown,
  policy: ProjectDataShapeAdmissionPolicy,
): ProjectDataShapePluginManifest {
  const manifest: PluginApi4Manifest = pluginApi4ManifestSchema.parse(raw);
  const label = `Schema plugin "${manifest.id}"`;
  if (!policy.admitPluginApi4) {
    throw new Error(
      `${label} uses plugin API 4, which this build of Ajour does not admit.`,
    );
  }
  const projectDataShape = manifest.capabilities.projectDataShape;
  if (!projectDataShape) {
    throw new Error(`${label} declares no project data shape.`);
  }
  if (!manifest.entrypoint) {
    throw new Error(`${label} needs an entrypoint.`);
  }
  if (manifest.network !== undefined) {
    throw new Error(`${label} may not declare network access.`);
  }
  if (manifest.connectionFields.length > 0) {
    throw new Error(`${label} may not declare connection fields.`);
  }
  if (manifest.runtime.start !== "whenNeeded") {
    throw new Error(`${label} must load when needed.`);
  }
  return projectDataShapePluginManifestSchema.parse({
    id: manifest.id,
    version: manifest.version,
    apiVersion: manifest.apiVersion,
    displayName: manifest.displayName,
    ...(manifest.description !== undefined
      ? { description: manifest.description }
      : {}),
    iconSvg: manifest.iconSvg,
    entrypoint: manifest.entrypoint,
    capabilities: { projectDataShape },
  });
}

export async function readProjectDataShapePlugin(
  directory: string,
  policy: ProjectDataShapeAdmissionPolicy = { admitPluginApi4: false },
): Promise<ResolvedProjectDataShapePlugin> {
  const pluginDirectory = path.resolve(directory);
  const canonicalPluginDirectory = await realpath(pluginDirectory);
  const manifestPath = path.join(pluginDirectory, "plugin.json");
  await assertRegularPluginFile(
    pluginDirectory,
    canonicalPluginDirectory,
    manifestPath,
    "Schema plugin manifest",
  );

  const raw: unknown = JSON.parse(await readFile(manifestPath, "utf8"));
  const manifest =
    (raw as { apiVersion?: unknown } | null)?.apiVersion === PLUGIN_API_4
      ? dataShapeOfApi4Package(raw, policy)
      : dataShapeApi1Manifest(raw);
  if (path.isAbsolute(manifest.entrypoint)) {
    throw new Error(
      `Schema plugin "${manifest.id}" entrypoint must be relative.`,
    );
  }

  const entrypointPath = path.resolve(pluginDirectory, manifest.entrypoint);
  if (!isPathInside(pluginDirectory, entrypointPath)) {
    throw new Error(
      `Schema plugin "${manifest.id}" entrypoint leaves its plugin directory.`,
    );
  }
  if (
    !ALLOWED_ENTRYPOINT_EXTENSIONS.has(
      path.extname(entrypointPath).toLowerCase(),
    )
  ) {
    throw new Error(
      `Schema plugin "${manifest.id}" entrypoint must be compiled JavaScript.`,
    );
  }
  await assertRegularPluginFile(
    pluginDirectory,
    canonicalPluginDirectory,
    entrypointPath,
    `Schema plugin "${manifest.id}" entrypoint`,
  );

  return {
    manifest,
    directory: pluginDirectory,
    entrypointPath,
  };
}
