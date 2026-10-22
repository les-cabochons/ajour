import type {
  AjourCatalog,
  CounterName,
  EventName,
  FieldsOf,
  KindOf,
} from "@ajour/wide-events/catalog.ts";
import type { Trigger, Unit, UnitInit } from "@ajour/wide-events";
import { wideEvents } from "@/lib/wide-events";

/** The catalog's names that a store command may take: those of kind `command`. */
export type StoreCommandName = {
  [Name in EventName<AjourCatalog>]: "command" extends KindOf<
    AjourCatalog,
    Name
  >
    ? Name
    : never;
}[EventName<AjourCatalog>];

export type StoreCommandUnit<Name extends StoreCommandName = StoreCommandName> =
  Unit<AjourCatalog, Name>;

type ArgsOf<Command> = Command extends (...args: infer Args) => unknown
  ? Args
  : never;
type ResultOf<Command> = Command extends (...args: never[]) => infer Result
  ? Result
  : never;

/**
 * A store command's spec in the command table:
 *
 * - a name;
 * - `{ name, fields?, trigger? }`: `fields` reads the command's own fields
 *   from its arguments and result, typed against its name, and `system`
 *   marks a command that reacts to something other than the user, such as a
 *   sync result;
 * - `{ pick, fallback }`: a name picked from the arguments, such as a pull
 *   request change by its type, and the name to use when it can't pick one.
 */
export type StoreCommandSpec<Command> =
  | StoreCommandName
  | {
      [Name in StoreCommandName]: {
        name: Name;
        trigger?: Trigger;
        fields?: (
          args: ArgsOf<Command>,
          result: ResultOf<Command>,
        ) => FieldsOf<AjourCatalog, Name>;
      };
    }[StoreCommandName]
  | {
      pick: (...args: ArgsOf<Command>) => StoreCommandName | undefined;
      fallback: StoreCommandName;
      trigger?: Trigger;
    };

/**
 * The store's command table: every command of the store but its reads has a
 * name, so a new command without one fails to compile.
 */
export type StoreCommandTable<Store, Reads extends keyof Store> = {
  readonly [Key in Exclude<keyof Store, Reads>]: StoreCommandSpec<Store[Key]>;
};

/** Every name a spec can give its command. */
export type SpecName<Spec> = Spec extends StoreCommandName
  ? Spec
  : Spec extends { name: infer Name extends StoreCommandName }
    ? Name
    : Spec extends {
          pick: (...args: never[]) => infer Picked;
          fallback: infer Fallback;
        }
      ? Exclude<Picked, undefined> | Fallback
      : never;

/**
 * Runs store commands as one undoable action. The first command run inside
 * it gives it its name, so an agent's write is named for what it did.
 */
export const UNDO_GROUP = "undo.group" satisfies StoreCommandName;

/** Successful writes of the local state, so a command knows whether it wrote. */
let writeCount = 0;

/** The command each open store command unit runs, so the same command inside joins it. */
const openCommands = new WeakMap<object, StoreCommandName>();

/** The store command each thrown error came from, for the error handler. */
const thrownBy = new WeakMap<object, StoreCommandName>();

/** The store command that threw `error`, when one did. */
export function storeCommandThatThrew(
  error: unknown,
): StoreCommandName | undefined {
  return typeof error === "object" && error !== null
    ? thrownBy.get(error)
    : undefined;
}

/** Counts one write of the local state, and its size, on the active unit. */
export function countStoreWrite(bytes: number) {
  writeCount += 1;
  wideEvents
    .current()
    ?.count("store_write_count")
    .count("store_write_bytes", bytes);
}

/** Adds to a counter of the active unit, if any. */
export function countOnStoreCommand(
  counter: CounterName<AjourCatalog>,
  amount = 1,
) {
  if (amount > 0) wideEvents.current()?.count(counter, amount);
}

/**
 * The active unit when it is a store command's, for the write path to record
 * a refusal on. A job or a lifecycle unit is never one.
 */
export function storeCommandUnit(): StoreCommandUnit | undefined {
  const unit = wideEvents.current();
  return unit && openCommands.has(unit)
    ? (unit as StoreCommandUnit)
    : undefined;
}

/**
 * Adds a command's own fields to its event. A command folded into another
 * unit keeps its fields out of that unit's event.
 */
export function describeStoreCommand<Name extends StoreCommandName>(
  _name: Name,
  fields: FieldsOf<AjourCatalog, Name>,
) {
  (storeCommandUnit() as StoreCommandUnit<Name> | undefined)?.set(fields);
}

