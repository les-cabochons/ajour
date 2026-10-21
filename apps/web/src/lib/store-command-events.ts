import type {
  AjourCatalog,
  CounterName,
  EventName,
  FieldsOf,
  KindOf,
} from "@ajour/wide-events/catalog.ts";
import type { Trigger, Unit } from "@ajour/wide-events";
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

/**
 * How a store command is named: one name, or one picked from its arguments,
 * such as a pull request change by its type. `system` marks a command that
 * reacts to something other than the user, such as a sync result.
 */
export type StoreCommandSpec<Command> =
  | StoreCommandName
  | ((...args: ArgsOf<Command>) => StoreCommandName)
  | {
      name: StoreCommandName | ((...args: ArgsOf<Command>) => StoreCommandName);
      trigger: Trigger;
    };

/**
 * The store's command table: every command of the store but its reads has a
 * name, so a new command without one fails to compile.
 */
export type StoreCommandTable<
  Store,
  Reads extends keyof Store,
> = {
  readonly [Key in Exclude<keyof Store, Reads>]: StoreCommandSpec<Store[Key]>;
};

/** Successful writes of the local state, so a command knows whether it wrote. */
let writeCount = 0;

/** The command each open unit runs, so the same command inside joins it. */
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
export function countOnStoreCommand(counter: CounterName<AjourCatalog>, amount: number) {
  if (amount > 0) wideEvents.current()?.count(counter, amount);
}

/** The active unit, for the write path to record a refusal on. */
export function storeCommandUnit(): StoreCommandUnit | undefined {
  return wideEvents.current() as StoreCommandUnit | undefined;
}

/**
 * Adds a command's own fields to its event. A command folded into another
 * unit keeps its fields out of that unit's event.
 */
export function describeStoreCommand<Name extends StoreCommandName>(
  _name: Name,
  fields: FieldsOf<AjourCatalog, Name>,
) {
  (wideEvents.current() as StoreCommandUnit<Name> | undefined)?.set(fields);
}

/**
 * Runs `work` as the store command `name`, which emits one `command` event.
 * Inside another unit it folds into it, and inside the same command, such as
 * the code around a command that opened its event first to add what only it
 * knows, it joins that event. A command that writes nothing ends `noop`.
 */
export function runStoreCommand<Name extends StoreCommandName, Result>(
  name: Name,
  work: (unit: StoreCommandUnit<Name>) => Result,
  trigger: Trigger = "user",
): Result {
  const outer = wideEvents.current();
  if (outer && openCommands.get(outer) === name) {
    return work(outer as StoreCommandUnit<Name>);
  }
  return wideEvents.run(
    name,
    { kind: "command", trigger } as never,
    (unit: StoreCommandUnit<Name>) => {
      openCommands.set(unit, name);
      const writes = writeCount;
      let result: Result;
      try {
        result = work(unit);
      } catch (error) {
        // The innermost command keeps the error: it is the one that threw.
        if (
          typeof error === "object" &&
          error !== null &&
          !thrownBy.has(error)
        ) {
          thrownBy.set(error, name);
        }
        throw error;
      }
      if (unit.outcome === undefined && writeCount === writes) {
        unit.end("noop");
      }
      return result;
    },
  );
}

/**
 * Wraps each command of `store` named in `table`, in place, so each call
 * runs as its store command. A command that calls another through `this`
 * runs it inside its own.
 */
export function instrumentStoreCommands<Store extends object>(
  store: Store,
  table: Partial<Record<keyof Store, StoreCommandSpec<never>>>,
): Store {
  const commands = store as Record<string, (...args: unknown[]) => unknown>;
  for (const [key, spec] of Object.entries(table) as [
    string,
    StoreCommandSpec<(...args: unknown[]) => unknown>,
  ][]) {
    const command = commands[key]!;
    const { name, trigger } =
      typeof spec === "object" ? spec : { name: spec, trigger: "user" as const };
    commands[key] = function (this: unknown, ...args: unknown[]) {
      const resolved = typeof name === "function" ? name(...args) : name;
      return runStoreCommand(
        resolved,
        () => command.apply(this, args),
        trigger,
      );
    };
  }
  return store;
}
