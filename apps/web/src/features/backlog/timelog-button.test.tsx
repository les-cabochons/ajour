// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { TimelogButton } from "@/features/backlog/timelog-button";
import { installDomShims } from "@/test-support/dom";

const { showToast } = vi.hoisted(() => ({ showToast: vi.fn() }));
vi.mock("@/components/ui/toast", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  showToast,
}));

beforeAll(installDomShims);

afterEach(() => {
  cleanup();
  showToast.mockClear();
});

describe("the timelog button on a project its source archived (#637)", () => {
  it("says why it can't restore the project, naming the source, and asks nothing", () => {
    render(
      <TimelogButton
        workItemId="item"
        mismatch={{
          kind: "missing-project",
          projectName: "Globex - Internal",
          archivedProjectId: "globex",
          refusal: "Example planner marks this project complete.",
        }}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Can't restore project Globex - Internal. Example planner marks this project complete.",
      }),
    );

    expect(showToast).toHaveBeenCalledWith(
      "Can't restore. Example planner marks this project complete.",
    );
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });
});
