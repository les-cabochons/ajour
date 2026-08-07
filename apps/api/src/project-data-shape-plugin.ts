import path from "node:path";
import { lstat, readFile, realpath } from "node:fs/promises";
import {
  PROJECT_DATA_SHAPE_PLUGIN_API_VERSION,
  projectDataShapePluginManifestSchema,
  type ProjectDataShapePluginManifest,
} from "../../../packages/shared/src/project-data-shapes.ts";

const ALLOWED_ENTRYPOINT_EXTENSIONS = new Set([".cjs", ".js", ".mjs"]);

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

export async function readProjectDataShapePlugin(
  directory: string,
): Promise<ResolvedProjectDataShapePlugin> {
  const pluginDirectory = path.resolve(directory);
  const canonicalPluginDirectory = await realpath(pluginDirectory);
  const manifestPath = path.join(pluginDirectory, "plugin.json");
  await assertRegularPluginFile(
    pluginDirectory,
    canonicalPluginDirectory,
    manifestPath,
    "Project data shape plugin manifest",
  );

  const manifest = projectDataShapePluginManifestSchema.parse(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  if (manifest.apiVersion !== PROJECT_DATA_SHAPE_PLUGIN_API_VERSION) {
    throw new Error(
      `Project data shape plugin "${manifest.id}" requires API version ${manifest.apiVersion}; this app supports version ${PROJECT_DATA_SHAPE_PLUGIN_API_VERSION}.`,
    );
  }
  if (path.isAbsolute(manifest.entrypoint)) {
    throw new Error(
      `Project data shape plugin "${manifest.id}" entrypoint must be relative.`,
    );
  }

  const entrypointPath = path.resolve(pluginDirectory, manifest.entrypoint);
  if (!isPathInside(pluginDirectory, entrypointPath)) {
    throw new Error(
      `Project data shape plugin "${manifest.id}" entrypoint leaves its plugin directory.`,
    );
  }
  if (
    !ALLOWED_ENTRYPOINT_EXTENSIONS.has(
      path.extname(entrypointPath).toLowerCase(),
    )
  ) {
    throw new Error(
      `Project data shape plugin "${manifest.id}" entrypoint must be compiled JavaScript.`,
    );
  }
  await assertRegularPluginFile(
    pluginDirectory,
    canonicalPluginDirectory,
    entrypointPath,
    `Project data shape plugin "${manifest.id}" entrypoint`,
  );

  return {
    manifest,
    directory: pluginDirectory,
    entrypointPath,
  };
}
