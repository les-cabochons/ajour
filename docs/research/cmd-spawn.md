# Windows command shim spawning

Prototype for [#706](https://github.com/les-cabochons/ajour/issues/706), part of
[#704](https://github.com/les-cabochons/ajour/issues/704). This branch is an isolated
experiment. It does not change the agent runner or wire a process broker into the app.

## Recommendation

Resolve a recognized shim into a native executable, literal prefix arguments and
its child environment. Spawn that result with `shell: false` and Node's default
Windows quoting. Refuse unknown or changed batch files. Do not provide an automatic
`cmd.exe` fallback. Prefer stdin for prompts where a CLI supports it.

This removes the command interpreter from argument delivery. It does not authorize
a command or sandbox the program being started. The broker still owns executable
approval, allowed argument shapes, environment filtering and working directories.
Values starting with `-` remain unchanged here; policy decides whether a slot allows them.

## Why a shell is insufficient

Node's [April 2024 security release](https://nodejs.org/en/blog/vulnerability/april-2024-security-releases-2)
changed Windows batch spawning to fail with `EINVAL` without a shell, following
CVE-2024-27980. Node's [child process implementation](https://github.com/nodejs/node/blob/main/lib/child_process.js)
joins arguments with spaces for `shell: true`; it does not escape them. See also
[DEP0190](https://github.com/nodejs/node/blob/main/doc/api/deprecations.md#dep0190-passing-args-to-nodechild_process-execfilespawn-with-shell-option).

A batch shim forwards `%*` into another command line. Its caller's quoting has to
survive both interpretations. PowerShell launching the same batch file does not
remove those interpretations. The injection reproduction in the ticket is supplied
evidence; this prototype measures its own direct-spawn and escaping paths.

## Strategy A and the module contract

`apps/api/src/process-spawn/index.ts` exports synchronous
`resolveSpawn(executablePath, argv, env)`. It returns a fresh
`{ command, args, env }` or `{ refused: reason }`. It reads shim text but never
executes it. No dependency was added. Usage:

```ts
const plan = resolveSpawn(executablePath, argv, approvedEnv);
if ("refused" in plan) return plan;
const child = spawn(plan.command, plan.args, {
  env: plan.env,
  shell: false,
  windowsHide: true,
});
```

Pass cancellation, cwd, stdio and lifecycle options from the broker. Never append
`shell: true` or override the resolved arguments. The module leaves
`windowsVerbatimArguments` unset so libuv performs CRT quoting.

On Windows the input must be an absolute path. Native `.exe` paths pass directly.
Batch files must match a complete supported template. Matching normalizes CRLF
and removes trailing whitespace, but does not ignore unknown commands or scan
only the last line. It reads afresh each call and has no stale detection cache.

Supported template subsets, captured from the linked primary sources:

- npm [cmd-shim](https://github.com/npm/cmd-shim/blob/main/lib/index.js): the
  `find_dp0`, `_prog`, `endLocal` Node template without extra shebang options or
  environment assignments. Resolve adjacent `node.exe`, otherwise absolute PATH
  entries containing `node.exe`. Resolve the script relative to the shim.
- pnpm [cmd-shim](https://github.com/pnpm/cmd-shim/blob/main/src/index.ts): the
  `@SETLOCAL` local-Node/else-Node template, including optional conditional
  `NODE_PATH` prefixing. Preserve its expanded environment text, including doubled
  separators and `..`. The fallback branch removes `.JS` from PATHEXT as the shim does.
- Yarn Classic [portable proxy](https://github.com/yarnpkg/yarn/blob/master/src/util/portable-script.js):
  a one-line quoted executable with quoted literal prefix arguments and `%*`,
  without extra environment assignments.
- Yarn Berry [path wrapper](https://github.com/yarnpkg/berry/blob/master/packages/yarnpkg-core/sources/scriptUtils.ts):
  its `goto/title/setlocal` prefix followed by the quoted executable and quoted
  literal arguments. Embedded quote encoding and environment expansions are refused.
- T3's installed desktop shim: the complete observed template, including
  `T3CODE_CLI_PATH`, conditional `T3CODE_HOME`, `ELECTRON_RUN_AS_NODE=1` and
  `T3CODE_DESKTOP_CLI_LAUNCHER=1`. Case-insensitive environment updates avoid leaving
  duplicate flag names. The executable must exist. An ASAR script is checked through
  its archive file because ordinary Node cannot stat a path inside that archive.

These are versioned template subsets, not claims to recognize every shim a package
manager has ever generated. Custom interpreter flags, arbitrary `set` commands,
pnpm custom runtime/path options, different whitespace layouts and changed
prologues fail closed. Adjacent Node wins over PATH. Lookup never searches the
current working directory, applies PATHEXT or recurses into another shim.

## Refusals

Direct spawning accepts `%`, `!`, CR, LF, quotes, tabs, metacharacters, empty
strings, Unicode and values starting with `-` as argument data. It refuses:

- NUL in executable, argv or environment values, on every OS.
- Lone UTF-16 surrogates in Windows executable/argv strings, since the UTF-8
  recorder cannot preserve them.
- A Windows command line whose conservative CRT quoting bound exceeds 32,767
  UTF-16 code units, including the terminating NUL. This can refuse some values
  that would fit with shorter quoting. Both tested 8,500-character values fit.
  The limit comes from [CreateProcessW](https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw).
- Relative Windows executable paths, non-`.exe` resolved targets, unreadable batch
  files, shim files over 64 KiB, unmatched templates and missing required targets.
- Unresolved environment expansions, `%`, `!`, quotes or control characters in
  captured shim paths. These restrictions apply to template metadata, not argv.

Non-Windows execution returns the original command, argv values and environment,
with the NUL check above. No shell is introduced. Its OS-specific test is skipped
on Windows and has not been run here.

## Strategy B experiment

Read [cross-spawn's escaping code](https://github.com/moxystudio/node-cross-spawn/blob/master/lib/util/escape.js)
and [command parser](https://github.com/moxystudio/node-cross-spawn/blob/master/lib/parse.js).
Its parser chooses double escaping from a `node_modules/.bin/*.cmd` pathname
pattern. Global shims and T3 can live elsewhere. A pathname does not describe a
batch file's full behavior. Adding this dependency would not meet this contract.

`fallback.test.ts` independently implements a research-only CRT quoting and caret
escaping candidate. It invokes an absolute system `cmd.exe /d /s /c`, with
`windowsVerbatimArguments: true`. It refuses `%`, `!`, CR, LF, NUL and values over
7,000 characters before invocation. The command and argument metacharacters are
caret-escaped; the argument escape is optionally applied twice.

On one known `node script %*` shim, of 18 samples:

- One escape pass delivered 11 exactly, refused six, and changed one hostile
  quote/redirection value. No canary ran.
- Two escape passes delivered all 12 permitted samples exactly and refused six.
  No canary ran.

This is bounded evidence for that shim. It does not prove arbitrary `call`,
`%1`, delayed expansion, nested shims or argument transformations safe. Even plain
`safe` can be changed by an unknown batch file with `node script changed-%1`.
No escaping can enforce faithful delivery through arbitrary executable batch code.
Consequently Strategy B is not exported, and unknown formats are refused.
The [documented cmd.exe limit](https://learn.microsoft.com/en-us/troubleshoot/windows-client/shell-experience/command-line-string-limitation)
is 8,191 characters after expansion. A future fallback would have to bound the
fully escaped command and its expansions, rather than just the original value.

## Windows regression and fuzz results

Windows 11, Node v26.12.1, pnpm 10.7.0, Vitest 4.1.5. The fixture directory has
spaces, `&` and a non-ASCII character. Each of six shim forms received a deterministic
433-value corpus, seeded with 706: 400 generated combinations plus 33 fixed edge
cases. Each value was first resolved independently. Accepted small values then ran
in batches of 20, with long values running alone. The recorder wrote received argv
and environment as JSON to a file. Tests compare exact strings and argument
boundaries. Multiple payloads would write a canary file if interpreted as commands.

Each format delivered 430 values exactly and refused three, NUL, a lone surrogate
and a 33,000-character value. Across six forms that is 2,580 exact deliveries and
18 refusals, with zero canary files. Twenty-four template mutations, four per
format, were refused. Recognized `.bat` variants also launch the recorder. Tests
cover conditional environment flags, existing T3 home, NODE_PATH and adjacent Node
versus no Node on PATH. Temporary fixtures and outputs are removed after tests.

The real `C:\Users\alext\.t3\bin\t3.cmd` resolved successfully. A separate smoke
probe ran its resolved Electron executable with the ASAR CLI script and `--help`.
It exited 0, printed T3 usage and produced no stderr. It created no thread.
The regression test itself only resolves that installed shim when present.

## Timings

One measured focused run, 25 recorder processes per format, small values batched.
Resolution includes file IO and target checks; spawn time includes child startup,
script execution, output IO and child exit. These are local observations, not
budgets or measurements of a packaged Ajour broker.

| Format              | Mean resolution ms | Mean spawn-to-exit ms | Max spawn-to-exit ms |
| ------------------- | -----------------: | --------------------: | -------------------: |
| npm                 |              0.642 |                69.334 |               80.861 |
| pnpm                |              0.633 |                59.166 |               62.954 |
| pnpm with NODE_PATH |              0.698 |                59.364 |               67.256 |
| Yarn Classic        |              0.222 |                57.190 |               62.958 |
| Yarn Berry          |              0.211 |                55.110 |               61.132 |
| T3 fixture          |              0.625 |                58.845 |               76.762 |

## Verification and limits

Dependencies installed with `just --shell "C:/Program Files/Git/bin/sh.exe" install`.
Plain `just install` could not locate `sh`. Prettier ran only on changed files.
Focused tests use `corepack pnpm --filter @ajour/api exec vitest run src/process-spawn`.
The final focused run passed 19 tests and skipped the one non-Windows test.
`just typecheck`, with the same shell override, passed workspace TypeScript checks
and the package boundary check. No full test suite or packaged Electron broker
acceptance test was run. This prototype does not introduce operational logging.

The proof is empirical for the recorded corpus and recognized templates. Arbitrary
native executables can parse the Windows command line differently from the CRT,
and a CLI can itself interpret a title as code. The broker must approve the real
executable and its prefix, and must not grant arbitrary interpreter invocation.
An argv array cannot make `cmd.exe /c`, `node -e` or a tool's own execution options
safe by itself. Hostile same-user replacement of executables or scripts between
resolution and spawn remains outside this module's guarantee. The environment
must be broker-approved too, especially `NODE_OPTIONS` and loader variables.

Future shim variants need a captured fixture, exact template semantics and this
suite before acceptance. No generic batch interpreter should be added silently.

## Reuse for #262 and #350

The [runner's .cmd failures](https://github.com/les-cabochons/ajour/issues/262) and
[related Windows runner issue](https://github.com/les-cabochons/ajour/issues/350)
should call this resolver after `findExecutable`, then pass its command, args and
environment into the existing spawn lifecycle with `shell: false`. Keep their
current cwd, cancellation, output limits and tool policy. Surface a refusal as an
unsupported shim with a recommendation to configure the real executable/script.
Use the same core module in the new process broker. Do not fork separate escaping
logic into adapters, and do not fall back to a shell after refusal.
