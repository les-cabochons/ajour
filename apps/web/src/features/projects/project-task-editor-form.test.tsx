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
 * (#506): the name is the source's, and Commits as stays the user's.
 */

const workday: TaskPropertyPlugin = {
  pluginId: "workday-agent",
  capability: {
    section: "Workday",
    fields: [{ id: "task", label: "Workday task", defaultFrom: "name" }],
  },
};

const task = {
  name: "Ticket #101 - Login",
  billable: true,
  source: { remoteId: "1001", assigned: true },
};

function renderEditor(sourceLabel?: string) {
  const fields = createProjectTaskEditorFields(task);
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

  it("shows the name, budget and billable as the source's, with Adjustment and Commits as still the user's", () => {
    const onFieldsChange = renderEditor("Example planner");
    const hint = "Locked. Example planner sets it.";

    const name = screen.getByRole("textbox", { name: "Name" });
    expect(name).toHaveProperty("readOnly", true);
    expect(describedBy(name)).toBe(hint);

    const budget = screen.getByRole("textbox", { name: "budget" });
    expect(budget).toHaveProperty("readOnly", true);
    expect(describedBy(budget)).toBe(hint);

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
