import { configDefaults, defineConfig } from "vitest/config";

const windowsSpawn = "src/process-spawn/windows.test.ts";

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: "api",
          // Bound real API/process fixtures so five-second tests retain CPU time.
          maxWorkers: 4,
          exclude: [...configDefaults.exclude, windowsSpawn],
          sequence: { groupOrder: 0 },
        },
      },
      {
        test: {
          name: "windows-spawn",
          include: [windowsSpawn],
          // Real-process fuzzing must not starve the runner's grace deadlines.
          sequence: { groupOrder: 1, concurrent: false },
          maxWorkers: 1,
        },
      },
    ],
  },
});
