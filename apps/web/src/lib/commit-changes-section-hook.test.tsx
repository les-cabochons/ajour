// @vitest-environment jsdom
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { installDomShims } from "@/test-support/dom";

beforeEach(() => {
  vi.resetModules();
  installDomShims();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("useCommitChangesSection", () => {
  it("keeps every mounted Commit page on the same state", async () => {
    const { setCommitChangesSection, useCommitChangesSection } =
      await import("./commit-changes-section");
    function Page({ name }: { name: string }) {
      return <p data-testid={name}>{useCommitChangesSection()}</p>;
    }
    render(
      <>
        <Page name="a" />
        <Page name="b" />
      </>,
    );
    expect(screen.getByTestId("b").textContent).toBe("expanded");

    act(() => setCommitChangesSection("collapsed"));

    expect(screen.getByTestId("a").textContent).toBe("collapsed");
    expect(screen.getByTestId("b").textContent).toBe("collapsed");
  });

  it("starts from the state saved on this device", async () => {
    const { COMMIT_CHANGES_SECTION_STORAGE_KEY, useCommitChangesSection } =
      await import("./commit-changes-section");
    window.localStorage.setItem(
      COMMIT_CHANGES_SECTION_STORAGE_KEY,
      "collapsed",
    );
    function Page() {
      return <p data-testid="page">{useCommitChangesSection()}</p>;
    }
    render(<Page />);
    expect(screen.getByTestId("page").textContent).toBe("collapsed");
  });
});
