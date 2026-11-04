import { createContext } from "./context.ts";
import { processIo } from "./io.ts";

const io = processIo();
io.homedir = io.env.AJOUR_COMPLETION_HOME || io.homedir;
const ctx = createContext(io, { color: "never", json: false, quiet: true });
try {
  const { projects } = await (await ctx.client()).call("list_projects", {});
  const tasks = projects
    .flatMap((project) =>
      project.tasks.map(
        (task) => `${project.code?.trim() || project.name}/${task.name}`,
      ),
    )
    .filter((task) => !/[\x00-\x09\x0b-\x1f\x7f]/.test(task));
  io.stdout.write(tasks.join("\0") + (tasks.length ? "\0" : ""));
} catch {
  process.exitCode = 1;
} finally {
  await ctx.close().catch(() => undefined);
}
