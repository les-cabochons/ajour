import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectorsOverview } from "@ajour/shared";
import {
  cacheConnectorsOverview,
  getConnectorsOverview,
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
