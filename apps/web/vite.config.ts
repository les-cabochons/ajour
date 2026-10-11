import { spawn, type ChildProcess } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { configDefaults } from "vitest/config";

const INTERNAL_APP_API_HOST = "127.0.0.1";
const INTERNAL_APP_API_PORT = "8787";
const apiServerEntry = path.resolve(__dirname, "../api/src/server.ts");

function vendorChunk(id: string) {
  if (id.includes("/exceljs/")) {
    return "excel-workbook";
  }

  return undefined;
}

function internalAppApiPlugin(): Plugin {
  let apiProcess: ChildProcess | null = null;
  let isStopping = false;

  const stopApi = () => {
    if (!apiProcess || apiProcess.exitCode !== null || apiProcess.killed) {
      apiProcess = null;
      return;
    }

    isStopping = true;
    apiProcess.kill("SIGTERM");
  };

  const pipePrefixedOutput = (
    stream: NodeJS.ReadableStream | null,
    logger: {
      info: (message: string) => void;
      error: (message: string) => void;
    },
    level: "info" | "error",
  ) => {
    if (!stream) {
      return;
    }

    let buffer = "";
    stream.setEncoding("utf8");
    stream.on("data", (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/u);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        logger[level](`[internal-app-api] ${trimmed}`);
      }
    });
    stream.on("end", () => {
      const trimmed = buffer.trim();
      if (trimmed) {
        logger[level](`[internal-app-api] ${trimmed}`);
      }
      buffer = "";
    });
  };

  return {
    name: "ajour-internal-app-api",
    apply: "serve",
    configureServer(server) {
      if (apiProcess) {
        return;
      }

      apiProcess = spawn(
        process.execPath,
        ["--watch", "--experimental-strip-types", apiServerEntry],
        {
          cwd: path.resolve(__dirname, "..", ".."),
          env: {
            ...process.env,
            AJOUR_APP_API_HOST:
              process.env.AJOUR_APP_API_HOST ?? INTERNAL_APP_API_HOST,
            AJOUR_APP_API_PORT:
              process.env.AJOUR_APP_API_PORT ?? INTERNAL_APP_API_PORT,
          },
          stdio: ["ignore", "pipe", "pipe"],
        },
      );

      pipePrefixedOutput(apiProcess.stdout, server.config.logger, "info");
      pipePrefixedOutput(apiProcess.stderr, server.config.logger, "error");

      apiProcess.once("exit", (code, signal) => {
        if (!isStopping && code !== 0) {
          server.config.logger.error(
            `[internal-app-api] exited unexpectedly (code: ${code ?? "null"}, signal: ${signal ?? "none"})`,
          );
        }

        apiProcess = null;
        isStopping = false;
      });

      server.httpServer?.once("close", stopApi);
      process.once("SIGINT", stopApi);
      process.once("SIGTERM", stopApi);
    },
  };
}

export default defineConfig(({ mode }) => {
  const isDesktopMode = mode === "desktop";
  const isTestMode = mode === "test" || process.env.VITEST === "true";
  const shouldStartInternalAppApi = !isDesktopMode && !isTestMode;

  return {
    define: {
      "import.meta.env.VITE_DESKTOP_SHELL": JSON.stringify(
        isDesktopMode ? "true" : "false",
      ),
    },
    plugins: [
      react(),
      tailwindcss(),
      ...(shouldStartInternalAppApi ? [internalAppApiPlugin()] : []),
    ],
    build: {
      outDir: isDesktopMode ? "dist-desktop" : "dist",
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks: vendorChunk,
        },
      },
    },
    test: {
      exclude: [...configDefaults.exclude, ".features-gen/**"],
    },
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@ajour/shared": path.resolve(
          __dirname,
          "../../packages/shared/src/index.ts",
        ),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime"],
    },
  };
});
