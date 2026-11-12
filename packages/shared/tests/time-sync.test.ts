import { describe, expect, it } from "vitest";
import {
  TIME_SYNC_MAX_CHANGES,
  parseTimeSyncResult,
  timeSyncRequestSchema,
  type TimeSyncChange,
  type TimeSyncRequest,
} from "../time-sync";
import {
  PLUGIN_API_VERSION,
  capabilityStartsOff,
  pluginManifestSchema,
  pluginSwitchableCapabilities,
  switchableCapabilityLabels,
} from "../plugins";
import { pluginApi4ManifestSchema } from "../plugin-api-4";
import { timeSyncManifest } from "./fixtures/api-4-manifests";

/** An entry Ajour saved, sent with the values both sides agreed on last. */
const savedEdit: TimeSyncChange = {
  kind: "upsert",
  syncKey: "entry-1",
  remoteId: "te-41",
  values: {
    localDate: "2026-11-10",
    minutes: 90,
    running: false,
    projectRemoteId: "ACME-SUP",
    taskName: "Ticket #101 - Login",
    taskRemoteId: "1001",
  },
  agreed: {
    localDate: "2026-11-10",
    minutes: 60,
    running: false,
    projectRemoteId: "ACME-SUP",
    taskName: "Ticket #101 - Login",
    taskRemoteId: "1001",
  },
};

/** The running entry, new to the other system: no remote id, nothing agreed. */
const runningEntry: TimeSyncChange = {
  kind: "upsert",
  syncKey: "running-7",
  values: {
    localDate: "2026-11-12",
    minutes: 25,
    running: true,
    countingSince: "2026-11-12T14:05:00.000Z",
    projectRemoteId: "ACME-SUP",
    taskName: "Code review",
  },
};

const deletedEntry: TimeSyncChange = {
  kind: "delete",
  syncKey: "entry-2",
  remoteId: "te-42",
};

function round(changes: TimeSyncChange[] = []): TimeSyncRequest {
  return {
    from: "2026-10-12",
    to: "2026-11-15",
    timeZone: "America/Toronto",
    changes,
  };
}

/** A remote entry as the other system stores it. */
function remoteEntry(remoteId: string, clientRef?: string) {
  return {
    remoteId,
    ...(clientRef ? { clientRef } : {}),
    localDate: "2026-11-10",
    minutes: 90,
    running: false,
    projectRemoteId: "ACME-SUP",
    taskName: "Ticket #101 - Login",
    updatedAt: "2026-11-12T14:30:00.000Z",
  };
}

function requestIssues(request: unknown) {
  const result = timeSyncRequestSchema.safeParse(request);
  return result.success
    ? []
    : result.error.issues.map((issue) => [issue.path.join("."), issue.message]);
}

describe("a time sync round's request", () => {
  it("carries the window, the user's time zone and the changes in order", () => {
    const request = round([savedEdit, runningEntry, deletedEntry]);

    expect(timeSyncRequestSchema.parse(request)).toEqual(request);
  });

  it(`holds at most ${TIME_SYNC_MAX_CHANGES} changes`, () => {
    const changes = Array.from(
      { length: TIME_SYNC_MAX_CHANGES + 1 },
      (_, index) => ({ ...deletedEntry, syncKey: `entry-${index}` }),
    );

    expect(requestIssues(round(changes.slice(1)))).toEqual([]);
    expect(requestIssues(round(changes)).map(([path]) => path)).toEqual([
      "changes",
    ]);
  });

  it.each([
    [
      "a running entry without the instant its count started",
      round([
        {
          ...runningEntry,
          values: { ...runningEntry.values!, countingSince: undefined },
        },
      ]),
      "changes.0.values.countingSince",
    ],
    [
      "a duration that isn't whole minutes",
      round([
        { ...savedEdit, values: { ...savedEdit.values!, minutes: 90.5 } },
      ]),
      "changes.0.values.minutes",
    ],
    [
      "an upsert without the entry's values",
      round([{ kind: "upsert", syncKey: "entry-1" } as TimeSyncChange]),
      "changes.0.values",
    ],
    [
      "two changes with one sync key",
      round([savedEdit, { ...deletedEntry, syncKey: "entry-1" }]),
      "changes.1.syncKey",
    ],
    [
      "a window that ends before it starts",
      { ...round(), to: "2026-10-11" },
      "to",
    ],
    [
      "a time zone that doesn't exist",
      { ...round(), timeZone: "America/Atlantis" },
      "timeZone",
    ],
  ])("refuses %s, naming its path", (_name, request, path) => {
    expect(requestIssues(request).map(([at]) => at)).toEqual([path]);
  });
});

