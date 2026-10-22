import type {
  AjourCatalog,
  CounterName,
  EventName,
  Field,
  FieldsOf,
  KindOf,
  ReasonOf,
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

/** Why a store command was refused: a write refusal, or an Undo's reason. */
export type StoreCommandReason = ReasonOf<AjourCatalog, "undo.restore">;

type ArgsOf<Command> = Command extends (...args: infer Args) => unknown
  ? Args
  : never;
type ResultOf<Command> = Command extends (...args: never[]) => infer Result
  ? Result
  : never;

type TreeOf<Name extends StoreCommandName> =
  AjourCatalog["events"][Name]["fields"];

/**
 * How a command reads its event's fields: the catalog's field tree for its
 * name, with a function in place of each field. It is an object literal in
 * the table, so a field the catalog doesn't declare fails to compile.
 */
export type FieldReaders<Tree, Input> = {
  readonly [Key in keyof Tree]?: Tree[Key] extends Field<infer Value>
    ? (input: Input) => Value | undefined
    : FieldReaders<Tree[Key], Input>;
};

/**
 * A store command's spec in the command table:
 *
 * - a name;
 * - `{ name, fields?, resultFields?, trigger? }`: `fields` reads the
 *   command's fields from its arguments, before it runs, so a refused
 *   command keeps them; `resultFields` reads the rest from its result.
 *   `system` and `agent` say who starts the command when no outer unit does;
 * - `{ pick, fallback, fields? }`: a name picked from the arguments, such as
 *   a pull request change by its type, the name to use when it can't pick
 *   one, and the fields every name it picks shares, typed against the
 *   fallback's.
 */
export type StoreCommandSpec<Command> =
  | StoreCommandName
  | {
      [Name in StoreCommandName]: {
        name: Name;
        trigger?: Trigger;
        fields?: FieldReaders<TreeOf<Name>, ArgsOf<Command>>;
        resultFields?: FieldReaders<TreeOf<Name>, ResultOf<Command>>;
      };
    }[StoreCommandName]
  | {
      [Fallback in StoreCommandName]: {
        pick: (...args: ArgsOf<Command>) => StoreCommandName | undefined;
        fallback: Fallback;
        trigger?: Trigger;
        fields?: FieldReaders<TreeOf<Fallback>, ArgsOf<Command>>;
      };
    }[StoreCommandName];

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
 * Runs store commands as one undoable action. The first command inside it
 * that writes gives it its name, so an agent's write is named for what it
 * did.
 */
export const UNDO_GROUP = "undo.group" satisfies StoreCommandName;

/** The command each open store command unit runs, so the same command inside joins it. */
const openCommands = new WeakMap<object, StoreCommandName>();

/** The writes each open store command unit made, its own and its inner commands'. */
const unitWrites = new WeakMap<object, number>();

/** The store command units running now, outermost first: a write counts for each. */
const runningCommands: object[] = [];

function runningAs<Result>(unit: object, work: () => Result): Result {
  runningCommands.push(unit);
  try {
    return work();
  } finally {
    runningCommands.pop();
  }
}

/** The reason each refused store command unit was refused for. */
const refusals = new WeakMap<object, StoreCommandReason>();

/** The commands running inside an undo group that has no name yet, innermost last. */
const pendingGroupNames: StoreCommandName[] = [];

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

/**
 * Counts one write of the local state, and its size, on the active unit, and
 * that the active store command wrote. An undo group without a name yet
 * takes the name of the command that wrote.
 */
export function countStoreWrite(bytes: number) {
  for (const running of runningCommands) {
    unitWrites.set(running, (unitWrites.get(running) ?? 0) + 1);
  }
  const unit = wideEvents.current();
  if (!unit) return;
  unit.count("store_write_count").count("store_write_bytes", bytes);
  const writer = pendingGroupNames.at(-1);
  if (openCommands.get(unit) === UNDO_GROUP && writer) {
    (unit as StoreCommandUnit).rename(writer as never);
    openCommands.set(unit, writer);
  }
}

/** Adds to a counter of the active unit, if any. */
export function countOnStoreCommand(
  counter: CounterName<AjourCatalog>,
  amount = 1,
) {
  if (amount > 0) wideEvents.current()?.count(counter, amount);
}

/**
 * The active unit when it is a store command's. A job or a lifecycle unit is
 * never one.
 */
export function storeCommandUnit(): StoreCommandUnit | undefined {
  const unit = wideEvents.current();
  return unit && openCommands.has(unit)
    ? (unit as StoreCommandUnit)
    : undefined;
}

/**
 * Records that the active store command was refused, and why. A failure
 * attached later keeps the refusal.
 */
export function refuseStoreCommand(reason: StoreCommandReason) {
  const unit = storeCommandUnit();
  if (!unit) return;
  refusals.set(unit, reason);
  (unit as StoreCommandUnit<"undo.restore">).refuse(reason);
}

/** Attaches `error` to `unit`, keeping a refusal it already recorded. */
function attachError(unit: StoreCommandUnit, error: unknown) {
  const refusal = refusals.get(unit);
  unit.fail(error);
  if (refusal) (unit as StoreCommandUnit<"undo.restore">).refuse(refusal);
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
 * knows. Inside an undo group, it joins the group, and names it if it
 * writes. A command that writes nothing ends `noop`.
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
    pendingGroupNames.push(name);
    try {
      return work(outer as StoreCommandUnit<Name>);
    } finally {
      pendingGroupNames.pop();
    }
  }
  return wideEvents.run(name, commandInit<Name>(trigger), (unit) => {
    openCommands.set(unit, name);
    let result: Result;
    try {
      result = runningAs(unit, () => work(unit));
    } catch (error) {
      rememberThrower(error, name);
      throw error;
    }
    if (unit.outcome === undefined && !unitWrites.get(unit)) {
      unit.end("noop");
    }
    return result;
  });
}

