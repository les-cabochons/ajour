import { describe, expect, it } from "vitest";
import { backlogCommentOperations } from "../../../packages/shared/backlog-comments.ts";
import { calendarOperations } from "../../../packages/shared/calendar.ts";
import { codeHostOperations } from "../../../packages/shared/code-host.ts";
import { teamPluginMethods } from "../../../packages/shared/team-sync.ts";
import { PLUGIN_OPERATION_EVENTS } from "./plugin-host.ts";
import {
  pluginMethodArguments,
  projectDataShapeMethodArguments,
} from "./plugin-methods.ts";

const connection = { id: "connection-1" };
const request = { tracked: [] };

describe("plugin method table", () => {
  it.each([
    ...Object.keys(codeHostOperations),
    ...Object.keys(calendarOperations),
    ...Object.keys(backlogCommentOperations),
    "syncTeamProjects",
    "listSettleStates",
    "writeSettle",
    "readDescription",
    "writeDescription",
  ])("passes %s the connection, then the request", (method) => {
    expect(
      pluginMethodArguments(method as never, { connection, request }),
    ).toEqual([connection, request]);
  });

  it("has a dispatch entry for every method a contract or the host names", () => {
    const methods = new Set([
      ...Object.keys(codeHostOperations),
      ...Object.keys(calendarOperations),
      ...Object.keys(backlogCommentOperations),
      ...teamPluginMethods,
      ...Object.keys(PLUGIN_OPERATION_EVENTS),
    ]);
    for (const method of methods) {
      expect(
        () => pluginMethodArguments(method as never, {}),
        method,
      ).not.toThrow();
    }
  });

  it("passes the form's values to the methods that run before a save", () => {
    const config = { baseUrl: "https://example.test" };
    expect(
      pluginMethodArguments("validateConnection", {
        config,
        context: { capabilities: [] },
      }),
    ).toEqual([config, { capabilities: [] }]);
    // Validation without a context still passes it, as undefined.
    expect(pluginMethodArguments("validateConnection", { config })).toEqual([
      config,
      undefined,
    ]);
    expect(pluginMethodArguments("createTeam", { config, request })).toEqual([
      config,
      request,
    ]);
  });

  it("passes a backlog sync the connection, then the work items", () => {
    expect(
      pluginMethodArguments("syncConnection", { connection, workItems: [] }),
    ).toEqual([connection, [], undefined]);
  });

  it("refuses a method it has no entry for", () => {
    expect(() =>
      pluginMethodArguments("deleteEverything" as never, {}),
    ).toThrow("Unknown plugin method: deleteEverything");
  });

  it("passes data-shape methods their one argument", () => {
    expect(
      projectDataShapeMethodArguments("exportProjects", { projects: [] }),
    ).toEqual([[]]);
    expect(
      projectDataShapeMethodArguments("importProjects", { sheets: [] }),
    ).toEqual([[]]);
  });
});
