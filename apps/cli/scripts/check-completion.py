"""Source each generated script, then press Tab in an actual interactive shell."""
import errno
import json
import shutil
import sys
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
    (temp / "acme").mkdir()
    (temp / "acme" / "expandedEND").touch()
    helper = temp / "ajour"
    helper.write_text("#!/usr/bin/env python3\n" +
        "import json, pathlib, sys\n" +
        "root = pathlib.Path(__file__).parent\n" +
        "if sys.argv[1:] == ['__complete', 'tasks']:\n" +
        "    sys.stdout.buffer.write((root / 'candidates').read_bytes())\n" +
        "else:\n" +
        "    (root / 'result').write_text(json.dumps(sys.argv[1:]))\n" +
        "    print('__DONE__')\n")
    helper.chmod(0o700)
    shells = sys.argv[1:] or ["bash", "zsh", "fish"]
    for shell in shells:
        if not shutil.which(shell):
            raise RuntimeError(f"Required shell is unavailable: {shell}")
        script = temp / f"completion.{shell}"
        script.write_bytes(subprocess.check_output([
            "node", "--experimental-strip-types", "--no-warnings",
            "apps/cli/src/main.ts", "completion", shell,
        ], cwd=root))
        master, slave = pty.openpty()
        env = {**os.environ, "PATH": f"{temp}:{os.environ['PATH']}", "TERM": "xterm", "HOME": directory, "ZDOTDIR": directory}
        args = {"bash": ["bash", "--norc", "--noprofile", "-i"], "zsh": ["zsh", "-f", "-i"], "fish": ["fish", "--no-config", "-i"]}[shell]
        process = subprocess.Popen(args, stdin=slave, stdout=slave, stderr=slave, cwd=temp, env=env, preexec_fn=controlling_terminal)
        os.close(slave)
        try:
            setup = "autoload -Uz compinit; compinit -u; " if shell == "zsh" else ""
            os.write(master, f"{setup}source '{script}'; echo __READY__\n".encode())
            # Require a separate line so the echoed setup command cannot satisfy it.
            read_until(master, process, b"\n__READY__\n")
            marker = temp / "ajour-marker"
            candidates = [
                "acme/backendEND", "acme/05 BackendEND", "acme/single'quoteEND",
                'acme/double"quoteEND', f"acme/$(touch {marker})END",
                f"acme/`touch {marker}`END", "acme/*END", "-acme/leadingEND",
                "acme/line\nbreakEND",
            ]
            for candidate in candidates:
                (temp / "candidates").write_bytes((candidate + "\0").encode())
                prefix = "-ac" if candidate.startswith("-") else "ac"
                os.write(master, f"ajour start {prefix}\t".encode())
                read_until(master, process, b"END")
                os.write(master, b"\n")
                read_until(master, process, b"__DONE__\n")
                actual = json.loads((temp / "result").read_text())
                assert actual == ["start", candidate], (shell, candidate, actual)
                assert not marker.exists(), (shell, "command substitution executed")
            print(f"{shell}: literal Tab insertion passed for {len(candidates)} names", flush=True)
        finally:
            process.terminate()
            try:
                process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                process.kill()
                process.wait()
            os.close(master)
