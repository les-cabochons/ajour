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
      tunnel?: FakeTunnel;
    }) => {
      transport: BrokerTransport;
      resolver: BrokerResolver;
      close(): Promise<void>;
    };
  };

/** The pinning tunnel, as the transport drives it. */
interface FakeTunnel {
  listen(): Promise<number>;
  pin(host: string, port: number, addresses: readonly string[]): () => void;
  close(): Promise<void>;
}

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
    // As Electron's: a value outside these characters throws, at once.
    if (!/^[\t\x20-\x7e\x80-\xff]*$/.test(value)) {
      throw new TypeError(`"${name}" is an invalid header value.`);
    }
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
    setProxy: vi.fn(async (_config: object) => undefined),
    forceReloadProxyConfig: vi.fn(async () => undefined),
  };
}
type FakeSession = ReturnType<typeof fakeSession>;

function fakeTunnel() {
  const live: { host: string; port: number; addresses: readonly string[] }[] =
    [];
  const tunnel = {
    live,
    listen: vi.fn(async () => 49_152),
    pin: vi.fn((host: string, port: number, addresses: readonly string[]) => {
      const pin = { host, port, addresses };
      live.push(pin);
      return () => {
        live.splice(live.indexOf(pin), 1);
      };
    }),
    close: vi.fn(async () => undefined),
  };
  return tunnel;
}

