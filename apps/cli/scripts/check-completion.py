"""Source each generated script, then press Tab in an actual interactive shell."""
import errno
import fcntl
import os
import pathlib
import pty
import re
import select
import subprocess
import tempfile
import termios
import time

root = pathlib.Path(__file__).resolve().parents[3]


def controlling_terminal():
    os.setsid()
    fcntl.ioctl(0, termios.TIOCSCTTY, 0)


def read_until(fd, process, needle, timeout=15):
    output = b""
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if select.select([fd], [], [], 0.1)[0]:
            try:
                output += os.read(fd, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            plain = re.sub(rb"\x1b\[[0-?]*[ -/]*[@-~]", b"", output).replace(b"\r", b"")
            if needle in plain:
                return
        if process.poll() is not None:
            break
    raise AssertionError(f"Missing {needle!r} in {output!r}")


with tempfile.TemporaryDirectory(prefix="ajour-completion-") as directory:
    temp = pathlib.Path(directory)
    helper = temp / "ajour"
    helper.write_text("#!/bin/sh\nif [ \"$1 $2\" = '__complete tasks' ]; then\n  printf '%s\\n' 'acme/backend' 'other/review'\nelse\n  printf '__RESULT__%s %s\\n' \"$1\" \"$2\"\nfi\n")
    helper.chmod(0o700)
    for shell in ["bash", "zsh", "fish"]:
        script = temp / f"completion.{shell}"
        script.write_bytes(subprocess.check_output([
            "node", "--experimental-strip-types", "--no-warnings",
            "apps/cli/src/main.ts", "completion", shell,
        ], cwd=root))
        master, slave = pty.openpty()
        env = {**os.environ, "PATH": f"{temp}:{os.environ['PATH']}", "TERM": "xterm", "HOME": directory, "ZDOTDIR": directory}
        args = {"bash": ["bash", "--norc", "--noprofile", "-i"], "zsh": ["zsh", "-f", "-i"], "fish": ["fish", "--no-config", "-i"]}[shell]
        process = subprocess.Popen(args, stdin=slave, stdout=slave, stderr=slave, env=env, preexec_fn=controlling_terminal)
        os.close(slave)
        try:
            setup = "autoload -Uz compinit; compinit -u; " if shell == "zsh" else ""
            os.write(master, f"{setup}source '{script}'; echo __READY__\n".encode())
            # Require a separate line so the echoed setup command cannot satisfy it.
            read_until(master, process, b"\n__READY__\n")
            os.write(master, b"ajour start ac\t")
            # Wait for completion before Enter, as a person would.
            read_until(master, process, b"me/backend")
            os.write(master, b"\n")
            read_until(master, process, b"__RESULT__start acme/backend")
            print(f"{shell}: source and Tab completion passed", flush=True)
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            os.close(master)
