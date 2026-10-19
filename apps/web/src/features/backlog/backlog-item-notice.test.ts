import { expect, it } from "vitest";
import type { LocalWorkItem } from "@/domain/local-state";
import {
  captureReturnNotice,
  getBacklogItemNotice,
  getVisitNotice,
} from "@/features/backlog/backlog-item-notice";

const item: LocalWorkItem = {
  _id: "item",
  title: "Item",
  status: "active",
  source: "azure_devops",
  createdAt: 1,
};

it("names who brought a settled item back by commenting", () => {
  expect(
    getBacklogItemNotice(
      {
        ...item,
        returnedAt: 900,
        returnedByComment: { author: "Ana Silva", at: 900 },
      },
      1_000,
    ),
  ).toBe("Ana Silva commented since you settled it");
});

it("says the source changed when a later sync brought the item back", () => {
  expect(
    getBacklogItemNotice(
      {
        ...item,
        returnedAt: 950,
        returnedByComment: { author: "Ana Silva", at: 900 },
      },
      1_000,
    ),
  ).toBe("Changed in the source since you settled it");
});

it("keeps why the item came back after opening it clears the mark", () => {
  const returned = {
    ...item,
    returnedAt: 900,
    returnedByComment: { author: "Ana Silva", at: 900 },
  };
  const captured = captureReturnNotice(returned, 1_000);
  const opened = { ...item };

  expect(getVisitNotice(opened, 1_000, captured)).toBe(
    "Ana Silva commented since you settled it",
  );
  expect(getVisitNotice({ ...opened, _id: "other" }, 1_000, captured)).toBe(
    null,
  );
  expect(
    getVisitNotice({ ...opened, status: "settled" }, 1_000, captured),
  ).toBe("Settled");
});
