import { processIo } from "./io.ts";
import { taskCandidates } from "./task-candidate-lookup.ts";

process.exitCode = await taskCandidates(processIo());
