// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TaskPropertyPlugin } from "@/domain/projects/plugin-properties";
import {
  createProjectTaskEditorFields,
  evaluateProjectTaskEditor,
} from "@/features/projects/project-task-editor";
import { ProjectTaskEditorForm } from "@/features/projects/project-task-editor-form";
import { installDomShims } from "@/test-support/dom";

/*
 * The task editor on a task of a managed project that its source knows
 * (#506): the name is the source's, the budget is the source's until the
 * user types their own (#816), and Commits as stays the user's.
 */

const workday: TaskPropertyPlugin = {
  pluginId: "workday-agent",
  capability: {
    section: "Workday",
    fields: [{ id: "task", label: "Workday task", defaultFrom: "name" }],
  },
};

const HOUR = 3_600_000;

const task = {
  name: "Ticket #101 - Login",
  billable: true,
  budgetMs: 8 * HOUR,
  source: { remoteId: "1001", assigned: true },
};

/** The editor on the source task, its budget field holding `budget` when given. */
function renderEditor(sourceLabel?: string, budget?: string) {
  const fields = {
    ...createProjectTaskEditorFields(task),
    ...(budget === undefined ? {} : { budget }),
  };
  const onFieldsChange = vi.fn();
  render(
    <ProjectTaskEditorForm
      fields={fields}
      editor={evaluateProjectTaskEditor(fields, task)}
      showNameError={false}
      projectName="Acme - Support"
      taskId="task-1"
      taskPropertyPlugins={[workday]}
      sourceLock={sourceLabel ? { label: sourceLabel } : undefined}
      sourceBudget={
        sourceLabel
          ? { label: sourceLabel, budgetMs: task.budgetMs }
          : undefined
      }
      onFieldsChange={onFieldsChange}
      onSave={() => {}}
      onClose={() => {}}
    />,
  );
  return onFieldsChange;
}

describe("the task editor on a source task", () => {
  beforeAll(installDomShims);
  afterEach(cleanup);

  function describedBy(element: HTMLElement) {
    return document.getElementById(
      element.getAttribute("aria-describedby") ?? "",
    )?.textContent;
  }

  it("locks the name and billable, links the budget to the source, and leaves Adjustment and Commits as to the user", () => {
    const onFieldsChange = renderEditor("Example planner");
    const hint = "Locked. Example planner sets it.";

    const name = screen.getByRole("textbox", { name: "Name" });
    expect(name).toHaveProperty("readOnly", true);
    expect(describedBy(name)).toBe(hint);

    // The source's budget, which the user may type over.
    const budget = screen.getByRole("textbox", { name: "budget" });
    expect(budget).toHaveProperty("readOnly", false);
    expect(describedBy(budget)).toBe(
      "From Example planner. Type to use your own.",
    );
    expect(screen.queryByRole("button", { name: /Revert/ })).toBeNull();
    fireEvent.change(budget, { target: { value: "12" } });
    expect(onFieldsChange).toHaveBeenCalledWith({ budget: "12" });
    onFieldsChange.mockClear();

    const billable = screen.getByRole("checkbox", { name: "Billable" });
    expect(billable.getAttribute("aria-disabled")).toBe("true");
    expect(describedBy(billable)).toBe(hint);
    fireEvent.click(billable);
    expect(onFieldsChange).not.toHaveBeenCalled();

    const adjustment = screen.getByRole("textbox", { name: "adjustment" });
    expect(adjustment).toHaveProperty("readOnly", false);
    fireEvent.change(adjustment, { target: { value: "1" } });
    expect(onFieldsChange).toHaveBeenCalledWith({ adjustment: "1" });
    expect(screen.getByText("Commits as")).toBeTruthy();
    // The locks add no tab stops of their own.
    expect(document.querySelector("[role=img][tabindex]")).toBeNull();
  });

  it("turns the link into a revert once the budget differs, saying so and giving the source's", () => {
    const onFieldsChange = renderEditor("Example planner", "12:00");

    const budget = screen.getByRole("textbox", { name: "budget" });
    expect(describedBy(budget)).toBe("Changed here. Example planner has 8h.");
    fireEvent.click(
      screen.getByRole("button", {
        name: "Changed here. Example planner has 8h. Revert to it.",
      }),
    );

    expect(onFieldsChange).toHaveBeenCalledWith({ budget: "8:00" });
  });

  it("leaves a local task's name editable", () => {
    const onFieldsChange = renderEditor(undefined);

    const name = screen.getByRole("textbox", { name: "Name" });
    expect(name).toHaveProperty("readOnly", false);
    fireEvent.change(name, { target: { value: "Login" } });
    expect(onFieldsChange).toHaveBeenCalledWith({ name: "Login" });
    expect(screen.queryByText(/^Locked/)).toBeNull();
    expect(screen.getByRole("textbox", { name: "budget" })).toHaveProperty(
      "readOnly",
      false,
    );
  });
});
