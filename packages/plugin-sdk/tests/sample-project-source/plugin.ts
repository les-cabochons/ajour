// A small project source written against the SDK, as a plugin repo would:
// it reads one snapshot route with an ETag and maps it to Ajour's shape.
import type {} from "../../globals.ts";
import type {
  PluginConnection,
  PluginManifest,
  PluginModule,
  ProjectSourceSnapshot,
} from "../../index.ts";

export const manifest: PluginManifest = {
  id: "ajc-sample-source",
  version: "4.0.0",
  apiVersion: 4,
  displayName: "Sample planner",
  iconSvg: "<svg viewBox='0 0 16 16' />",
  entrypoint: "dist/index.js",
  connectionFields: [
    { id: "serviceUrl", label: "Service URL", type: "url", required: true },
    {
      id: "token",
      label: "Personal token",
      type: "password",
      required: true,
      secret: true,
    },
  ],
  capabilities: { projectSource: {} },
  network: {
    auth: {
      scheme: "headerTemplate",
      header: "X-Token",
      template: "{secret}",
      secretField: "token",
    },
    baseAddress: { field: "serviceUrl" },
    endpoints: [{ method: "GET", path: "/integration/snapshot" }],
    requestHeaders: ["If-None-Match"],
  },
};

/** What the sample service answers, in its own words. */
interface ServiceSnapshot {
  reportedAt: string;
  linked: boolean;
  projects: {
    code: string;
    title: string;
    done: boolean;
    hoursCap: number;
    hoursUsed: number;
    tasks: { id: string; title: string; phase: string; mine: boolean }[];
  }[];
}

function toSnapshot(
  connection: PluginConnection,
  service: ServiceSnapshot,
): ProjectSourceSnapshot {
  const home = String(connection.config.serviceUrl);
  return {
    source: { label: "Planner", url: home },
    asOf: service.reportedAt,
    me: {
      hoursAvailable: service.linked,
      ...(service.linked
        ? {}
        : { hoursNote: "Link your account in Planner to compare your hours." }),
    },
    projects: service.projects.map((project) => ({
      remoteId: project.code,
      name: project.title,
      code: project.code,
      url: `${home}/projects/${encodeURIComponent(project.code)}`,
      complete: project.done,
      budget: {
        unit: "hours",
        total: project.hoursCap,
        consumed: project.hoursUsed,
        remaining: project.hoursCap - project.hoursUsed,
        status: project.hoursUsed > project.hoursCap ? "over" : "ok",
      },
      tasks: project.tasks.map((task) => ({
        remoteId: task.id,
        name: task.title,
        group: task.phase,
        closed: false,
        assigned: task.mine,
      })),
    })),
  };
}

export const plugin: PluginModule = {
  async syncProjects(connection, { cursor }) {
    const response = await ajour.http({
      connectionId: connection.id,
      method: "GET",
      path: "/integration/snapshot",
      ...(cursor ? { headers: { "If-None-Match": cursor } } : {}),
    });
    if (response.status === 304) return { unchanged: true };
    if (!response.ok) {
      throw new Error(`Planner answered ${response.status}.`);
    }
    const service = await response.json<ServiceSnapshot>();
    return {
      snapshot: toSnapshot(connection, service),
      ...(response.headers.etag ? { cursor: response.headers.etag } : {}),
    };
  },
};
