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
      nameLock={sourceLabel ? { label: sourceLabel } : undefined}
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

  it("shows the name as the source's, read-only, with Commits as still offered", () => {
    renderEditor("Example planner");

    const name = screen.getByRole("textbox", { name: "Name" });
    expect(name).toHaveProperty("readOnly", true);
    expect(
      screen.getByLabelText("Locked. Example planner sets it."),
    ).toBeTruthy();
    expect(screen.getByText("Commits as")).toBeTruthy();
  });

  it("leaves a local task's name editable", () => {
    const onFieldsChange = renderEditor(undefined);

    const name = screen.getByRole("textbox", { name: "Name" });
    expect(name).toHaveProperty("readOnly", false);
    fireEvent.change(name, { target: { value: "Login" } });
    expect(onFieldsChange).toHaveBeenCalledWith({ name: "Login" });
    expect(screen.queryByLabelText(/^Locked/)).toBeNull();
  });
});