/**
 * Opens the store command `name` for a workflow that awaits before it runs
 * the command, such as a move that asks about subitems first. The workflow
 * runs the command inside `enter`, which joins it, and calls `finish` once
 * in every path. Only the writes made inside `enter` count as its own, so
 * another command's write meanwhile can't make it `ok`: with no outcome and
 * no write of its own, it ends `noop`, unless the workflow did its work
 * elsewhere, such as on the local API, and said so with `didWork`.
 */
export function startStoreCommand<Name extends StoreCommandName>(
  name: Name,
  trigger: Trigger = "user",
) {
  const unit = wideEvents.start(name, commandInit<Name>(trigger));
  openCommands.set(unit, name);
  let worked = false;
  return {
    unit,
    /** Runs `work` inside the command's event. */
    enter<Result>(work: () => Result): Result {
      return unit.enter(() => runningAs(unit, work));
    },
    /** The workflow changed something outside the local state. */
    didWork() {
      worked = true;
    },
    /** Records that the workflow threw `error`, keeping a refusal. */
    fail(error: unknown) {
      rememberThrower(error, name);
      attachError(unit as StoreCommandUnit, error);
    },
    finish() {
      if (unit.outcome === undefined && !worked && !unitWrites.get(unit)) {
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

type Readers = {
  readonly [key: string]: Readers | ((input: never) => unknown);
};

/** The fields `readers` read from `input`, leaving out what they can't read. */
function readFields(readers: Readers, input: unknown) {
  const fields: Record<string, unknown> = {};
  let empty = true;
  for (const key in readers) {
    const reader = readers[key]!;
    let value: unknown;
    if (typeof reader === "function") {
      try {
        value = (reader as (input: unknown) => unknown)(input);
      } catch {
        // A malformed call can't break its command: the field stays out.
        value = undefined;
      }
    } else {
      value = readFields(reader, input);
    }
    if (value !== undefined) {
      fields[key] = value;
      empty = false;
    }
  }
  return empty ? undefined : fields;
}

/**
 * Wraps each command of `store` named in `table`, in place, so each call
 * runs as its store command, with the fields its spec reads: from the
 * arguments before it runs, and from the result after. A command that calls
 * another through `this` runs it inside its own.
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
    const options =
      typeof spec === "object"
        ? (spec as {
            trigger?: Trigger;
            fields?: Readers;
            resultFields?: Readers;
          })
        : {};
    const trigger = options.trigger ?? "user";
    commands[key] = function (this: unknown, ...args: unknown[]) {
      return runStoreCommand(
        resolveCommandName(spec, args),
        (unit) => {
          if (options.fields) {
            const fields = readFields(options.fields, args);
            if (fields) unit.set(fields as never);
          }
          const result = command.apply(this, args);
          if (options.resultFields) {
            const fields = readFields(options.resultFields, result);
            if (fields) unit.set(fields as never);
          }
          return result;
        },
        trigger,
      );
    };
  }
  return store;
}
