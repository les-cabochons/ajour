import { connect } from "node:net";

/** Hidden byte relay. Its stdout belongs exclusively to the caller's HTTP stream. */
export async function relay(args: readonly string[]): Promise<number> {
  const [port] = args;
  if (
    args.length !== 1 ||
    !port ||
    !/^\d+$/.test(port) ||
    Number(port) < 1 ||
    Number(port) > 65535
  ) {
    process.stderr.write(
      "Invalid relay port. Expected an integer from 1 to 65535.\n",
    );
    return 2;
  }
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port: Number(port) });
    const finish = (code: number) => {
      process.stdin.unpipe(socket);
      process.stdin.pause();
      process.stdin.off("end", onEnd);
      process.stdin.off("close", onEnd);
      socket.destroy();
      resolve(code);
    };
    const onEnd = () => finish(0);
    socket.on("error", () => {
      process.stderr.write("Relay connection failed.\n");
      finish(1);
    });
    socket.on("end", onEnd);
    socket.on("close", onEnd);
    process.stdin.on("end", onEnd);
    process.stdin.on("close", onEnd);
    process.stdin.pipe(socket);
    socket.pipe(process.stdout);
  });
}
