// @vitest-environment jsdom
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ExpandingSearch } from "@/components/expanding-search";
import type { SearchBoxState } from "@/lib/search-box-state";
import { installDomShims } from "@/test-support/dom";

/** A host that owns the box's state, as the sidebar and the Backlog page do. */
function Host({ initial }: { initial?: Partial<SearchBoxState> }) {
  const [state, setState] = useState<SearchBoxState>({
    open: false,
    query: "",
    ...initial,
  });
  return (
    <>
      <ExpandingSearch
        state={state}
        onChange={(patch) => setState((s) => ({ ...s, ...patch }))}
        label="Search the list"
      />
      <output data-testid="state">{JSON.stringify(state)}</output>
    </>
  );
}

const button = () =>
  screen.getByRole("button", { name: "Search", exact: true });
const box = () =>
  screen.getByRole("searchbox", {
    name: "Search the list",
  }) as HTMLInputElement;
const state = () =>
  JSON.parse(screen.getByTestId("state").textContent ?? "") as SearchBoxState;

beforeEach(installDomShims);
afterEach(cleanup);

describe("the expanding search box", () => {
  it("opens from the button and reports what is typed", () => {
    render(<Host />);
    expect(screen.queryByRole("searchbox")).toBeNull();

    fireEvent.click(button());
    fireEvent.change(box(), { target: { value: "3311" } });

    expect(state()).toEqual({ open: true, query: "3311" });
  });

  it("clears, closes and gives focus back to the button on Escape", () => {
    render(<Host initial={{ open: true, query: "3311" }} />);

    fireEvent.keyDown(box(), { key: "Escape" });

    expect(state()).toEqual({ open: false, query: "" });
    expect(document.activeElement).toBe(button());
  });

  it("closes when left empty, without taking focus", () => {
    render(<Host initial={{ open: true, query: "  " }} />);

    fireEvent.blur(box());

    expect(state()).toEqual({ open: false, query: "" });
    expect(document.activeElement).not.toBe(button());
  });

  it("keeps a typed query when the user leaves the box", () => {
    render(<Host initial={{ open: true, query: "3311" }} />);

    fireEvent.blur(box());

    expect(state()).toEqual({ open: true, query: "3311" });
    expect(box().value).toBe("3311");
  });

  it("empties the box and keeps focus in it on Clear", () => {
    render(<Host initial={{ open: true, query: "3311" }} />);

    fireEvent.click(screen.getByRole("button", { name: "Clear search" }));

    expect(state()).toEqual({ open: true, query: "" });
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    expect(document.activeElement).toBe(box());
  });
});
