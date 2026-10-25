import { describe, expect, it } from "vitest";
import {
  accessRefusalOf,
  accessToStore,
  accessTurnedOff,
  connectionAccessChoicesOf,
  ESTIMATE_PUSH_OPERATION,
  holdEstimatePushes,
  withoutHeldEstimateUpdates,
} from "../connection-access";
import { pluginApi4ManifestSchema } from "../plugin-api-4";
import type { BacklogSyncWorkItem } from "../plugins";
import { azureDevOpsManifest } from "./fixtures/api-4-manifests";

const azureApi3 = { id: "azure_devops", apiVersion: 3 };

describe("connection access", () => {
  it("gives Azure DevOps on plugin API 3 its four choices, reading always on", () => {
    const choices = connectionAccessChoicesOf(azureApi3);

    expect(choices.map((choice) => [choice.id, choice.always])).toEqual([
      ["readBacklog", true],
      ["editWorkItems", false],
      ["pullRequests", false],
      ["peopleSearch", false],
    ]);
    expect(choices.every((choice) => choice.tokenScope)).toBe(true);
  });

  it("leaves Jira and GitHub on plugin API 3 without choices", () => {
    expect(connectionAccessChoicesOf({ id: "jira", apiVersion: 3 })).toEqual(
      [],
    );
    expect(connectionAccessChoicesOf({ id: "github", apiVersion: 3 })).toEqual(
      [],
    );
  });

  it("takes an API 4 plugin's choices from its manifest", () => {
    const manifest = pluginApi4ManifestSchema.parse(azureDevOpsManifest());

    expect(
      connectionAccessChoicesOf(manifest).map((choice) => choice.id),
    ).toEqual(["readBacklog", "editWorkItems", "pullRequests", "peopleSearch"]);
  });

  it("refuses a write, a pull request sync and people search until their choice is on", () => {
    const choices = connectionAccessChoicesOf(azureApi3);
    const refused = (turnedOn: string[], operation: string) =>
      accessRefusalOf(choices, turnedOn, operation)?.id;

    expect(refused([], "writeSettle")).toBe("editWorkItems");
    expect(refused([], ESTIMATE_PUSH_OPERATION)).toBe("editWorkItems");
    expect(refused([], "deleteItemComment")).toBe("editWorkItems");
    expect(refused([], "syncPullRequests")).toBe("pullRequests");
    expect(refused([], "searchItemPeople")).toBe("peopleSearch");
    expect(refused(["editWorkItems"], "writeSettle")).toBeUndefined();
    expect(refused(["pullRequests"], "syncPullRequests")).toBeUndefined();
  });

  it("lets reads run on a connection that only reads", () => {
    const choices = connectionAccessChoicesOf(azureApi3);

    for (const read of [
      "syncConnection",
      "listSettleStates",
      "readDescription",
      "listItemComments",
    ]) {
      expect(accessRefusalOf(choices, [], read)).toBeUndefined();
    }
  });

  it("stores only declared choices that can be turned off", () => {
    const choices = connectionAccessChoicesOf(azureApi3);

    expect(
      accessToStore(choices, [
        "peopleSearch",
        "readBacklog",
        "editWorkItems",
        "unknown",
        "peopleSearch",
      ]),
    ).toEqual(["editWorkItems", "peopleSearch"]);
  });

  it("names the choices a save turned off", () => {
    const choices = connectionAccessChoicesOf(azureApi3);

    expect(
      accessTurnedOff(
        choices,
        ["editWorkItems", "pullRequests"],
        ["pullRequests"],
      ).map((choice) => choice.id),
    ).toEqual(["editWorkItems"]);
  });
});

describe("held estimate uploads", () => {
  const item: BacklogSyncWorkItem = {
    localWorkItemId: "local-1",
    sourceId: "42",
    originalEstimateHours: 8,
    remainingEstimateHours: 3,
    completedEstimateHours: 5,
    estimateSync: {
      originalEstimateHours: { baselineValue: 8, remoteValue: 8 },
      remainingEstimateHours: { baselineValue: 6, remoteValue: 6 },
      completedEstimateHours: {
        baselineValue: 2,
        remoteValue: 4,
        resolution: "keep_local",
      },
    },
  };

  it("shows a plugin the agreed values, without Keep mine, so nothing uploads", () => {
    const { workItems, held } = holdEstimatePushes([item], true);

    expect(held).toEqual([
      {
        localWorkItemId: "local-1",
        fields: ["remainingEstimateHours", "completedEstimateHours"],
      },
    ]);
    expect(workItems[0]).toEqual({
      localWorkItemId: "local-1",
      sourceId: "42",
      originalEstimateHours: 8,
      remainingEstimateHours: 6,
      completedEstimateHours: 2,
      estimateSync: {
        originalEstimateHours: { baselineValue: 8, remoteValue: 8 },
        remainingEstimateHours: { baselineValue: 6, remoteValue: 6 },
        completedEstimateHours: { baselineValue: 2, remoteValue: 4 },
      },
    });
  });

  it("holds only the fields the user hasn't approved when the connection can edit", () => {
    const marked: BacklogSyncWorkItem = {
      ...item,
      estimateSync: {
        ...item.estimateSync,
        remainingEstimateHours: {
          baselineValue: 6,
          remoteValue: 6,
          held: true,
        },
      },
    };

    const { workItems, held } = holdEstimatePushes([marked], false);

    expect(held).toEqual([
      { localWorkItemId: "local-1", fields: ["remainingEstimateHours"] },
    ]);
    expect(workItems[0]!.remainingEstimateHours).toBe(6);
    expect(workItems[0]!.completedEstimateHours).toBe(5);
    expect(workItems[0]!.estimateSync?.remainingEstimateHours).toEqual({
      baselineValue: 6,
      remoteValue: 6,
    });
  });

  it("drops the answers of the fields it held and keeps the others", () => {
    const updates = withoutHeldEstimateUpdates(
      [
        {
          localWorkItemId: "local-1",
          sourceId: "42",
          fields: {
            originalEstimateHours: { status: "noop", remoteValue: 8 },
            remainingEstimateHours: { status: "pulled", remoteValue: 7 },
          },
        },
        {
          localWorkItemId: "local-2",
          sourceId: "43",
          fields: { remainingEstimateHours: { status: "pulled" } },
        },
      ],
      [{ localWorkItemId: "local-1", fields: ["remainingEstimateHours"] }],
    );

    expect(updates).toEqual([
      {
        localWorkItemId: "local-1",
        sourceId: "42",
        fields: { originalEstimateHours: { status: "noop", remoteValue: 8 } },
      },
      {
        localWorkItemId: "local-2",
        sourceId: "43",
        fields: { remainingEstimateHours: { status: "pulled" } },
      },
    ]);
  });
});
