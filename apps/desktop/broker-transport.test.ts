import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { describe, expect, it, vi } from "vitest";
import type {
  BrokerResolver,
  BrokerTransport,
  BrokerTransportRequest,
} from "../api/src/credential-broker.ts";

const require = createRequire(import.meta.url);
const { createBrokerNetwork, MARKER_HEADER } =
  require("./electron/broker-transport.cjs") as {
    MARKER_HEADER: string;
    createBrokerNetwork: (electron: {
      net: { request: (options: Record<string, unknown>) => FakeClientRequest };
      session: {
        fromPartition: (partition: string, options: object) => FakeSession;
      };
      randomUUID: () => string;
    }) => { transport: BrokerTransport; resolver: BrokerResolver };
  };

type Listener = (
  details: Record<string, unknown>,
  callback?: (response: object) => void,
) => void;

/** Electron's `ClientRequest`, as far as the transport drives it. */
class FakeClientRequest extends EventEmitter {
  readonly headers: Record<string, string> = {};
  readonly written: Buffer[] = [];
  ended = false;
  aborted = false;
  followRedirect = vi.fn();

  constructor(readonly options: Record<string, unknown>) {
    super();
  }

  setHeader(name: string, value: string) {
    this.headers[name] = value;
  }

  write(chunk: Buffer) {
    this.written.push(chunk);
  }

  end() {
    this.ended = true;
  }

  abort() {
    if (this.aborted) return;
    this.aborted = true;
    this.emit("abort");
  }
}

/** A session with the webRequest listeners and resolvers the transport uses. */
function fakeSession() {
  const listeners: Record<string, Listener> = {};
  const on = (event: string) => (listener: Listener) => {
    listeners[event] = listener;
  };
  return {
    listeners,
    webRequest: {
      onBeforeSendHeaders: on("beforeSendHeaders"),
      onResponseStarted: on("responseStarted"),
      onBeforeRedirect: on("beforeRedirect"),
      onCompleted: on("completed"),
      onErrorOccurred: on("errorOccurred"),
    },
    resolveHost: vi.fn(async (_host: string) => ({
      endpoints: [
        { address: "151.101.1.69", family: "ipv4" },
        { address: "2a04:4e42::645", family: "ipv6" },
      ],
    })),
    resolveProxy: vi.fn(async (_url: string) => "DIRECT"),
  };
}
type FakeSession = ReturnType<typeof fakeSession>;

function setup() {
  const ses = fakeSession();
  const requests: FakeClientRequest[] = [];
  const fromPartition = vi.fn(() => ses);
  let ids = 0;
  const network = createBrokerNetwork({
    net: {
      request: (options) => {
        const request = new FakeClientRequest(options);
        requests.push(request);
        return request;
      },
    },
    session: { fromPartition },
    randomUUID: () => `marker-${(ids += 1)}`,
  });
  /** Plays what Chromium does once the request is sent: the webRequest events. */
  const sendHeaders = (request: FakeClientRequest, id: number) => {
    let sent: Record<string, string> | undefined;
    ses.listeners.beforeSendHeaders!(
      { id, requestHeaders: { ...request.headers } },
      (response) => {
        sent = (response as { requestHeaders: Record<string, string> })
          .requestHeaders;
      },
    );
    return sent!;
  };
  return { network, ses, requests, fromPartition, sendHeaders };
}

function exchange(
  overrides: Partial<BrokerTransportRequest> = {},
): BrokerTransportRequest {
  return {
    url: "https://acme.atlassian.net/rest/api/3/search/jql",
    method: "POST",
    headers: { authorization: "Basic abc", "content-type": "application/json" },
    body: new TextEncoder().encode("{}"),
    signal: new AbortController().signal,
    maxResponseBytes: 1024,
    ...overrides,
  };
}

/** An `IncomingMessage` that sends `chunks`, then ends. */
function respond(
  request: FakeClientRequest,
  init: {
    statusCode: number;
    headers: Record<string, string | string[]>;
    chunks?: string[];
  },
) {
  const response = Object.assign(new EventEmitter(), {
    statusCode: init.statusCode,
    headers: init.headers,
  });
  request.emit("response", response);
  for (const chunk of init.chunks ?? [])
    response.emit("data", Buffer.from(chunk));
  response.emit("end");
}