describe("a time sync round's result", () => {
  const request = round([savedEdit, runningEntry, deletedEntry]);

  it("answers each change as synced, refused or failed, and lists the remote entries", () => {
    const result = {
      results: [
        {
          syncKey: "entry-1",
          status: "synced",
          entry: remoteEntry("te-41", "entry-1"),
        },
        {
          syncKey: "running-7",
          status: "refused",
          message: "Planner refuses an entry over 24 hours.",
        },
        {
          syncKey: "entry-2",
          status: "failed",
          message: "Planner did not answer.",
        },
      ],
      entries: [
        remoteEntry("te-41", "entry-1"),
        // Logged in another tool: no client reference.
        remoteEntry("te-50"),
      ],
    };

    expect(parseTimeSyncResult(result, request)).toEqual(result);
  });

  it("refuses a result that leaves a change unanswered or answers one twice", () => {
    const synced = {
      syncKey: "entry-2",
      status: "synced",
    };

    expect(() =>
      parseTimeSyncResult({ results: [synced], entries: [] }, request),
    ).toThrow(
      'The plugin\'s result is not valid: results: no result for the change "entry-1"; results: no result for the change "running-7".',
    );
    expect(() =>
      parseTimeSyncResult(
        {
          results: [
            synced,
            synced,
            {
              syncKey: "entry-1",
              status: "synced",
              entry: remoteEntry("te-41"),
            },
            {
              syncKey: "running-7",
              status: "synced",
              entry: remoteEntry("te-60"),
            },
          ],
          entries: [],
        },
        request,
      ),
    ).toThrow(
      'The plugin\'s result is not valid: results[1].syncKey: a second result for the change "entry-2".',
    );
  });

  it("refuses a synced upsert without the entry as stored", () => {
    expect(() =>
      parseTimeSyncResult(
        {
          results: [{ syncKey: "entry-1", status: "synced" }],
          entries: [],
        },
        round([savedEdit]),
      ),
    ).toThrow(
      'The plugin\'s result is not valid: results[0].entry: the change "entry-1" is an upsert, so its synced result carries the entry as stored.',
    );
  });

  it("refuses a bad remote entry by its path, in one sentence", () => {
    const { updatedAt: _updatedAt, ...entry } = remoteEntry("te-50");

    expect(() =>
      parseTimeSyncResult({ results: [], entries: [entry] }, round()),
    ).toThrow(
      "The plugin's result is not valid: entries[0].updatedAt: Required.",
    );
  });
});

describe("the timeSync capability", () => {
  it("is accepted on plugin API 4 beside a project source, with no options", () => {
    const manifest = timeSyncManifest();

    expect(pluginApi4ManifestSchema.safeParse(manifest).success).toBe(true);
    expect(
      pluginApi4ManifestSchema.safeParse({
        ...manifest,
        capabilities: { projectSource: {}, timeSync: { notes: true } },
      }).success,
    ).toBe(false);
  });

  it("is refused on plugin API 3", () => {
    const manifest = {
      ...timeSyncManifest(),
      apiVersion: PLUGIN_API_VERSION,
      network: undefined,
    };

    const result = pluginManifestSchema.safeParse(manifest);

    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => issue.message)).toContain(
      "The timeSync capability needs plugin API 4.",
    );
  });

  it("needs a project source, since it syncs entries on the projects the connection manages", () => {
    const manifest = timeSyncManifest();
    manifest.capabilities = { timeSync: {} };

    const result = pluginApi4ManifestSchema.safeParse(manifest);

    expect(result.error?.issues.map((issue) => issue.message)).toEqual([
      "The timeSync capability needs projectSource: it syncs the entries on the projects the connection manages.",
    ]);
  });

  it("is a switch of its own, labelled Time entries, and the only one that starts off", () => {
    const manifest = pluginApi4ManifestSchema.parse(timeSyncManifest());

    expect(pluginSwitchableCapabilities(manifest)).toEqual([
      "projectSource",
      "timeSync",
    ]);
    expect(switchableCapabilityLabels.timeSync).toBe("Time entries");
    expect(capabilityStartsOff("timeSync")).toBe(true);
    expect(capabilityStartsOff("projectSource")).toBe(false);
    expect(capabilityStartsOff("connector")).toBe(false);
  });
});