function commandInit<Name extends StoreCommandName>(
  trigger: Trigger,
): UnitInit<AjourCatalog, Name> {
  // Every store command name allows the kind `command`.
  return { kind: "command" as KindOf<AjourCatalog, Name>, trigger };
}

/** Records the innermost store command that threw `error`. */
function rememberThrower(error: unknown, name: StoreCommandName) {
  if (typeof error === "object" && error !== null && !thrownBy.has(error)) {
    thrownBy.set(error, name);
  }
}

/**
 * Runs `work` as the store command `name`, which emits one `command` event.
 * Inside another unit it folds into it. Inside the same command, it joins
 * that event: the code around a command opened it first to add what only it
 * knows. Inside an undo group, the first command names the group. A command
 * that writes nothing ends `noop`.
 */
export function runStoreCommand<Name extends StoreCommandName, Result>(
  name: Name,
  work: (unit: StoreCommandUnit<Name>) => Result,
  trigger: Trigger = "user",
): Result {
  const outer = wideEvents.current();
  const outerName = outer ? openCommands.get(outer) : undefined;
  if (outer && outerName === name) {
    return work(outer as StoreCommandUnit<Name>);
  }
  if (outer && outerName === UNDO_GROUP) {
    // The group's event takes the name of what it runs.
    (outer as StoreCommandUnit).rename(name as never);
    openCommands.set(outer, name);
    return work(outer as StoreCommandUnit<Name>);
  }
  return wideEvents.run(name, commandInit<Name>(trigger), (unit) => {
    openCommands.set(unit, name);
    const writes = writeCount;
    let result: Result;
    try {
      result = work(unit);
    } catch (error) {
      rememberThrower(error, name);
      throw error;
    }
    if (unit.outcome === undefined && writeCount === writes) {
      unit.end("noop");
    }
    return result;
  });
}

/**
 * Opens the store command `name` for a workflow that awaits before it runs
 * the command, such as a move that asks about subitems first. The workflow
 * runs the command inside `unit.enter()`, which joins it, and calls `finish`
 * once in every path: a unit with no outcome that wrote nothing ends `noop`.
 */
export function startStoreCommand<Name extends StoreCommandName>(
  name: Name,
  trigger: Trigger = "user",
) {
  const unit = wideEvents.start(name, commandInit<Name>(trigger));
  openCommands.set(unit, name);
  const writes = writeCount;
  return {
    unit,
    /** Records that the workflow threw `error`. */
    fail(error: unknown) {
      rememberThrower(error, name);
      unit.fail(error);
    },
    finish() {
      if (unit.outcome === undefined && writeCount === writes) {
        unit.end("noop");
      } else {
        unit.end();
      }
    },
  };
}

/** The name a spec gives a call with `args`. */
export function resolveCommandName(
  spec: StoreCommandSpec<(...args: never[]) => unknown>,
  args: readonly unknown[],
): StoreCommandName {
  if (typeof spec === "string") return spec;
  if ("name" in spec) return spec.name;
  try {
    return (
      (
        spec.pick as (
          ...args: readonly unknown[]
        ) => StoreCommandName | undefined
      )(...args) ?? spec.fallback
    );
  } catch {
    // A malformed call still emits its event, under the fallback name.
    return spec.fallback;
  }
}

/**
 * Wraps each command of `store` named in `table`, in place, so each call
 * runs as its store command and adds the fields its spec reads. A command
 * that calls another through `this` runs it inside its own.
 */
export function instrumentStoreCommands<Store extends object>(
  store: Store,
  table: Partial<Record<keyof Store, StoreCommandSpec<never>>>,
): Store {
  const commands = store as Record<string, (...args: unknown[]) => unknown>;
  for (const [key, spec] of Object.entries(table) as [
    string,
    StoreCommandSpec<(...args: never[]) => unknown>,
  ][]) {
    const command = commands[key]!;
    const trigger = (typeof spec === "object" && spec.trigger) || "user";
    const fields =
      typeof spec === "object" && "fields" in spec
        ? (spec.fields as
            ((args: unknown[], result: unknown) => object) | undefined)
        : undefined;
    commands[key] = function (this: unknown, ...args: unknown[]) {
      return runStoreCommand(
        resolveCommandName(spec, args),
        (unit) => {
          const result = command.apply(this, args);
          if (fields) unit.set(fields(args, result) as never);
          return result;
        },
        trigger,
      );
    };
  }
  return store;
}
