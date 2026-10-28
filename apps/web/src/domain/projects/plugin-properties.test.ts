import { describe, expect, it } from "vitest";
import type { LocalProject, LocalProjectTask } from "@/domain/local-state";
import {
  getMappedTaskName,
  normalizePluginProperties,
  resolvePluginProperties,
  resolveTaskPluginProperties,
  setPluginProperty,
  setPluginPropertyDraft,
  type ProjectPropertyPlugin,
  type TaskPropertyPlugin,
} from "@/domain/projects/plugin-properties";

const workday: ProjectPropertyPlugin = {
  pluginId: "workday-agent",
  capability: {
    section: "Workday",
    fields: [
      { id: "name", label: "Workday name", defaultFrom: "fullName" },
      { id: "code", label: "Workday code", defaultFrom: "code" },
      { id: "note", label: "Note" },
    ],
  },
};

function project(overrides: Partial<LocalProject> = {}): LocalProject {
  return {
    _id: "project-1",
    name: "CA004 Tech & Design",
    displayName: "Internal",
    code: "CA004",
    color: "#123456",
    icon: { kind: "preset", name: "dot" },
    status: "active",
    tasks: [],
    ...overrides,
  };
}

const values = (p: LocalProject) =>
  resolvePluginProperties(p, workday).map(({ value, isDefault }) => ({
    value,
    isDefault,
  }));

describe("plugin project properties", () => {
  it("defaults to the full name and the code, never the display name", () => {
    expect(values(project())).toEqual([
      { value: "CA004 Tech & Design", isDefault: true },
      { value: "CA004", isDefault: true },
      { value: "", isDefault: true },
    ]);
  });

  it("gives an empty default when the project has no code", () => {
    expect(values(project({ code: undefined }))[1]).toEqual({
      value: "",
      isDefault: true,
    });
  });

  it("uses an override, and keeps it when the project is renamed", () => {
    const withOverride = project({
      pluginProperties: setPluginProperty(
        project(),
        "workday-agent",
        "name",
        "CA004 Tech & Design",
      ),
    });
    expect(values({ ...withOverride, name: "Renamed" })[0]).toEqual({
      value: "CA004 Tech & Design",
      isDefault: false,
    });
  });

  it("brings the default back when the override is cleared", () => {
    const withOverride = project({
      pluginProperties: { "workday-agent": { name: "Tech" } },
    });
    expect(
      setPluginProperty(withOverride, "workday-agent", "name", "  "),
    ).toBeUndefined();
  });

  it("keeps the values of other plugins", () => {
    const other = project({ pluginProperties: { jira: { key: "ABC" } } });
    expect(setPluginProperty(other, "workday-agent", "code", " X1 ")).toEqual({
      jira: { key: "ABC" },
      "workday-agent": { code: "X1" },
    });
  });

  it("cuts a value to 240 characters", () => {
    const next = setPluginProperty(
      project(),
      "workday-agent",
      "name",
      "a".repeat(300),
    );
    expect(next?.["workday-agent"]?.name).toHaveLength(240);
  });

  it("keeps spaces in a draft value, and normalizing trims them", () => {
    const draft = setPluginPropertyDraft(
      project(),
      "finance",
      "center",
      "Cost ",
    );
    expect(draft).toEqual({ finance: { center: "Cost " } });
    expect(normalizePluginProperties(draft)).toEqual({
      finance: { center: "Cost" },
    });
    expect(
      setPluginPropertyDraft(
        { pluginProperties: draft },
        "finance",
        "center",
        " ",
      ),
    ).toBeUndefined();
  });

  it("drops stored values that are not text", () => {
    expect(
      normalizePluginProperties({
        "workday-agent": { name: "Tech", code: 4, note: "" },
        broken: "nope",
      }),
    ).toEqual({ "workday-agent": { name: "Tech" } });
    expect(normalizePluginProperties(undefined)).toBeUndefined();
    expect(normalizePluginProperties([])).toBeUndefined();
  });

  it("never reads inherited properties for ids such as constructor", () => {
    const plugin: ProjectPropertyPlugin = {
      pluginId: "constructor",
      capability: {
        section: "Odd",
        fields: [{ id: "constructor", label: "Odd", defaultFrom: "code" }],
      },
    };
    expect(
      resolvePluginProperties(project({ pluginProperties: {} }), plugin),
    ).toEqual([
      {
        field: plugin.capability.fields[0],
        value: "CA004",
        defaultValue: "CA004",
        isDefault: true,
      },
    ]);
  });
});

describe("plugin task properties", () => {
  const workdayTask: TaskPropertyPlugin = {
    pluginId: "workday-agent",
    capability: {
      section: "Workday",
      fields: [
        { id: "task", label: "Workday task", defaultFrom: "name" },
        { id: "note", label: "Note" },
      ],
    },
  };
  const task: Pick<LocalProjectTask, "name" | "pluginProperties"> = {
    name: "Knowledge transfer",
  };

  it("defaults to the task's name", () => {
    expect(
      resolveTaskPluginProperties(task, workdayTask).map(
        ({ value, isDefault }) => ({ value, isDefault }),
      ),
    ).toEqual([
      { value: "Knowledge transfer", isDefault: true },
      { value: "", isDefault: true },
    ]);
    expect(getMappedTaskName(task, workdayTask)).toBeUndefined();
  });

  it("maps the task to another name, which a rename in Ajour keeps", () => {
    const mapped = {
      ...task,
      pluginProperties: setPluginProperty(
        task,
        "workday-agent",
        "task",
        " 07 Run ",
      ),
    };
    expect(getMappedTaskName(mapped, workdayTask)).toBe("07 Run");
    expect(
      getMappedTaskName({ ...mapped, name: "KT sessions" }, workdayTask),
    ).toBe("07 Run");
  });

  it("does not count a mapping to the task's own name", () => {
    const same = {
      ...task,
      pluginProperties: { "workday-agent": { task: "Knowledge transfer" } },
    };
    expect(getMappedTaskName(same, workdayTask)).toBeUndefined();
  });

  it("maps nothing for a plugin without a field that defaults to the name", () => {
    const notes: TaskPropertyPlugin = {
      pluginId: "notes",
      capability: { section: "Notes", fields: [{ id: "note", label: "Note" }] },
    };
    expect(
      getMappedTaskName(
        { ...task, pluginProperties: { notes: { note: "07 Run" } } },
        notes,
      ),
    ).toBeUndefined();
  });
});
