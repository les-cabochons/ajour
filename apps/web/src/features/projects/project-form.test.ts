import { describe, expect, it } from "vitest";
import {
  createProjectFormFields,
  getProjectFormValues,
  setProjectFormName,
} from "./project-form";

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
});