describe("the broker's Electron transport", () => {
  it("sends on a session of its own, in memory, with manual redirects and no credentials or cache", async () => {
    const { network, requests, fromPartition, ses, sendHeaders } = setup();

    const sending = network.transport.send(exchange());
    const [request] = requests;
    const sent = sendHeaders(request!, 7);
    ses.listeners.responseStarted!({ id: 7, ip: "151.101.1.69" });
    respond(request!, {
      statusCode: 200,
      headers: {
        "content-type": "application/json",
        "set-cookie": ["a=1", "b=2"],
      },
      chunks: ['{"issues":', "[]}"],
    });

    await expect(sending).resolves.toEqual({
      status: 200,
      headers: { "content-type": "application/json", "set-cookie": "a=1, b=2" },
      body: new TextEncoder().encode('{"issues":[]}'),
      remoteAddress: "151.101.1.69",
    });
    expect(fromPartition).toHaveBeenCalledWith("ajour-broker", {
      cache: false,
    });
    expect(request!.options).toMatchObject({
      method: "POST",
      url: "https://acme.atlassian.net/rest/api/3/search/jql",
      session: ses,
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
    });
    expect(request!.written).toEqual([Buffer.from("{}")]);
    expect(request!.ended).toBe(true);
    // The marker ties the events to the request and never leaves this computer.
    expect(request!.headers[MARKER_HEADER]).toBe("marker-1");
    expect(sent).toEqual({
      authorization: "Basic abc",
      "content-type": "application/json",
    });
  });

  it("answers a redirect with its status and Location, without following it", async () => {
    const { network, requests } = setup();

    const sending = network.transport.send(
      exchange({ method: "GET", body: undefined }),
    );
    requests[0]!.emit(
      "redirect",
      302,
      "GET",
      "https://acme.atlassian.net/next",
      {
        location: ["/next"],
        "x-request-id": ["r-1"],
      },
    );

    await expect(sending).resolves.toEqual({
      status: 302,
      headers: {
        location: "https://acme.atlassian.net/next",
        "x-request-id": "r-1",
      },
      body: new Uint8Array(),
    });
    expect(requests[0]!.followRedirect).not.toHaveBeenCalled();
    expect(requests[0]!.aborted).toBe(true);
  });

  it("stops reading an answer over the limit", async () => {
    const { network, requests } = setup();

    const sending = network.transport.send(exchange({ maxResponseBytes: 4 }));
    respond(requests[0]!, {
      statusCode: 200,
      headers: {},
      chunks: ["123", "456"],
    });

    await expect(sending).rejects.toMatchObject({ code: "response_too_large" });
    expect(requests[0]!.aborted).toBe(true);
  });

  it("aborts the request when the broker's signal fires", async () => {
    const { network, requests } = setup();
    const controller = new AbortController();

    const sending = network.transport.send(
      exchange({ signal: controller.signal }),
    );
    controller.abort(new Error("timed out"));

    await expect(sending).rejects.toThrow("timed out");
    expect(requests[0]!.aborted).toBe(true);
  });

  it("fails as the network does", async () => {
    const { network, requests } = setup();

    const sending = network.transport.send(exchange());
    requests[0]!.emit("error", new Error("net::ERR_CONNECTION_REFUSED"));

    await expect(sending).rejects.toThrow("net::ERR_CONNECTION_REFUSED");
  });

  it("resolves a host with the session's own resolver, and says when a proxy carries the request", async () => {
    const { network, ses } = setup();

    await expect(
      network.resolver.resolve(
        "acme.atlassian.net",
        "https://acme.atlassian.net/",
      ),
    ).resolves.toEqual({
      addresses: ["151.101.1.69", "2a04:4e42::645"],
      proxied: false,
    });
    expect(ses.resolveHost).toHaveBeenCalledWith("acme.atlassian.net");

    ses.resolveProxy.mockResolvedValue("PROXY proxy.corp:8080; DIRECT");
    ses.resolveHost.mockRejectedValueOnce(
      new Error("net::ERR_NAME_NOT_RESOLVED"),
    );
    await expect(
      network.resolver.resolve(
        "intranet-only.example",
        "https://intranet-only.example/",
      ),
    ).resolves.toEqual({
      addresses: [],
      proxied: true,
      proxyAddresses: ["151.101.1.69", "2a04:4e42::645"],
    });
    expect(ses.resolveHost).toHaveBeenLastCalledWith("proxy.corp");

    ses.resolveProxy.mockResolvedValue("DIRECT");
    ses.resolveHost.mockRejectedValueOnce(
      new Error("net::ERR_NAME_NOT_RESOLVED"),
    );
    await expect(
      network.resolver.resolve("nowhere.example", "https://nowhere.example/"),
    ).rejects.toThrow("ERR_NAME_NOT_RESOLVED");
  });

  it("names the proxies' own addresses, so the broker judges an answer from any other", async () => {
    const { network, ses } = setup();
    ses.resolveProxy.mockResolvedValue(
      "PROXY 10.20.0.1:8080; SOCKS5 [fd00::5]:1080; HTTPS proxy.corp:443; DIRECT",
    );

    await expect(
      network.resolver.resolve(
        "acme.atlassian.net",
        "https://acme.atlassian.net/",
      ),
    ).resolves.toEqual({
      addresses: ["151.101.1.69", "2a04:4e42::645"],
      proxied: true,
      proxyAddresses: [
        "10.20.0.1",
        "fd00::5",
        "151.101.1.69",
        "2a04:4e42::645",
      ],
    });

    // A proxy whose name doesn't resolve leaves the proxies unknown, and
    // the broker judges no proxied answer.
    ses.resolveHost.mockImplementation(async (host: string) => {
      if (host === "proxy.corp") throw new Error("net::ERR_NAME_NOT_RESOLVED");
      return { endpoints: [{ address: "151.101.1.69", family: "ipv4" }] };
    });
    await expect(
      network.resolver.resolve(
        "acme.atlassian.net",
        "https://acme.atlassian.net/",
      ),
    ).resolves.toEqual({ addresses: ["151.101.1.69"], proxied: true });
  });
});
