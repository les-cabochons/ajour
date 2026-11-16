# Plugins start processes only through Ajour's process broker

A plugin that hands a backlog item to a coding tool, such as T3 Code, Claude Code or Codex, has to start that tool's command. ADR 0007 keeps plugin code in a sandbox that can't start a process, and it has no full-access class. So, as ADR 0010 did for credentials, Ajour adds a broker: a plugin asks Ajour's **process broker** to start a command, and the broker decides, starts it and hands back what it may.

**What a plugin declares.** The manifest's `processes` block names executables by bare name, and commands built from typed argument slots: `literal`, `text`, `id`, `ref`, `number`, `enum`, `https-url` and `folder`. Access review lists each declared command, turning the plugin on approves them, and an update that adds or widens one asks again, like a new host.

**How a command starts.**

- The arguments stay a list from the plugin to the process. There is no shell, ever.
- Free text goes on stdin.
- A `folder` argument is the id of a repository folder the user added. A plugin never names a path.
- A declared argument value cannot start with `-`. An undeclared command allows it because the ask shows every argument.
- The broker finds an executable on the user's PATH by its name. A plugin never gives a path to run.
- A Windows `.cmd` or `.bat` file runs only the way #706 proved safe: the shim resolved to its real executable, or escaped for `cmd.exe` with whatever can't be made safe refused.
- The environment is the user's without any `AJOUR_` variable. No secret ever enters argv, stdin or the environment.

**Gates.** A command runs only while its plugin is on and the user's consent covers it. An unsigned plugin, or one from a development directory, passes two more gates:

1. **Unsigned plugins can start processes**, one switch for all plugins, which starts off.
2. An explicit acceptance on that plugin's page.

**Undeclared commands and command modes.** A plugin may ask for a command its manifest doesn't declare. Each plugin has a **command mode** that decides what happens:

- **Always ask**: every undeclared command asks, showing the exact command line and folder, with _Allow once_, _Always_ and _Deny_. This is the default for unsigned and development-directory plugins.

  _Always_ remembers the exact executable name, every argument and the folder id, nothing broader. A remembered approval stops counting when the plugin's version or package changes, when it loses its signature, or when its development directory changes. The package identity is the one the unsigned process gates use. The Access tab lists each approval with Remove. The ask shows exactly that line, so what the user approves and what runs stay identical. Decided in #716.

- **Auto**: an undeclared command runs only when Ajour knows it is read-only; anything else asks. This is the default for signed plugins.
- **Accept everything**: every undeclared command runs, behind a red warning.

Only the user changes a mode. A plugin that loses its signature in an update drops to Always ask.

**Command review.** Ajour checks an undeclared command with a fixed rule table over its executable, arguments and folder. **The rules mark commands safe only from a short allowlist of read-only commands; anything else counts as risky in Auto.** The allowlist holds git's read-only subcommands (`status`, `diff`, `log`, `show`, `rev-parse`, `ls-files`, `blame`, `describe`, and `branch` when it only lists) run in a repository folder with no global option, `pwd`, `whoami`, and `--version` alone for a short list of programs that print it without reading the project (git, node, python, python3, py, gh, t3, claude, codex, opencode, copilot and code). Each entry parses its arguments strictly: an option it doesn't list by its exact spelling, a long option's prefix or an attached short value it doesn't spell takes the command off the allowlist. Only `name` or `name.exe` matches an entry; `git.cmd`, `git.bat` or `git.com` is another program.

Danger rules name why a command is risky, so the ask can say so: shells and interpreters given inline code, Ajour's own folders, credential stores, erasing or formatting disks, bulk deletes outside a repository folder, sending data out, installing software, changing system settings or accounts, changing or deleting something on a remote service, running as an administrator, starting another program it can't check, paths outside the plugin's repository folders, downloads, and history rewrites (`git push --force` or `--delete`, `git reset --hard`, `git clean -fdx`, `git branch -D`). Any other command is risky as `unknown`: "Ajour doesn't know what this command does, so it asks."

#717 first shipped the table as a denylist that let any command no rule named run in Auto. Round 1 of its review (#740) found dozens of ways around it that ran for real: `git clone -c core.hooksPath=…`, attached short values such as `curl -o/home/u/.bashrc`, long-option prefixes such as `--upload-pac=`, `tar --to-command=`, `uvx`, wrappers such as `caffeinate` and `flock -c`, `sed e`, `vim -c !`, `gh repo delete` and `terraform destroy`. A denylist over arbitrary commands can't be made complete, so the table became allowlist-first. Auto now asks more often, for `npm test` as for anything else it doesn't know; a remembered _Always_ approval covers a command the plugin runs again.

