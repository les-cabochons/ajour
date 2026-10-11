import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectorsOverview } from "@ajour/shared";
import {
  cacheConnectorsOverview,
  getConnectorsOverview,
  isConnectorApiMissing,
  subscribeConnectorsOverview,
} from "./app-api";

const overview: ConnectorsOverview = {
  pluginsEnabled: true,
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

describe("connector overview cache", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("publishes the latest refresh while keeping an older in-flight response out of the cache", async () => {
    cacheConnectorsOverview(overview);
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
    const unsubscribe = subscribeConnectorsOverview(receive);
    try {
      const oldRequest = getConnectorsOverview();
      const newRequest = getConnectorsOverview();
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
    const unsubscribe = subscribeConnectorsOverview(receive);
    const refresh = getConnectorsOverview();
    const disabled = { ...overview, pluginsEnabled: false };
    cacheConnectorsOverview(disabled);
    pending.resolve(Response.json(overview));
    await expect(refresh).resolves.toEqual(disabled);
    expect(receive).toHaveBeenCalledExactlyOnceWith(disabled);
    unsubscribe();
    cacheConnectorsOverview(overview);
    expect(receive).toHaveBeenCalledTimes(1);
  });
});

describe("missing connector API", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  async function failedOverviewRequest(fetchImpl: () => Promise<Response>) {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn(fetchImpl));
    const request = getConnectorsOverview().catch((error: unknown) => error);
    // The default internal API retries twice before giving up.
    await vi.runAllTimersAsync();
    return request;
  }

  it("treats an unreachable API in the web build as missing", async () => {
    const error = await failedOverviewRequest(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(isConnectorApiMissing(error)).toBe(true);
  });

  it("keeps an unreachable API in the desktop app as a failure", async () => {
    vi.stubGlobal("window", { ajourDesktop: {} });
    const error = await failedOverviewRequest(async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(isConnectorApiMissing(error)).toBe(false);
  });

  it("keeps an API error response as a failure", async () => {
    const error = await failedOverviewRequest(async () =>
      Response.json({ error: "Broken" }, { status: 500 }),
    );
    expect(error).toBeInstanceOf(Error);
    expect(isConnectorApiMissing(error)).toBe(false);
  });
});
