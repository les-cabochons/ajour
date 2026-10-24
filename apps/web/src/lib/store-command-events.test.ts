import { describe, expect, it } from "vitest";
import type { AjourCatalog } from "@ajour/wide-events/catalog.ts";
import type {
  FieldReaders,
  StoreCommandTable,
} from "@/lib/store-command-events";

/** A store with one command, to check the command table's types. */
interface ExampleStore {
  snapshot(): void;
  reopenWeek(weekOf: string): string | null;
  addWorkItem(draft: { title: string; description?: string }): string;
}

describe("the command table's types", () => {
  it("accepts the fields the catalog declares for the command's name", () => {
    const table = {
      reopenWeek: {
        name: "week.reopen",
        fields: { week: { week_of: ([weekOf]) => weekOf } },
      },
      addWorkItem: "backlog_item.create",
    } satisfies StoreCommandTable<ExampleStore, "snapshot">;

    expect(table.reopenWeek.fields.week.week_of(["2026-10-05"])).toBe(
      "2026-10-05",
    );
  });

  it("refuses at compile time a field the catalog doesn't declare", () => {
    const table = {
      reopenWeek: {
        name: "week.reopen",
        fields: {
          week: {
            week_of: ([weekOf]) => weekOf,
            // @ts-expect-error `note` is not a field of week.reopen.
            note: () => "Private note",
          },
        },
      },
    } satisfies StoreCommandTable<ExampleStore, "snapshot" | "addWorkItem">;
    const extra = {
      reopenWeek: {
        name: "week.reopen",
        fields: {
          // @ts-expect-error `extra` is not a field of week.reopen.
          extra: { secret: () => "y" },
        },
      },
    } satisfies StoreCommandTable<ExampleStore, "snapshot" | "addWorkItem">;

    expect(table && extra).toBeTruthy();
  });

  it("refuses at compile time a reader that returns the wrong type for its field", () => {
    // One reader alone on its line, typed as a spec types it, so the expected
    // error can only be its return type.
    type Readers = FieldReaders<
      AjourCatalog["events"]["backlog_item.create"]["fields"],
      Parameters<ExampleStore["addWorkItem"]>
    >;
    type IdReader = NonNullable<NonNullable<Readers["backlog_item"]>["id"]>;
    // @ts-expect-error A backlog item's ID is a string, not the draft.
    const wrong: IdReader = ([draft]) => draft;
    const right: IdReader = ([draft]) => draft.title;
    const table = {
      reopenWeek: "week.reopen",
      addWorkItem: {
        name: "backlog_item.create",
        fields: { backlog_item: { id: right } },
      },
    } satisfies StoreCommandTable<ExampleStore, "snapshot">;

    expect(table.addWorkItem.fields.backlog_item.id([{ title: "Draft" }])).toBe(
      "Draft",
    );
    expect(wrong).toBeTruthy();
  });
});