Round 2 found that read-only commands still read files a repository can commit. `git -C <subfolder> status` used a bare repository committed in the subfolder and ran its `core.fsmonitor`; `--version` loads `conftest.py` in pytest, Corepack's chosen yarn or pnpm, `.mvn/` in Maven, the project's own `gradlew`, go.mod's toolchain and `rust-toolchain.toml`; `%G` format atoms start gpg; and `ls` follows a symlink out of the folder. So git takes no global option, `-C` included, `--version` counts only for the named programs, a `--format` or `--pretty` value with `%G` or an unknown `%(…)` atom is left out, and `ls` and `dir` left the allowlist. The broker also starts every git child, declared or undeclared, with `safe.bareRepository=explicit` (appended to any `GIT_CONFIG_COUNT` entries Ajour's environment has) and `GIT_OPTIONAL_LOCKS=0`.

An optional local model, the **command reviewer**, labels what the rules don't decide. It is downloaded only when the user asks, never bundled, and #708 chooses it. **Rules and the reviewer only add friction:** neither may turn a refusal or an ask into a run, so the reviewer can't take a command off `unknown` either.

**How a command runs.** `capture` waits for the command, with bounded output and time, and gives the plugin its exit code and output. `detached` starts a process Ajour doesn't own. `terminal` opens the user's terminal app on the command. A plugin may also open an https address in the user's browser while it is on.

It may also open a link in a URL scheme its manifest declares, such as `codex:`. Such a link starts a local app, so declared schemes are part of the plugin's access: Access review lists them, and an update that adds one starts off until the user approves it again. They also pass the same gates as commands: an unsigned or development-directory plugin opens one only after the switch and the per-plugin acceptance.

Links inside content stay blocked, as #331 decided. That rule is about what a page shows, not about what a plugin asks the broker to open.

## Considered options

- **A full-access class of trusted plugins.** Rejected. It reopens what ADR 0007 closed, and a signature says who published a plugin, not what its code does.
- **Built-in launchers in Ajour, with no plugin.** Rejected. Every new coding tool would need an Ajour release, and other plugins could never start a process.
- **Run commands through a shell or PowerShell.** Rejected. A shell reads the arguments again, and a ticket title can then break out of its quotes. On Windows, PowerShell hands a `.cmd` to `cmd.exe` the same way, as we checked on #704.
- **A model as the only check.** Rejected. A model can be talked into "safe" by the text it reads, and its answers aren't repeatable. It sits behind the fixed checks and can only add friction.

## Consequences

- **G1 holds only for plugins that start no process.** The broker hands no secret to a process: none enters argv, stdin or the environment. But a process runs as the user, and what it can reach depends on the system:
  - **Windows.** DPAPI protects the vault from other users, not from the user's own programs. A process the user runs can read `app-api-vault.json` and decrypt it.
  - **macOS.** The keychain asks before another app reads Ajour's key, which is stronger. But two paths are established:
    - Release builds keep the run-as-node fuse on (#415), so a process can start Ajour's own binary as Node, and the keychain trusts that binary.
    - The renderer and local API load from loose files in the install folder, outside `app.asar`'s integrity check, so a process can change code Ajour runs at its next launch.

    Any other decryption path on macOS is unverified.

  So a plugin with process access, through a declared command or in any command mode, can reach every plugin's credentials, not only its own. A declared command whose executable runs code it is given, such as `node` or `python`, is as wide as Accept everything.

  Two measures narrow this, and neither closes it:
  - The rules mark any argument that names Ajour's own data, install or command folder risky.
  - The `folder` slot can never be either folder.

  Access review and the command mode's warning say this in plain words, and a release claims G1 only for plugins without process access.

- **Auto still trusts the repository's own git configuration.** An allowlisted git command reads `.git/config`, which can name a program git runs, such as `core.fsmonitor`, a diff driver or `log.showSignature`. Git never commits that file, so only the user or a command they approved writes it. Committed files can carry configuration too, such as an embedded bare repository or a tool's config file, so the allowlist leaves out anything that reads configuration beyond git's own repository config, and the broker refuses bare repositories git would find by itself.
- G2 widens and Access review says so plainly: under Auto and Accept everything, a plugin runs commands nobody approved one by one, as the user and outside the sandbox. A command a plugin starts can do whatever the user can.
- Declared commands are part of a plugin's access, so the consent record and Access review list them, and an update that adds one starts off until the user approves it again.
- Each command emits one `plugin.process` event: the command id, outcome, exit code, duration, the matching rule's id, the reviewer's label and score, and what decided. It never holds argv text, stdin or a path (ADR 0011).
- The fix for `.cmd` CLIs is shared with the agent runner (#262, #350).
- Plugins are off on Linux (ADR 0007), so no plugin starts a process there until #626.
