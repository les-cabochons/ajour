import { describe, expect, it } from "vitest";
import { createSearchBoxState } from "@/lib/search-box-state";

describe("createSearchBoxState", () => {
  it("starts closed and empty", () => {
    expect(createSearchBoxState().get()).toEqual({ open: false, query: "" });
  });

  it("keeps each box apart: the sidebar's query is not the page's", () => {
    const sidebar = createSearchBoxState();
    const page = createSearchBoxState();

    sidebar.update({ open: true });
    sidebar.update({ query: "3311" });

    expect(sidebar.get()).toEqual({ open: true, query: "3311" });
    expect(page.get()).toEqual({ open: false, query: "" });
  });
});
