import { describe, expect, it } from "vitest";
import { endpointPatternMatches } from "../../shared/plugin-api-4.ts";
import type { PluginManifest } from "../index.ts";
import { createFakeAjour, routeMatches } from "../testing.ts";

const manifest: PluginManifest = {
  id: "ajc-example",
  version: "4.0.0",
  apiVersion: 4,
  displayName: "Example",
  iconSvg: "<svg/>",
  entrypoint: "dist/index.js",
  connectionFields: [
    { id: "baseUrl", label: "Site", type: "url", required: true },
    { id: "token", label: "Token", type: "password", secret: true },
  ],
  capabilities: { connector: {} },
  network: {
    auth: { scheme: "bearer", secretField: "token" },
    baseAddress: { field: "baseUrl" },
    endpoints: [
      { method: "GET", path: "/api/items/*" },
      { method: "POST", path: "/api/search" },
    ],
    derivedHosts: [
      {
        id: "people",
        forms: [{ host: "people.{host}" }],
        endpoints: [{ method: "GET", path: "/users/**" }],
      },
    ],
    requestHeaders: ["Accept", "Content-Type"],
    publicHosts: ["avatars.example.com"],
  },
};

describe("the fake ajour.http", () => {
  it("answers from a route and records the request", async () => {
    const ajour = createFakeAjour({
      routes: [
        {
          method: "GET",
          path: "/api/items/*",
          respond: { json: { id: "ITEM-1", title: "Fix it" } },
        },
      ],
    });

    const response = await ajour.http({
      connectionId: "c1",
      method: "GET",
      path: "/api/items/ITEM-1",
      query: { fields: ["title", "state"], expand: true },
      headers: { Accept: "application/json" },
    });

    expect(response.status).toBe(200);
    expect(response.ok).toBe(true);
    expect(response.headers["content-type"]).toBe("application/json");
    await expect(response.json()).resolves.toEqual({
      id: "ITEM-1",
      title: "Fix it",
    });
    expect(ajour.requests).toEqual([
      {
        connectionId: "c1",
        method: "GET",
        path: "/api/items/ITEM-1",
        query: { fields: ["title", "state"], expand: true },
        headers: { accept: "application/json" },
      },
    ]);
  });

  it("chooses a route by connection and host, and lets a function answer", async () => {
    const ajour = createFakeAjour({
      routes: [
        {
          connectionId: "other",
          method: "POST",
          path: "/api/search",
          respond: { status: 500 },
        },
        {
          connectionId: "c1",
          method: "POST",
          path: "/api/search",
          respond: (request) => ({
            status: 201,
            body: `searched ${request.bodyText}`,
          }),
        },
        {
          host: "people",
          method: "GET",
          path: "/users/**",
          respond: { json: [] },
        },
      ],
    });

    const search = await ajour.http({
      connectionId: "c1",
      method: "POST",
      path: "/api/search",
      body: new TextEncoder().encode("state = open"),
    });
    const people = await ajour.http({
      connectionId: "c1",
      host: "people",
      method: "GET",
      path: "/users/search/ada",
    });

    expect(search.status).toBe(201);
    await expect(search.text()).resolves.toBe("searched state = open");
    await expect(people.json()).resolves.toEqual([]);
  });

  it("fails a request no route answers, naming it", async () => {
    const ajour = createFakeAjour({ routes: [] });

    await expect(
      ajour.http({ connectionId: "c1", method: "GET", path: "/api/items/1" }),
    ).rejects.toThrow(
      "No fake route answers GET /api/items/1 on connection c1.",
    );
    expect(ajour.requests).toHaveLength(1);
  });

  it("rejects an aborted request as fetch does", async () => {
    const ajour = createFakeAjour({
      routes: [
        {
          method: "GET",
          path: "/api/items/*",
          respond: () => new Promise(() => {}),
        },
      ],
    });
    const controller = new AbortController();

    const pending = ajour.http({
      connectionId: "c1",
      method: "GET",
      path: "/api/items/1",
      signal: controller.signal,
    });
    controller.abort();

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    await expect(
      ajour.http({
        connectionId: "c1",
        method: "GET",
        path: "/api/items/1",
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });

  describe("with the plugin's manifest", () => {
    const everything = createFakeAjour({
      manifest,
      routes: [
        { method: "GET", path: "/**", respond: {} },
        { method: "DELETE", path: "/**", respond: {} },
        { host: "elsewhere", method: "GET", path: "/**", respond: {} },
      ],
    });

    it.each([
      [
        "an endpoint the allowlist doesn't hold",
        { method: "GET", path: "/api/admin" },
        "The manifest allows no GET /api/admin on the base address.",
      ],
      [
        "a method the allowlist doesn't hold",
        { method: "DELETE", path: "/api/items/1" },
        "The manifest allows no DELETE /api/items/1 on the base address.",
      ],
      [
        "an absolute address",
        { method: "GET", path: "https://evil.example/api/items/1" },
        "The manifest allows no GET https://evil.example/api/items/1 on the base address.",
      ],
      [
        "a host the manifest doesn't derive",
        { host: "elsewhere", method: "GET", path: "/users/1" },
        'The manifest derives no host "elsewhere".',
      ],
      [
        "a header the manifest doesn't list",
        { method: "GET", path: "/api/items/1", headers: { "If-Match": "1" } },
        "The manifest doesn't list the If-Match header.",
      ],
      [
        "a header the broker sets",
        {
          method: "GET",
          path: "/api/items/1",
          headers: { Authorization: "Bearer stolen" },
        },
        "A plugin may not set the Authorization header.",
      ],
    ])("refuses %s, as the broker would", async (_name, request, message) => {
      await expect(
        everything.http({ connectionId: "c1", ...request } as never),
      ).rejects.toMatchObject({
        name: "AjourRequestError",
        code: "refused",
        message,
      });
    });

    it("lets a declared endpoint through", async () => {
      await expect(
        everything.http({
          connectionId: "c1",
          method: "GET",
          path: "/api/items/1",
          headers: { accept: "application/json" },
        }),
      ).resolves.toMatchObject({ status: 200 });
    });
  });
});

describe("the fake ajour.publicFetch", () => {
  it("answers a declared public host and records the request", async () => {
    const ajour = createFakeAjour({
      manifest,
      publicRoutes: [
        {
          url: "https://avatars.example.com/u/1",
          respond: { body: "png", headers: { "Content-Type": "image/png" } },
        },
      ],
    });

    const response = await ajour.publicFetch("https://avatars.example.com/u/1");

    await expect(response.text()).resolves.toBe("png");
    expect(response.headers["content-type"]).toBe("image/png");
    expect(ajour.publicRequests).toEqual([
      { url: "https://avatars.example.com/u/1", method: "GET", headers: {} },
    ]);
  });

  it.each(["https://evil.example/u/1", "http://avatars.example.com/u/1"])(
    "refuses %s",
    async (url) => {
      const ajour = createFakeAjour({ manifest });

      await expect(ajour.publicFetch(url)).rejects.toMatchObject({
        name: "AjourRequestError",
        code: "refused",
      });
    },
  );
});

describe("the fake ajour.log", () => {
  it("records each line", () => {
    const ajour = createFakeAjour();

    ajour.log("warn", "Skipped items", { count: 2 });

    expect(ajour.logs).toEqual([
      { level: "warn", message: "Skipped items", fields: { count: 2 } },
    ]);
  });
});

describe("route patterns", () => {
  it.each([
    ["/rest/api/3/issue/*", "/rest/api/3/issue/ABC-1"],
    ["/rest/api/3/issue/*", "/rest/api/3/issue/ABC-1/comment"],
    ["/repos/**", "/repos/acme/app"],
    ["/repos/**", "/repos"],
    ["/graphql", "/graphql/"],
    ["/repos/**", "/repos/../admin"],
    ["/repos/*", "/repos/a%2Fb"],
    ["/", "/"],
  ])("match %s against %s as Ajour's broker does", (pattern, path) => {
    expect(routeMatches(pattern, path)).toBe(
      endpointPatternMatches(pattern, path),
    );
  });
});
