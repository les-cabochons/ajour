// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { TaskPropertyPlugin } from "@/domain/projects/plugin-properties";
import { TaskPropertyFields } from "@/features/projects/task-property-fields";
import { installDomShims } from "@/test-support/dom";

const twoNameFields: TaskPropertyPlugin = {
  pluginId: "workday-agent",
  capability: {
    section: "Workday",
    fields: [
      { id: "task", label: "Workday task", defaultFrom: "name" },
      { id: "billingTask", label: "Billing task", defaultFrom: "name" },
    ],
  },
};

describe("the task editor's plugin section", () => {
  beforeAll(() => installDomShims());
  afterEach(cleanup);

  it("makes only the first name field Commits as, and keeps the other a task picker", () => {
    const onChange = vi.fn();
    render(
      <TaskPropertyFields
        plugins={[twoNameFields]}
        taskName="Knowledge transfer"
        otherTaskNames={["07 Run"]}
        pluginProperties={{ "workday-agent": { billingTask: "08 Billing" } }}
        commitAs={undefined}
        onChange={onChange}
      />,
    );
    expect(screen.getAllByText("Commits as")).toHaveLength(1);
    expect(screen.queryByRole("combobox", { name: "Workday task" })).toBeNull();
    expect(
      screen.getByRole("combobox", { name: "Billing task" }),
    ).toHaveProperty("value", "08 Billing");
  });

  it("shows Another task… with an empty picker and the error while the draft waits", () => {
    render(
      <TaskPropertyFields
        plugins={[twoNameFields]}
        taskName="Temp migration"
        otherTaskNames={["07 Run"]}
        pluginProperties={undefined}
        commitAs="waiting"
        choosingAnotherTask={{ pluginId: "workday-agent", fieldId: "task" }}
        commitsAsError="Pick the task it commits as."
        onChange={vi.fn()}
      />,
    );
    expect(
      screen.getByRole("combobox", { name: "Workday task" }),
    ).toHaveProperty("value", "");
    expect(screen.getByText("Pick the task it commits as.")).toBeTruthy();
  });
});
