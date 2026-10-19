# PROTOTYPE: plugin renderer cost

**Throwaway code. Never merge it.** It lives only on the branch
`prototype/plugin-renderer-cost`. It answers one question for
[#230](https://github.com/les-cabochons/ajour/issues/230) (Windows) and
[#260](https://github.com/les-cabochons/ajour/issues/260) (macOS): how much
does one sandboxed Electron renderer per plugin cost? The numbers feed Plugin
host lifecycle (#217).

## Run it

From the repo root, after `corepack pnpm install`:

```sh
corepack pnpm --filter @ajour/desktop prototype:renderer-cost --mode all
```

That runs the full suite in about 8 minutes. No single Electron process lives
longer than about 20 seconds. Smaller runs:

```sh
corepack pnpm --filter @ajour/desktop prototype:renderer-cost --mode measure --plugins 4 --runs 5
corepack pnpm --filter @ajour/desktop prototype:renderer-cost --mode quit --plugins 8 --runs 3
corepack pnpm --filter @ajour/desktop prototype:renderer-cost --mode kill --plugins 8 --runs 3
corepack pnpm --filter @ajour/desktop prototype:renderer-cost --mode crash --plugins 8 --runs 3
corepack pnpm --filter @ajour/desktop prototype:renderer-cost --mode sharing
corepack pnpm --filter @ajour/desktop prototype:renderer-cost --mode throttle --runs 5
```

Each run writes JSON files and a `summary.md` under `results/<platform>-<arch>-<time>/`.

## What it does

`main.cjs` is the Electron main process. It:

- registers the `ajour-ext` scheme as standard and secure;
- creates N hidden `WebContentsView`s that are never attached to a window, each
  with `sandbox: true`, `contextIsolation: true`, `nodeIntegration: false` and
  its own in-memory partition `ext-<id>`;
- serves `ajour-ext://<id>/host.html` from a per-partition protocol handler. The
  page imports `plugin.js`, a trivial plugin with one `ping` call;
- talks to each page through a preload that exposes one function, `invoke`. The
  page pulls each call through `invoke` and returns the answer with the next
  `invoke`, so main times every round trip in `ipcMain.handle`;
- identifies the caller by the IPC sender and its frame origin, never by the
  payload.

`run.mjs` is the harness. It starts the repo's Electron binary directly, gives
each run a unique `--user-data-dir` in the temp folder, reads `SPIKE {json}`
lines from main's stdout, and checks the OS process list:

- Windows: `Get-CimInstance Win32_Process`, plus `Get-Process` for memory;
- macOS: `ps -A -o pid,ppid,rss,command`.

It matches spike processes by recorded PID, parent PID, and the run's
`--user-data-dir`. It kills only those PIDs (`taskkill /F /PID` on Windows,
`kill -9` on macOS), never a process by name. Main also has a 60 second
watchdog.

Modes:

- `measure`: cold start, warm latency (500 sequential calls per plugin after 50
  warm-up calls, then 200 rounds of all plugins at once), memory from
  `app.getAppMetrics()` and from the OS, three per-call renderer cycles (create,
  answer once, close), then `app.quit()`.
- `quit`: start, list processes, `app.quit()`, check the OS list right away and
  5 s later.
- `kill`: start, list processes, kill main abruptly, check right away and 5 s
  later.
- `crash`: start, `webContents.forcefullyCrashRenderer()` on one plugin, check
  that the others still answer and the crashed PID is gone, reload it, quit.
- `sharing`: 8 plugins with `--renderer-process-limit=1` in four setups: one
  partition per plugin or one shared partition, crossed with one site per plugin
  or one shared site (`plugin-N.vendor.ajour`).
- `throttle`: 4 plugins with `backgroundThrottling` on, then off.

## Windows results (#230)

`results/win32-x64-2026-10-19T01-32-56-386Z/` holds the full suite and
`results/win32-x64-2026-10-19T01-41-30-419Z/` the throttling comparison. The
resolution comment on #230 has the table.

Two Windows quirks:

- `Get-CimInstance Win32_Process` took about 4 s on that machine, and
  `taskkill /F /PID` took about 4.5 s before it terminated anything. So the
  harness polls each recorded PID every 20 ms and times deaths from main's
  observed death, not from the command.
- With Node 26.7, Electron's install script exited 0 without extracting the
  binary. If `node_modules/electron/dist` has no Electron binary, extract the
  cached zip from the Electron cache into `dist` and write `path.txt`.

## macOS results (#260)

`results/darwin-arm64-2026-10-19T02-02-42-303Z/` holds the full suite from an
Apple M2 Pro. The resolution comment on #260 has the table beside the Windows
numbers.

- `privateBytes` is Windows only, so the private memory rows stay empty on macOS.
  The harness reads each process's footprint with `footprint -j` instead. That
  is what Activity Monitor shows as Memory. RSS counts the shared Electron
  framework pages again in every process.
- Rosetta shows in two places: `arch` and `runningUnderARM64Translation` in the
  `app-ready` event, and `translated` per process in the footprint read.
- On macOS, `render-process-gone` reports `killed` for
  `forcefullyCrashRenderer()`, not `crashed` as on Windows.
- A process that is exiting shows in `ps` as `(Electron Helper)`, with no
  arguments and an RSS of 0. A sweep that matches only on `--user-data-dir`
  misses it until it is gone.
