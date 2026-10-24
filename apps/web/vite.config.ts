import { spawn, type ChildProcess } from "node:child_process";
import type { AddressInfo } from "node:net";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { configDefaults } from "vitest/config";
import {
  createWindowToken,
  WINDOW_TOKEN_HEADER,
} from "../api/src/window-token.ts";

const INTERNAL_APP_API_HOST = process.env.AJOUR_APP_API_HOST ?? "127.0.0.1";
const INTERNAL_APP_API_PORT = process.env.AJOUR_APP_API_PORT ?? "8787";
const apiServerEntry = path.resolve(__dirname, "../api/src/standalone.ts");

function vendorChunk(id: string) {
  if (id.includes("/exceljs/")) {
    return "excel-workbook";
  }

  return undefined;
}

/**
 * Starts the local API beside the dev server, as Electron main does in the
 * desktop app. The API answers only requests that carry this server's window
 * token, so the page calls it on its own origin, through a proxy that adds
 * the token to the page's own requests. Another site's requests are
 * cross-site, so they get none.
 */
function internalAppApiPlugin(): Plugin {
  let apiProcess: ChildProcess | null = null;
  let isStopping = false;
  const windowToken = createWindowToken();

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
    config: () => ({
      server: {
        proxy: {
          "/api": {
            target: `http://${INTERNAL_APP_API_HOST}:${INTERNAL_APP_API_PORT}`,
            configure(proxy) {
              proxy.on("proxyReq", (proxyRequest, request) => {
                proxyRequest.removeHeader(WINDOW_TOKEN_HEADER);
                // The browser sets Sec-Fetch-Site, and no page can forge it.
                if (request.headers["sec-fetch-site"] !== "same-origin") {
                  return;
                }
                proxyRequest.setHeader(WINDOW_TOKEN_HEADER, windowToken);
                // A same-origin GET carries no Origin, as the desktop
                // window's cross-origin one does. The bridge needs it.
                if (!request.headers.origin && request.headers.host) {
                  proxyRequest.setHeader(
                    "Origin",
                    `http://${request.headers.host}`,
                  );
                }
              });
            },
          },
        },
      },
    }),
    configureServer(server) {
      const { httpServer } = server;
      if (apiProcess || !httpServer) {
        return;
      }

      // Once the dev server listens, so the API knows the page's origin.
      httpServer.once("listening", () => {
        const { port } = httpServer.address() as AddressInfo;
        startApi(server, [
          `http://127.0.0.1:${port}`,
          `http://localhost:${port}`,
        ]);
      });
      httpServer.once("close", stopApi);
      process.once("SIGINT", stopApi);
      process.once("SIGTERM", stopApi);
    },
  };

  function startApi(server: ViteDevServer, pageOrigins: string[]) {
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
          AJOUR_APP_API_HOST: INTERNAL_APP_API_HOST,
          AJOUR_APP_API_PORT: INTERNAL_APP_API_PORT,
          AJOUR_APP_API_ALLOWED_ORIGINS: [
            ...pageOrigins,
            process.env.AJOUR_APP_API_ALLOWED_ORIGINS ?? "",
          ]
            .filter(Boolean)
            .join(","),
          AJOUR_APP_API_WINDOW_TOKEN: windowToken,
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
  }
}

export default defineConfig(({ command, mode }) => {
  const isDesktopMode = mode === "desktop";
  const isTestMode = mode === "test" || process.env.VITEST === "true";
  const shouldStartInternalAppApi = !isDesktopMode && !isTestMode;
  // The page calls the API through the dev server's proxy, on its own origin.
  const callsApiThroughProxy = command === "serve" && shouldStartInternalAppApi;

  return {
    define: {
      "import.meta.env.VITE_DESKTOP_SHELL": JSON.stringify(
        isDesktopMode ? "true" : "false",
      ),
      "import.meta.env.VITE_APP_API_THROUGH_PROXY": JSON.stringify(
        callsApiThroughProxy ? "true" : "false",
      ),
      // A developer's switch: AJOUR_WIDE_EVENTS=console prints the renderer's
      // wide events in the devtools console. Off by default.
      "import.meta.env.AJOUR_WIDE_EVENTS": JSON.stringify(
        process.env.AJOUR_WIDE_EVENTS ?? "",
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
      alias: [
        { find: "@", replacement: path.resolve(__dirname, "./src") },
        {
          find: /^@ajour\/shared$/,
          replacement: path.resolve(
            __dirname,
            "../../packages/shared/index.ts",
          ),
        },
        {
          // Root entry points such as @ajour/shared/agent-tools (packages/README.md).
          find: /^@ajour\/shared\/([a-z-]+)$/,
          replacement: `${path.resolve(__dirname, "../../packages/shared")}/$1.ts`,
        },
      ],
      dedupe: ["react", "react-dom", "react/jsx-runtime"],
    },
  };
});
