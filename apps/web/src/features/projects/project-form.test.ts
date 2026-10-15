import { describe, expect, it } from "vitest";
import {
  createProjectFormFields,
  getProjectFormValues,
  getProjectPatch,
  setProjectFormName,
} from "./project-form";
import type { LocalProject } from "@/domain/local-state";

const atlas: LocalProject = {
  _id: "project-atlas",
  name: "Client Atlas",
  displayName: "Client Atlas",
  code: "ATL",
  color: "#1f7667",
  icon: { kind: "preset", name: "dot" },
  status: "active",
  tasks: [],
};

describe("project form", () => {
  it("keeps the display name in step with the full name until it is changed", () => {
    let fields = createProjectFormFields();
    fields = setProjectFormName(fields, "Client Atlas");
    expect(fields.displayName).toBe("Client Atlas");

    fields = { ...fields, displayName: "Atlas" };
    fields = setProjectFormName(fields, "Client Atlas platform");
    expect(fields).toMatchObject({
      name: "Client Atlas platform",
      displayName: "Atlas",
    });
  });

  it("trims values, falls back to the full name and clears an empty code", () => {
    const fields = {
      ...createProjectFormFields(),
      name: "  Client Atlas ",
      displayName: " ",
      code: "  ",
    };

    expect(getProjectFormValues(fields)).toMatchObject({
      name: "Client Atlas",
      displayName: "Client Atlas",
      code: undefined,
    });
  });

  it("cannot save without a full name", () => {
    expect(
      getProjectFormValues({ ...createProjectFormFields(), name: "  " }),
    ).toBeNull();
  });

  describe("in-place edits", () => {
    it("renames the display name along with an untouched full name", () => {
      expect(
        getProjectPatch(atlas, (fields) =>
          setProjectFormName(fields, "Client Atlas platform"),
        ),
      ).toMatchObject({
        name: "Client Atlas platform",
        displayName: "Client Atlas platform",
      });
    });

    it("returns nothing when the edit changes nothing", () => {
      expect(
        getProjectPatch(atlas, (fields) => ({ ...fields, code: " ATL " })),
      ).toBeNull();
    });

    it("keeps the saved project when the full name is emptied", () => {
      expect(
        getProjectPatch(atlas, (fields) => ({ ...fields, name: " " })),
      ).toBeNull();
    });
  });
});
