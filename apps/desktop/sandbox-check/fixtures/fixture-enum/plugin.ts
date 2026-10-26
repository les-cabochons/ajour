// A plugin whose import graph holds a file main can't strip: `status.ts`
// declares an enum. `first.ts` comes first and calls Ajour as it loads, so
// the check sees whether any module of the graph ran.
import "./first.ts";
import { Status } from "./status.ts";

export function status(): Status {
  return Status.Open;
}