function setup(options: { requestThrows?: Error } = {}) {
  const ses = fakeSession();
  const pinnedSes = fakeSession();
  // Once its proxy rules apply, the pinned session routes through the tunnel.
  pinnedSes.resolveProxy.mockResolvedValue("PROXY 127.0.0.1:49152");
  const requests: FakeClientRequest[] = [];
  const fromPartition = vi.fn((partition: string) =>
    partition === "ajour-broker-pinned" ? pinnedSes : ses,
  );
  const tunnel = fakeTunnel();
  let ids = 0;
  const network = createBrokerNetwork({
    tunnel,
    net: {
      request: (requestOptions) => {
        if (options.requestThrows) throw options.requestThrows;
        const request = new FakeClientRequest(requestOptions);
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
  return {
    network,
    ses,
    pinnedSes,
    tunnel,
    requests,
    fromPartition,
    sendHeaders,
  };
}

/** Lets the transport's awaits before `net.request` run. */
const settled = () => new Promise((resolve) => setTimeout(resolve, 0));

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

  it("sends a pinned request through the tunnel on a session of its own, to the checked addresses only", async () => {
    const { network, requests, pinnedSes, ses, tunnel } = setup();

    const sending = network.transport.send(
      exchange({ connectTo: ["151.101.1.69", "2a04:4e42::645"] }),
    );
    await settled();
    const [request] = requests;

    // Every request of that session goes through the tunnel, this
    // computer's own addresses too, and never straight out.
    expect(pinnedSes.setProxy).toHaveBeenCalledWith({
      mode: "fixed_servers",
      proxyRules: "127.0.0.1:49152",
      proxyBypassRules: "<-loopback>",
    });
    expect(ses.setProxy).not.toHaveBeenCalled();
    expect(request!.options).toMatchObject({
      url: "https://acme.atlassian.net/rest/api/3/search/jql",
      session: pinnedSes,
      redirect: "manual",
      credentials: "omit",
      cache: "no-store",
    });
    expect(tunnel.live).toEqual([
      {
        host: "acme.atlassian.net",
        port: 443,
        addresses: ["151.101.1.69", "2a04:4e42::645"],
      },
    ]);
    // The tunnel's own address answers through `webRequest`: it is never
    // reported as the service's, and no marker is needed.
    expect(request!.headers[MARKER_HEADER]).toBeUndefined();
    respond(request!, { statusCode: 200, headers: {}, chunks: ["ok"] });

    await expect(sending).resolves.toEqual({
      status: 200,
      headers: {},
      body: new TextEncoder().encode("ok"),
    });
    expect(tunnel.live).toEqual([]);
  });

  it("sends no pinned request until the pinned session routes through the tunnel (#460)", async () => {
    const { network, requests, pinnedSes, tunnel } = setup();
    // Electron resolved setProxy, but the network service still routes
    // straight out: a request sent now would reach whatever DNS answers.
    pinnedSes.resolveProxy.mockResolvedValue("DIRECT");

    await expect(
      network.transport.send(exchange({ connectTo: ["151.101.1.69"] })),
    ).rejects.toThrow("does not route through the tunnel");
    expect(requests).toEqual([]);
    expect(tunnel.pin).not.toHaveBeenCalled();
    // The rules were set, then reloaded, before the route was asked for.
    const [set] = pinnedSes.setProxy.mock.invocationCallOrder;
    const [reload] = pinnedSes.forceReloadProxyConfig.mock.invocationCallOrder;
    const [asked] = pinnedSes.resolveProxy.mock.invocationCallOrder;
    expect(set! < reload! && reload! < asked!).toBe(true);

    // The next request sets the session up again, and goes once it routes.
    pinnedSes.resolveProxy.mockResolvedValue("PROXY 127.0.0.1:49152");
    const sending = network.transport.send(
      exchange({ connectTo: ["151.101.1.69"] }),
    );
    await settled();
    respond(requests[0]!, { statusCode: 204, headers: {} });
    await expect(sending).resolves.toMatchObject({ status: 204 });
    expect(pinnedSes.setProxy).toHaveBeenCalledTimes(2);
  });

  it("pins the URL's own port, starts the tunnel once, and lets the pin go when a request fails", async () => {
    const { network, requests, pinnedSes, tunnel } = setup();

    const first = network.transport.send(
      exchange({
        url: "https://jira.acme.example:8443/rest/api/3/myself",
        connectTo: ["151.101.1.69"],
      }),
    );
    await settled();
    expect(tunnel.live).toEqual([
      { host: "jira.acme.example", port: 8443, addresses: ["151.101.1.69"] },
    ]);
    requests[0]!.emit("error", new Error("net::ERR_TUNNEL_CONNECTION_FAILED"));
    await expect(first).rejects.toThrow("ERR_TUNNEL_CONNECTION_FAILED");

    const second = network.transport.send(
      exchange({ connectTo: ["151.101.1.69"] }),
    );
    await settled();
    respond(requests[1]!, { statusCode: 204, headers: {} });
    await second;

    expect(tunnel.live).toEqual([]);
    expect(tunnel.listen).toHaveBeenCalledTimes(1);
    expect(pinnedSes.setProxy).toHaveBeenCalledTimes(1);
  });

  it("lets the pin go when the request can't be built or its headers can't be set", async () => {
    const throws = setup({ requestThrows: new Error("net::ERR_FAILED") });
    await expect(
      throws.network.transport.send(exchange({ connectTo: ["151.101.1.69"] })),
    ).rejects.toThrow("ERR_FAILED");
    expect(throws.tunnel.pin).toHaveBeenCalledTimes(1);
    expect(throws.tunnel.live).toEqual([]);

    const { network, requests, tunnel } = setup();
    const controller = new AbortController();
    const removed = vi.spyOn(controller.signal, "removeEventListener");
    await expect(
      network.transport.send(
        exchange({
          connectTo: ["151.101.1.69"],
          signal: controller.signal,
          headers: { "x-note": "price in €" },
        }),
      ),
    ).rejects.toThrow(/invalid header value/);

    expect(tunnel.pin).toHaveBeenCalledTimes(1);
    expect(tunnel.live).toEqual([]);
    expect(removed).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(requests[0]!.aborted).toBe(true);
  });

  it("lets the pin go when the signal is already aborted, and when there is no address to connect to", async () => {
    const { network, requests, tunnel } = setup();
    const controller = new AbortController();
    controller.abort(new Error("The plugin gave up."));

    await expect(
      network.transport.send(
        exchange({ connectTo: ["151.101.1.69"], signal: controller.signal }),
      ),
    ).rejects.toThrow("The plugin gave up.");
    expect(tunnel.live).toEqual([]);

    await expect(
      network.transport.send(exchange({ connectTo: [] })),
    ).rejects.toThrow(/address/);
    expect(tunnel.live).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("lets the pin go when the tunnel refuses an address that isn't an IP", async () => {
    const { network, requests, tunnel } = setup();
    tunnel.pin.mockImplementationOnce(() => {
      throw new Error("A pin holds IP addresses only.");
    });

    await expect(
      network.transport.send(exchange({ connectTo: ["internal.example"] })),
    ).rejects.toThrow(/IP addresses/);
    expect(tunnel.live).toEqual([]);
    expect(requests).toEqual([]);
  });

  it("refuses to pin a URL that isn't https, and sends nothing", async () => {
    const { network, requests, tunnel } = setup();

    await expect(
      network.transport.send(
        exchange({
          url: "http://acme.atlassian.net/rest/api/3/myself",
          connectTo: ["151.101.1.69"],
        }),
      ),
    ).rejects.toThrow(/https/);
    expect(requests).toEqual([]);
    expect(tunnel.live).toEqual([]);
  });

  it("sends an unpinned request on the system's route, as before", async () => {
    const { network, requests, ses, tunnel } = setup();

    const sending = network.transport.send(exchange());
    await settled();
    respond(requests[0]!, { statusCode: 200, headers: {} });
    await sending;

    expect(requests[0]!.options.session).toBe(ses);
    expect(tunnel.listen).not.toHaveBeenCalled();
    expect(tunnel.pin).not.toHaveBeenCalled();
  });

  it("closes the tunnel", async () => {
    const { network, tunnel } = setup();

    await network.close();

    expect(tunnel.close).toHaveBeenCalledTimes(1);
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
