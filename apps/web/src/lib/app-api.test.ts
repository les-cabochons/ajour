import { afterEach, describe, expect, it, vi } from "vitest";
import type { PluginsOverview } from "@ajour/shared";
import {
  appApiErrorStatus,
  cachePluginsOverview,
  getPluginsOverview,
  isPluginApiMissing,
  subscribePluginsOverview,
} from "./app-api";

const overview: PluginsOverview = {
  pluginsEnabled: true,
  unsignedPluginsEnabled: true,
  plugins: [],
  connectionGroups: [],
  totalPendingImportCount: 0,
  totalSelectedImportCount: 0,
};
function deferredResponse() {
  let resolve!: (response: Response) => void;
  const promise = new Promise<Response>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}

describe("plugin overview cache", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("publishes the latest refresh while keeping an older in-flight response out of the cache", async () => {
    cachePluginsOverview(overview);
    const first = deferredResponse();
    const second = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockReturnValueOnce(first.promise)
        .mockReturnValueOnce(second.promise),
    );
    const receive = vi.fn();
    const unsubscribe = subscribePluginsOverview(receive);
    try {
      const oldRequest = getPluginsOverview();
      const newRequest = getPluginsOverview();
      first.resolve(Response.json({ ...overview, totalPendingImportCount: 1 }));
      await oldRequest;
      expect(receive).not.toHaveBeenCalled();
      const latest = { ...overview, totalPendingImportCount: 2 };
      second.resolve(Response.json(latest));
      await expect(newRequest).resolves.toEqual(latest);
      expect(receive).toHaveBeenCalledExactlyOnceWith(latest);
    } finally {
      unsubscribe();
    }
  });

  it("preserves a mutation snapshot when a prior refresh returns, and unsubscribes listeners", async () => {
    const pending = deferredResponse();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => pending.promise),
    );
    const receive = vi.fn();
    const unsubscribe = subscribePluginsOverview(receive);
    const refresh = getPluginsOverview();
    const disabled = { ...overview, pluginsEnabled: false };
    cachePluginsOverview(disabled);
    pending.resolve(Response.json(overview));
    await expect(refresh).resolves.toEqual(disabled);
    expect(receive).toHaveBeenCalledExactlyOnceWith(disabled);
    unsubscribe();
    cachePluginsOverview(overview);
    expect(receive).toHaveBeenCalledTimes(1);
  });
});

describe("missing app API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function failedOverviewRequest(fetchImpl: () => Promise<Response>) {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(fetchImpl));
    const request = getPluginsOverview().catch((error: unknown) => error);
    // The default internal API retries twice before giving up.
    await vi.runAllTimersAsync();
    return request;
  }

  it("treats an unreachable API in the web build as missing", async () => {
    const error = await failedOverviewRequest(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(isPluginApiMissing(error)).toBe(true);
  });

  it("keeps an unreachable API in the desktop app as a failure", async () => {
    vi.stubGlobal("window", { ajourDesktop: {} });
    const error = await failedOverviewRequest(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(isPluginApiMissing(error)).toBe(false);
  });

  it("keeps an API error response as a failure", async () => {
    const error = await failedOverviewRequest(async () =>
      Response.json({ error: "Broken" }, { status: 500 }),
    );
    expect(error).toBeInstanceOf(Error);
    expect(isPluginApiMissing(error)).toBe(false);
  });

  it("keeps the HTTP status on the error, with the API's own message", async () => {
    for (const status of [401, 409, 502]) {
      const error = await failedOverviewRequest(async () =>
        Response.json({ error: "Paused." }, { status }),
      );
      expect(error).toMatchObject({ message: "Paused.", name: "Error" });
      expect(appApiErrorStatus(error)).toBe(status);
    }
    // A request that never reached the API has no status.
    const unreachable = await failedOverviewRequest(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(appApiErrorStatus(unreachable)).toBeUndefined();
  });
});
