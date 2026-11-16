# Plugins start processes only through Ajour's process broker

A plugin that hands a backlog item to a coding tool, such as T3 Code, Claude Code or Codex, has to start that tool's command. ADR 0007 keeps plugin code in a sandbox that can't start a process, and it has no full-access class. So, as ADR 0010 did for credentials, Ajour adds a broker: a plugin asks Ajour's **process broker** to start a command, and the broker decides, starts it and hands back what it may.

**What a plugin declares.** The manifest's `processes` block names executables by bare name, and commands built from typed argument slots: `literal`, `text`, `id`, `ref`, `number`, `enum`, `https-url` and `folder`. Access review lists each declared command, turning the plugin on approves them, and an update that adds or widens one asks again, like a new host.

**How a command starts.**
- The arguments stay a list from the plugin to the process. There is no shell, ever.
- Free text goes on stdin.
- A `folder` argument is the id of a repository folder the user added. A plugin never names a path.
- No value may start with `-`, so a value can't pass for an option.
- The broker finds an executable on the user's PATH by its name. A plugin never gives a path to run.
- A Windows `.cmd` or `.bat` file runs only the way #706 proved safe: the shim resolved to its real executable, or escaped for `cmd.exe` with whatever can't be made safe refused.
- The environment is the user's without any `AJOUR_` variable. No secret ever enters argv, stdin or the environment.

**Gates.** A command runs only while its plugin is on and the user's consent covers it. An unsigned plugin, or one from a development directory, passes two more gates:
1. **Unsigned plugins can start processes**, one switch for all plugins, which starts off.
2. An explicit acceptance on that plugin's page.

**Undeclared commands and command modes.** A plugin may ask for a command its manifest doesn't declare. Each plugin has a **command mode** that decides what happens:
- **Always ask**: every undeclared command asks, showing the exact command line and folder, with *Allow once*, *Always* and *Deny*. This is the default for unsigned and development-directory plugins.
- **Auto**: an undeclared command runs unless a rule or the command reviewer marks it risky, which asks. This is the default for signed plugins.
- **Accept everything**: every undeclared command runs, behind a red warning.

Only the user changes a mode. A plugin that loses its signature in an update drops to Always ask.

**Command review.** Ajour checks an undeclared command with a fixed rule table over its executable and arguments (deleting or formatting disks, paths outside the user's folders, shells given inline code, credential stores, sending data out). An optional local model, the **command reviewer**, labels what the rules don't decide. It is downloaded only when the user asks, never bundled, and #708 chooses it. **Rules and the reviewer only add friction:** neither may turn a refusal or an ask into a run.

**How a command runs.** `capture` waits for the command, with bounded output and time, and gives the plugin its exit code and output. `detached` starts a process Ajour doesn't own. `terminal` opens the user's terminal app on the command. A plugin may also open an https address, or a link in a URL scheme its manifest declares, such as `codex:`. Links inside content stay blocked, as #331 decided.

## Considered options

- **A full-access class of trusted plugins.** Rejected. It reopens what ADR 0007 closed, and a signature says who published a plugin, not what its code does.
- **Built-in launchers in Ajour, with no plugin.** Rejected. Every new coding tool would need an Ajour release, and other plugins could never start a process.
- **Run commands through a shell or PowerShell.** Rejected. A shell reads the arguments again, and a ticket title can then break out of its quotes. On Windows, PowerShell hands a `.cmd` to `cmd.exe` the same way, as we checked on #704.
- **A model as the only check.** Rejected. A model can be talked into "safe" by the text it reads, and its answers aren't repeatable. It sits behind the fixed checks and can only add friction.

## Consequences

- G1 now holds only for plugins that start no process. The broker hands no secret to a process: none enters argv, stdin or the environment. But a process runs as the user, and on Windows DPAPI protects the vault from other users, not from the user's own programs. So a plugin allowed to run an arbitrary command can read what the vault holds. Two measures narrow that:
  - The rules mark any argument that names Ajour's own data folder risky.
  - The `folder` slot can never be that folder.

  Auto still asks for the commands the rules catch, but a command they don't recognise runs. Accept everything gives G1 up for that plugin. Access review and the command mode's warning say this in plain words, and a release claims G1 only for plugins without process access.
- G2 widens and Access review says so plainly: under Auto and Accept everything, a plugin runs commands nobody approved one by one, as the user and outside the sandbox. A command a plugin starts can do whatever the user can.
- Declared commands are part of a plugin's access, so the consent record and Access review list them, and an update that adds one starts off until the user approves it again.
- Each command emits one `plugin.process` event: the command id, outcome, exit code, duration, the matching rule's id, the reviewer's label and score, and what decided. It never holds argv text, stdin or a path (ADR 0011).
- The fix for `.cmd` CLIs is shared with the agent runner (#262, #350).
- Plugins are off on Linux (ADR 0007), so no plugin starts a process there until #626.
